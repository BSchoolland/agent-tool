import chalk from "chalk";
import { writeFileSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import * as multipass from "../multipass.js";
import { getBaseCloudInit } from "../cloud-init.js";
import { getRepoName, projectVMName } from "../project.js";
import { mountAuth } from "../auth.js";

const BASE_VM_NAME = "agent-tool-base";

async function ensureBaseImage(): Promise<void> {
  if (await multipass.exists(BASE_VM_NAME)) {
    return;
  }

  console.log(
    chalk.yellow(
      "First time setup detected — building base VM image. This takes ~10 minutes but only happens once.\n"
    )
  );

  // Write cloud-init to home dir (Multipass snap can't access /tmp or dotdirs)
  const cloudInitPath = join(homedir(), "agent-tool-cloud-init.yaml");
  writeFileSync(cloudInitPath, getBaseCloudInit());

  console.log("Launching base VM...");
  try {
    await multipass.launch(BASE_VM_NAME, {
      cloudInit: cloudInitPath,
      memory: "4G",
      disk: "20G",
    });
  } catch (e: any) {
    console.error(chalk.red(`Failed to launch VM: ${e.message}`));
    rmSync(cloudInitPath);
    process.exit(1);
  }
  rmSync(cloudInitPath);
  console.log(chalk.green("VM launched.\n"));

  // Wait for cloud-init to finish
  console.log("Installing dev tools (Node, Bun, Python, Rust, Docker, Claude Code, gh)...");
  try {
    await multipass.runCommand(BASE_VM_NAME, [
      "cloud-init", "status", "--wait",
    ]);
  } catch (e: any) {
    console.error(
      chalk.yellow(`cloud-init wait returned an error: ${e.message}`)
    );
    console.log("Checking if tools were installed anyway...");
  }

  // Verify key tools
  console.log("\nVerifying installations...");
  const checks = [
    { name: "node", cmd: "node --version" },
    { name: "bun", cmd: "bun --version" },
    { name: "python3", cmd: "python3 --version" },
    { name: "gh", cmd: "gh --version" },
    { name: "docker", cmd: "docker --version" },
    { name: "rustc", cmd: "rustc --version" },
    { name: "claude", cmd: "claude --version" },
  ];

  for (const check of checks) {
    try {
      const { stdout } = await multipass.runCommand(BASE_VM_NAME, [
        "sudo", "-u", "ubuntu", "bash", "-lc", check.cmd,
      ]);
      console.log(chalk.green(`  ${check.name}: ${stdout.trim().split("\n")[0]}`));
    } catch {
      console.log(
        chalk.yellow(`  ${check.name}: not found (may need manual install)`)
      );
    }
  }

  // Stop and snapshot
  console.log("\nStopping base VM and creating snapshot...");
  await multipass.stop(BASE_VM_NAME);
  await multipass.snapshot(BASE_VM_NAME, "base");
  console.log(chalk.green("Base image ready.\n"));
}

export async function init(): Promise<void> {
  const project = getRepoName();
  const vmName = projectVMName(project);
  const projectDir = resolve(".");

  console.log(chalk.bold(`Initializing project: ${project}\n`));

  await multipass.checkMultipass();
  await ensureBaseImage();

  // Check project VM doesn't already exist
  if (await multipass.exists(vmName)) {
    console.error(
      chalk.red(
        `Project VM "${vmName}" already exists. Delete it first with "multipass delete --purge ${vmName}" to re-init.`
      )
    );
    process.exit(1);
  }

  // Clone base VM
  console.log("Cloning base VM for project...");
  await multipass.clone(BASE_VM_NAME, vmName);
  console.log(chalk.green("Cloned."));

  // Start the cloned VM
  console.log("Starting VM...");
  await multipass.start(vmName);
  console.log(chalk.green("Started.\n"));

  // Copy entire project directory into VM
  const vmProjectDir = `/home/ubuntu/${project}`;
  console.log("Copying project files into VM...");
  await multipass.transfer(projectDir, `${vmName}:${vmProjectDir}`, true);
  console.log(chalk.green("Files copied.\n"));

  // Mount host auth into VM
  await mountAuth(vmName);

  // Drop user into shell at project root
  console.log(
    chalk.cyan("Dropping you into the VM. Do any VM-specific setup needed.")
  );
  console.log(chalk.cyan('Type "exit" when done to snapshot.\n'));

  await multipass.runInteractive(vmName, [
    "bash", "--login", "-c", `cd ${vmProjectDir} && exec bash`,
  ]);

  // Snapshot after user exits
  console.log("\nStopping VM and creating project snapshot...");
  await multipass.stop(vmName);
  await multipass.snapshot(vmName, `${project}-ready`);
  console.log(
    chalk.bold.green(
      `\nProject "${project}" is ready! Run "agent-tool start <N>" to boot agent VMs.`
    )
  );
}
