import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const BASE_IMAGE_NAME = "agent-tool-base";

interface ExecResult {
  stdout: string;
  stderr: string;
}

function exec(args: string[], opts: { timeout?: number } = {}): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    execFile(
      "multipass",
      args,
      { maxBuffer: 10 * 1024 * 1024, timeout: opts.timeout ?? 0 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`multipass ${args.join(" ")} failed: ${stderr || err.message}`));
        } else {
          resolve({ stdout, stderr });
        }
      }
    );
  });
}

export async function checkMultipass(): Promise<void> {
  try {
    await exec(["version"]);
  } catch {
    throw new Error(
      "Multipass is not installed or not running. Install it from https://multipass.run/"
    );
  }
}

function execStreamed(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("multipass", args, { stdio: "inherit" });
    child.on("error", (err) =>
      reject(new Error(`multipass ${args.join(" ")} failed: ${err.message}`))
    );
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`multipass ${args.join(" ")} exited with code ${code}`));
      } else {
        resolve();
      }
    });
  });
}

export async function launch(
  name: string,
  opts: { cloudInit?: string; cpus?: number; memory?: string; disk?: string } = {}
): Promise<void> {
  const args = ["launch", "--name", name];
  if (opts.cpus) args.push("--cpus", String(opts.cpus));
  if (opts.memory) args.push("--memory", opts.memory);
  if (opts.disk) args.push("--disk", opts.disk);
  if (opts.cloudInit) args.push("--cloud-init", opts.cloudInit);
  await execStreamed(args);
}

export async function stop(name: string): Promise<void> {
  await exec(["stop", name]);
}

export async function deleteVM(name: string): Promise<void> {
  await exec(["delete", "--purge", name]);
}

export async function snapshot(vmName: string, snapshotName: string): Promise<void> {
  await exec(["snapshot", vmName, "--name", snapshotName]);
}

export async function runCommand(vmName: string, command: string[]): Promise<ExecResult> {
  return exec(["exec", vmName, "--", ...command]);
}

export async function runInteractive(vmName: string, command: string[]): Promise<void> {
  await execStreamed(["exec", vmName, "--", ...command]);
}

export async function list(): Promise<{ name: string; state: string; ipv4: string }[]> {
  const { stdout } = await exec(["list", "--format", "json"]);
  const data = JSON.parse(stdout);
  return (data.list || []).map((vm: any) => ({
    name: vm.name,
    state: vm.state,
    ipv4: vm.ipv4?.[0] || "",
  }));
}

export async function info(name: string): Promise<any> {
  const { stdout } = await exec(["info", name, "--format", "json"]);
  return JSON.parse(stdout);
}

export async function clone(source: string, name: string): Promise<void> {
  await exec(["clone", source, "--name", name]);
}

export async function start(name: string): Promise<void> {
  await exec(["start", name]);
}

export async function transfer(source: string, destination: string, recursive = false): Promise<void> {
  const args = ["transfer"];
  if (recursive) args.push("--recursive");
  args.push(source, destination);
  await execStreamed(args);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export async function transferTar(localDir: string, vmName: string, vmDir: string): Promise<void> {
  // Use home directory for temp files — multipass snap cannot access /tmp
  // and cannot access dot-prefixed paths due to snap home confinement
  const tmpDir = await mkdtemp(join(homedir(), "agent-tool-tmp-"));
  const tarball = join(tmpDir, "transfer.tar");
  const remoteTarball = `/tmp/transfer-${Date.now()}.tar`;
  try {
    // Create tarball locally
    process.stderr.write("  Compressing...");
    await new Promise<void>((resolve, reject) => {
      const proc = spawn("tar", ["cf", tarball, "-C", localDir, "."], { stdio: "ignore" });
      proc.on("error", reject);
      proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`tar create exited with code ${code}`)));
    });

    const { size: totalSize } = await stat(tarball);
    process.stderr.write(`\r  Compressed ${formatBytes(totalSize)}${" ".repeat(20)}\n`);

    // Transfer tarball into VM, polling remote size for progress
    let polling = true;
    const transferDone = transfer(tarball, `${vmName}:${remoteTarball}`);
    const poll = (async () => {
      while (polling) {
        await new Promise((r) => setTimeout(r, 500));
        if (!polling) break;
        try {
          const { stdout } = await runCommand(vmName, ["stat", "-c", "%s", remoteTarball]);
          const remoteSize = parseInt(stdout.trim(), 10);
          if (!isNaN(remoteSize)) {
            const pct = Math.min(100, Math.round((remoteSize / totalSize) * 100));
            process.stderr.write(`\r  Copying... ${pct}% (${formatBytes(remoteSize)} / ${formatBytes(totalSize)})`);
          }
        } catch {
          // File may not exist yet on remote
        }
      }
    })();
    try { await transferDone; } finally { polling = false; }
    await poll;
    process.stderr.write(`\r  Copied ${formatBytes(totalSize)}${" ".repeat(30)}\n`);

    // Extract on VM and clean up remote tarball
    process.stderr.write("  Extracting...");
    await runCommand(vmName, ["bash", "-c", `mkdir -p ${vmDir} && tar xf ${remoteTarball} -C ${vmDir} && rm ${remoteTarball}`]);
    process.stderr.write(`\r  Extracted${" ".repeat(20)}\n`);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

export async function streamCloudInitLog(vmName: string): Promise<void> {
  const LOG_FILE = "/var/log/cloud-init-output.log";
  let offset = 0;
  const POLL_MS = 1000;

  while (true) {
    // Check cloud-init status
    const { stdout: status } = await runCommand(vmName, [
      "cloud-init", "status",
    ]);
    const done = status.trim().includes("done") || status.trim().includes("error");

    // Read any new log content
    try {
      const { stdout: chunk } = await runCommand(vmName, [
        "bash", "-c", `tail -c +${offset + 1} ${LOG_FILE} 2>/dev/null`,
      ]);
      if (chunk.length > 0) {
        process.stdout.write(chunk);
        offset += Buffer.byteLength(chunk);
      }
    } catch {
      // Log file may not exist yet
    }

    if (done) break;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

export async function shell(name: string): Promise<void> {
  await execStreamed(["shell", name]);
}

export async function restore(vmName: string, snapshotName: string): Promise<void> {
  await exec(["restore", `${vmName}.${snapshotName}`, "--destructive"]);
}

export async function mount(hostPath: string, vmName: string, vmPath: string): Promise<void> {
  await exec(["mount", hostPath, `${vmName}:${vmPath}`]);
}

export async function exists(name: string): Promise<boolean> {
  try {
    const vms = await list();
    return vms.some((vm) => vm.name === name);
  } catch {
    return false;
  }
}
