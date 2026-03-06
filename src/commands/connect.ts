import chalk from "chalk";
import { getRepoName, agentVMName } from "../project.js";
import * as multipass from "../multipass.js";

export async function connect(agent: string): Promise<void> {
  const index = parseInt(agent, 10);
  if (isNaN(index) || index < 1) {
    console.error(chalk.red("Please provide a valid agent number (e.g. agent-tool connect 3)"));
    process.exit(1);
  }

  const project = getRepoName();
  const vmName = agentVMName(project, index);

  const vms = await multipass.list();
  const vm = vms.find((v) => v.name === vmName);

  if (!vm) {
    console.error(chalk.red(`Agent ${index} (${vmName}) does not exist.`));
    process.exit(1);
    return;
  }

  if (vm.state !== "Running") {
    console.error(chalk.red(`Agent ${index} is ${vm.state}. Start it first with: agent-tool start`));
    process.exit(1);
  }

  const projectDir = `/home/ubuntu/${project}`;
  await multipass.runInteractive(vmName, ["bash", "--login", "-c", `cd ${projectDir} && exec bash --login`]);
}
