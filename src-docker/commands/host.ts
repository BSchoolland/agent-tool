import chalk from "chalk";
import * as docker from "../docker.js";
import { vmName } from "../project.js";
import { hostAgent, unhostAgent, getHostedAgent } from "../networking.js";

export async function host(vmStr?: string): Promise<void> {
  if (!vmStr) {
    const state = getHostedAgent();
    if (!state) {
      console.log("No container is currently hosted.");
      return;
    }
    await unhostAgent();
    console.log(chalk.yellow(`Stopped hosting ${state.vmName}.`));
    return;
  }

  const index = parseInt(vmStr, 10);
  if (isNaN(index) || index < 1) {
    console.error(chalk.red("Container must be a positive integer."));
    process.exit(1);
  }

  const name = vmName(index);

  await docker.checkDocker();

  const containers = await docker.list();
  const container = containers.find((v) => v.name === name);
  if (!container) {
    console.error(chalk.red(`Container ${name} not found.`));
    process.exit(1);
  }
  if (container.state !== "Running") {
    console.error(chalk.red(`Container ${name} is ${container.state}, not running.`));
    process.exit(1);
  }

  await hostAgent(name, index);

  console.log(
    chalk.green(`Hosting ${name}`) +
    ` — localhost now routes to ${name} (${container.ipv4})`
  );
}
