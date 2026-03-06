import chalk from "chalk";
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import * as multipass from "../multipass.js";
import { getBaseCloudInit } from "../cloud-init.js";

const SETUP_VM_NAME = "agent-tool-setup";

export async function init(): Promise<void> {
  console.log(chalk.bold("Initializing agent-tool base image...\n"));

  // 1. Check multipass
  console.log("Checking Multipass installation...");
  try {
    await multipass.checkMultipass();
  } catch (e: any) {
    console.error(chalk.red(e.message));
    process.exit(1);
  }
  console.log(chalk.green("Multipass is available.\n"));

  // 2. Check if base image already exists
  if (await multipass.exists(SETUP_VM_NAME)) {
    console.error(
      chalk.red(
        `VM "${SETUP_VM_NAME}" already exists. Run "multipass delete --purge ${SETUP_VM_NAME}" first, or it may be from a previous interrupted init.`
      )
    );
    process.exit(1);
  }

  // 3. Write cloud-init to home dir (Multipass snap can't access /tmp or dotdirs)
  const cloudInitPath = join(homedir(), "agent-tool-cloud-init.yaml");
  writeFileSync(cloudInitPath, getBaseCloudInit());

  // 4. Launch VM with cloud-init
  console.log("Launching setup VM (this will take several minutes)...");
  try {
    await multipass.launch(SETUP_VM_NAME, {
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

  // 5. Wait for cloud-init to finish
  console.log("Waiting for cloud-init to complete (installing dev tools)...");
  try {
    await multipass.runCommand(SETUP_VM_NAME, [
      "cloud-init", "status", "--wait",
    ]);
  } catch (e: any) {
    console.error(chalk.yellow(`cloud-init wait returned an error: ${e.message}`));
    console.log("Checking if tools were installed anyway...");
  }

  // 6. Verify key tools
  console.log("\nVerifying installations...");
  const checks = [
    { name: "node", cmd: ["node", "--version"] },
    { name: "bun", cmd: ["bash", "-lc", "bun --version"] },
    { name: "python3", cmd: ["python3", "--version"] },
    { name: "gh", cmd: ["gh", "--version"] },
    { name: "docker", cmd: ["docker", "--version"] },
    { name: "rustc", cmd: ["bash", "-lc", "rustc --version"] },
    { name: "claude", cmd: ["bash", "-lc", "claude --version"] },
  ];

  for (const check of checks) {
    try {
      const { stdout } = await multipass.runCommand(SETUP_VM_NAME, check.cmd);
      console.log(chalk.green(`  ${check.name}: ${stdout.trim().split("\n")[0]}`));
    } catch {
      console.log(chalk.yellow(`  ${check.name}: not found (may need manual install)`));
    }
  }

  // 7. Stop VM and snapshot
  console.log("\nStopping VM and creating base snapshot...");
  await multipass.stop(SETUP_VM_NAME);
  await multipass.snapshot(SETUP_VM_NAME, multipass.BASE_IMAGE_NAME);
  console.log(chalk.green(`\nBase image "${multipass.BASE_IMAGE_NAME}" created successfully.`));

  // 8. Keep the VM stopped (snapshots are tied to their parent VM in Multipass)
  console.log(chalk.bold.green("\nInit complete! You can now run: agent-tool setup <project>"));
}
