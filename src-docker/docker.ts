import { execFile, spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";

export const BASE_IMAGE_NAME = "agent-tool-base";

interface ExecResult {
  stdout: string;
  stderr: string;
}

function exec(args: string[], opts: { timeout?: number } = {}): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    execFile(
      "docker",
      args,
      { maxBuffer: 10 * 1024 * 1024, timeout: opts.timeout ?? 0 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`docker ${args.join(" ")} failed: ${stderr || err.message}`));
        } else {
          resolve({ stdout, stderr });
        }
      }
    );
  });
}

function execStreamed(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { stdio: "inherit" });
    child.on("error", (err) =>
      reject(new Error(`docker ${args.join(" ")} failed: ${err.message}`))
    );
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`docker ${args.join(" ")} exited with code ${code}`));
      } else {
        resolve();
      }
    });
  });
}

function execPiped(cmd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", ["-c", cmd], { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Command failed with code ${code}: ${cmd}`));
      } else {
        resolve();
      }
    });
  });
}

export async function checkDocker(): Promise<void> {
  try {
    await exec(["info"]);
  } catch {
    throw new Error(
      "Docker is not installed or not running. Install it from https://docs.docker.com/get-docker/"
    );
  }
}

/** Build the bind mount flags for auth directories that exist on host. */
function authBindMounts(): string[] {
  const mounts: string[] = [];
  const home = homedir();
  const dirs = [
    { host: join(home, ".claude"), container: "/home/ubuntu/.claude" },
    { host: join(home, ".codex"), container: "/home/ubuntu/.codex" },
    { host: join(home, ".config", "opencode"), container: "/home/ubuntu/.config/opencode" },
    { host: join(home, ".cache", "opencode"), container: "/home/ubuntu/.cache/opencode" },
  ];
  for (const { host: hostPath, container } of dirs) {
    if (existsSync(hostPath)) {
      mounts.push("-v", `${hostPath}:${container}`);
    }
  }
  return mounts;
}

export async function launch(name: string): Promise<void> {
  const args = [
    "run", "-d",
    "--privileged",
    "--init",
    "--name", name,
    "--hostname", name,
    "--label", "agent-tool=true",
    "--tmpfs", "/tmp:exec",
    "--tmpfs", "/run",
    "--tmpfs", "/run/lock",
    "--cgroupns=host",
    "-v", `${name}-docker:/var/lib/docker`,
    ...authBindMounts(),
    `${BASE_IMAGE_NAME}:latest`,
  ];
  await exec(args);
}

export async function stop(name: string): Promise<void> {
  await exec(["stop", name]);
}

export async function start(name: string): Promise<void> {
  await exec(["start", name]);
}

export async function deleteContainer(name: string): Promise<void> {
  await exec(["rm", "-f", name]);
  try {
    await exec(["volume", "rm", `${name}-docker`]);
  } catch {
    // Volume may not exist
  }
}

export async function snapshot(name: string, snap: string): Promise<void> {
  await exec(["commit", name, `${BASE_IMAGE_NAME}:${snap}`]);
}

export async function runCommand(name: string, command: string[]): Promise<ExecResult> {
  return exec(["exec", name, ...command]);
}

export async function runInteractive(name: string, command: string[]): Promise<void> {
  await execStreamed(["exec", "-it", name, ...command]);
}

export async function list(): Promise<{ name: string; state: string; ipv4: string }[]> {
  const { stdout } = await exec([
    "ps", "-a",
    "--filter", "label=agent-tool",
    "--format", "{{json .}}",
  ]);

  const containers: { name: string; state: string; ipv4: string }[] = [];
  for (const line of stdout.trim().split("\n")) {
    if (!line) continue;
    const data = JSON.parse(line);
    const name = data.Names;
    const running = data.State === "running";
    let ipv4 = "";
    if (running) {
      try {
        ipv4 = await getIP(name);
      } catch {}
    }
    containers.push({
      name,
      state: running ? "Running" : "Stopped",
      ipv4,
    });
  }
  return containers;
}

export async function info(name: string): Promise<any> {
  const { stdout } = await exec(["inspect", name]);
  return JSON.parse(stdout);
}

export async function clone(source: string, name: string): Promise<void> {
  // Clone by running a new container from a committed image
  const args = [
    "run", "-d",
    "--privileged",
    "--init",
    "--name", name,
    "--hostname", name,
    "--label", "agent-tool=true",
    "--tmpfs", "/tmp:exec",
    "--tmpfs", "/run",
    "--tmpfs", "/run/lock",
    "--cgroupns=host",
    "-v", `${name}-docker:/var/lib/docker`,
    ...authBindMounts(),
    `${BASE_IMAGE_NAME}:base`,
  ];
  await exec(args);
}

export async function transfer(source: string, destination: string, recursive = false): Promise<void> {
  // Parse name:path format — one side will have a colon (the container side)
  const args = ["cp"];
  if (recursive) args.push("-a");
  args.push(source, destination);
  await execStreamed(args);
}

export async function transferTar(localDir: string, name: string, vmDir: string): Promise<void> {
  process.stderr.write("  Transferring...");
  const cmd = `tar cf - -C ${JSON.stringify(localDir)} . | docker exec -i ${name} bash -c "mkdir -p ${vmDir} && tar xf - -C ${vmDir}"`;
  await execPiped(cmd);
  process.stderr.write("\r  Transfer complete.                \n");
}

export async function shell(name: string): Promise<void> {
  await execStreamed(["exec", "-it", "-u", "ubuntu", "-w", "/home/ubuntu", name, "bash", "--login"]);
}

export async function mount(hostPath: string, vmName: string, vmPath: string): Promise<void> {
  // No-op: bind mounts are set at container creation time
  console.log(`  Note: bind mounts are configured at container creation. Cannot mount ${hostPath} dynamically.`);
}

export async function exists(name: string): Promise<boolean> {
  try {
    const { stdout } = await exec([
      "ps", "-a",
      "--filter", `name=^/${name}$`,
      "--format", "{{.Names}}",
    ]);
    return stdout.trim() === name;
  } catch {
    return false;
  }
}

export async function getIP(name: string): Promise<string> {
  const { stdout } = await exec([
    "inspect",
    "--format", "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}",
    name,
  ]);
  return stdout.trim();
}
