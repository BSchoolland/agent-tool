import chalk from "chalk";
import { resolve } from "node:path";
import * as multipass from "../multipass.js";
import { getRepoName, vmName } from "../project.js";
import { mountAuth } from "../auth.js";

export async function setup(vmStr: string): Promise<void> {
  const index = parseInt(vmStr, 10);
  if (isNaN(index) || index < 1) {
    console.error(chalk.red("Please provide a valid VM number (e.g. agent-tool setup 1)"));
    process.exit(1);
  }

  const project = getRepoName();
  const vm = vmName(index);
  const projectDir = resolve(".");

  await multipass.checkMultipass();

  // Check VM exists and is running
  const vms = await multipass.list();
  const vmInfo = vms.find((v) => v.name === vm);
  if (!vmInfo) {
    console.error(chalk.red(`VM ${vm} does not exist. Run "agent-tool init" to create VMs.`));
    process.exit(1);
  }
  if (vmInfo.state !== "Running") {
    console.log(`Starting ${vm}...`);
    await multipass.start(vm);
  }

  console.log(chalk.bold(`Setting up project "${project}" on ${vm}\n`));

  // Copy project files into VM
  const vmProjectDir = `/home/ubuntu/${project}`;
  console.log("Copying project files into VM...");
  await multipass.transferTar(projectDir, vm, vmProjectDir);
  console.log(chalk.green("Files copied.\n"));

  // Mount auth
  await mountAuth(vm);

  // Drop user into shell at project root
  console.log(
    chalk.cyan("Dropping you into the VM. Do any project-specific setup needed (npm install, etc).")
  );
  console.log(chalk.cyan('Type "exit" when done.\n'));

  await multipass.runInteractive(vm, [
    "bash", "--login", "-c", `cd ${vmProjectDir} && exec bash`,
  ]);

  console.log(
    chalk.bold.green(`\nProject "${project}" is set up on ${vm}.`)
  );
}
