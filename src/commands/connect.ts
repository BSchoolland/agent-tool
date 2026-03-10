import chalk from "chalk";
import { getRepoName, vmName } from "../project.js";
import * as multipass from "../multipass.js";

export async function connect(vmStr: string): Promise<void> {
  const index = parseInt(vmStr, 10);
  if (isNaN(index) || index < 1) {
    console.error(chalk.red("Please provide a valid VM number (e.g. agent-tool connect 3)"));
    process.exit(1);
  }

  const name = vmName(index);

  const vms = await multipass.list();
  const vm = vms.find((v) => v.name === name);

  if (!vm) {
    console.error(chalk.red(`VM ${name} does not exist.`));
    process.exit(1);
    return;
  }

  if (vm.state !== "Running") {
    console.error(chalk.red(`VM ${name} is ${vm.state}. Start it first with: agent-tool start ${index}`));
    process.exit(1);
  }

  const project = getRepoName();
  const projectDir = `/home/ubuntu/${project}`;
  await multipass.runInteractive(name, ["bash", "--login", "-c", `cd ${projectDir} 2>/dev/null && exec bash --login || exec bash --login`]);
}
