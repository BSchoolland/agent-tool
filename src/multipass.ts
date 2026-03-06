import { execFile, spawn } from "node:child_process";

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

export async function exists(name: string): Promise<boolean> {
  try {
    const vms = await list();
    return vms.some((vm) => vm.name === name);
  } catch {
    return false;
  }
}
