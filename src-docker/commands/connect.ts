import chalk from "chalk";
import { getRepoName, vmName } from "../project.js";
import * as docker from "../docker.js";

export async function connect(vmStr: string): Promise<void> {
  const index = parseInt(vmStr, 10);
  if (isNaN(index) || index < 1) {
    console.error(chalk.red("Please provide a valid container number (e.g. agent-tool-docker connect 3)"));
    process.exit(1);
  }

  const name = vmName(index);

  const containers = await docker.list();
  const container = containers.find((v) => v.name === name);

  if (!container) {
    console.error(chalk.red(`Container ${name} does not exist.`));
    process.exit(1);
    return;
  }

  if (container.state !== "Running") {
    console.error(chalk.red(`Container ${name} is ${container.state}. Start it first with: agent-tool-docker start ${index}`));
    process.exit(1);
  }

  const project = getRepoName();
  const projectDir = `/home/ubuntu/${project}`;
  await docker.runInteractive(name, ["bash", "--login", "-c", `cd ${projectDir} 2>/dev/null && exec bash --login || exec bash --login`]);
}
