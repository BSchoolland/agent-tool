import chalk from "chalk";
import { checkbox } from "@inquirer/prompts";
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import * as multipass from "../multipass.js";
import { getBaseCloudInit, TOOLS } from "../cloud-init.js";
import { vmName } from "../project.js";
import { mountAuth } from "../auth.js";

const BASE_VM_NAME = "agent-tool-base";

async function selectTools(): Promise<string[]> {
  return checkbox({
    message: "Select tools to install in VMs (detected from host):",
    pageSize: TOOLS.length,
    choices: TOOLS.map((tool) => ({
      name: tool.label,
      value: tool.id,
      checked: tool.detect(),
    })),
  });
}

async function ensureBaseImage(): Promise<void> {
  if (await multipass.exists(BASE_VM_NAME)) {
    return;
  }

  const selectedTools = await selectTools();

  if (selectedTools.length === 0) {
    console.log(chalk.yellow("No tools selected — base VM will only have core packages.\n"));
  } else {
    const labels = selectedTools.map((id) => TOOLS.find((t) => t.id === id)!.label);
    console.log(chalk.cyan(`\nInstalling: ${labels.join(", ")}\n`));
  }

  console.log(
    chalk.yellow(
      "Building base VM image. This takes ~10 minutes but only happens once.\n"
    )
  );

  // Write cloud-init to home dir (Multipass snap can't access /tmp or dotdirs)
  const cloudInitPath = join(homedir(), "agent-tool-cloud-init.yaml");
  writeFileSync(cloudInitPath, getBaseCloudInit(selectedTools));

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

  // Wait for cloud-init to finish, streaming its output log
  const toolNames = selectedTools
    .map((id) => TOOLS.find((t) => t.id === id)!.label)
    .join(", ");
  console.log(`Installing dev tools (${toolNames || "none"})...\n`);
  try {
    await multipass.streamCloudInitLog(BASE_VM_NAME);
  } catch (e: any) {
    console.error(
      chalk.yellow(`cloud-init wait returned an error: ${e.message}`)
    );
    console.log("Checking if tools were installed anyway...");
  }

  // Verify selected tools
  const checks = selectedTools
    .map((id) => TOOLS.find((t) => t.id === id)!)
    .filter((t) => t.verify)
    .map((t) => t.verify!);

  if (checks.length > 0) {
    console.log("\nVerifying installations...");
    const ENV_SETUP = "source ~/.nvm/nvm.sh 2>/dev/null; export PATH=$HOME/.bun/bin:$PATH;";

    for (const check of checks) {
      try {
        const { stdout } = await multipass.runCommand(BASE_VM_NAME, [
          "sudo", "-u", "ubuntu", "bash", "-c", `${ENV_SETUP} ${check.cmd}`,
        ]);
        console.log(chalk.green(`  ${check.name}: ${stdout.trim().split("\n")[0]}`));
      } catch {
        console.log(
          chalk.yellow(`  ${check.name}: not found (may need manual install)`)
        );
      }
    }
  }

  // Stop and snapshot
  console.log("\nStopping base VM and creating snapshot...");
  await multipass.stop(BASE_VM_NAME);
  await multipass.snapshot(BASE_VM_NAME, "base");
  console.log(chalk.green("Base image ready.\n"));
}

/** Find the next available VM index. */
async function nextVMIndex(): Promise<number> {
  const vms = await multipass.list();
  const existing = vms
    .filter((vm) => vm.name.startsWith("agent-tool-"))
    .map((vm) => {
      const match = vm.name.match(/^agent-tool-(\d+)$/);
      return match ? parseInt(match[1], 10) : 0;
    })
    .filter((n) => n > 0);

  if (existing.length === 0) return 1;
  return Math.max(...existing) + 1;
}

export async function init(countStr?: string): Promise<void> {
  const count = countStr ? parseInt(countStr, 10) : 1;
  if (isNaN(count) || count < 1) {
    console.error(chalk.red("Count must be a positive number."));
    process.exit(1);
  }

  await multipass.checkMultipass();
  await ensureBaseImage();

  const startIndex = await nextVMIndex();

  console.log(chalk.bold(`Creating ${count} VM(s)...\n`));

  for (let i = 0; i < count; i++) {
    const index = startIndex + i;
    const name = vmName(index);

    // Clone base VM (retry on qemu-img timeout)
    const MAX_CLONE_ATTEMPTS = 3;
    for (let attempt = 1; attempt <= MAX_CLONE_ATTEMPTS; attempt++) {
      console.log(`Cloning ${name}...${attempt > 1 ? ` (attempt ${attempt}/${MAX_CLONE_ATTEMPTS})` : ""}`);
      const cloneStart = Date.now();
      const cloneTimer = setInterval(() => {
        const elapsed = ((Date.now() - cloneStart) / 1000).toFixed(0);
        process.stderr.write(`\r  ${elapsed}s elapsed...`);
      }, 1000);
      try {
        await multipass.clone(BASE_VM_NAME, name);
        clearInterval(cloneTimer);
        process.stderr.write("\n");
        break;
      } catch (e: any) {
        clearInterval(cloneTimer);
        process.stderr.write("\n");
        if (attempt === MAX_CLONE_ATTEMPTS) {
          console.error(chalk.red(`Clone failed after ${MAX_CLONE_ATTEMPTS} attempts: ${e.message}`));
          process.exit(1);
        }
        console.log(chalk.yellow(`Clone failed (${e.message}), retrying...`));
        try { await multipass.deleteVM(name); } catch {}
      }
    }

    // Start the VM
    console.log(`Starting ${name}...`);
    await multipass.start(name);
    await mountAuth(name);
    console.log(chalk.green(`  ${name}: ready`));
  }

  console.log(
    chalk.bold.green(
      `\n${count} VM(s) created (${vmName(startIndex)}${count > 1 ? ` – ${vmName(startIndex + count - 1)}` : ""}). Use "agent-tool setup <N>" to add a project.`
    )
  );
}
