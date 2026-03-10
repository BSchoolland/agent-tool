import chalk from "chalk";
import * as multipass from "../multipass.js";
import { vmName } from "../project.js";
import { hostAgent, unhostAgent, getHostedAgent } from "../networking.js";

export async function host(vmStr?: string): Promise<void> {
  if (!vmStr) {
    const state = getHostedAgent();
    if (!state) {
      console.log("No VM is currently hosted.");
      return;
    }
    await unhostAgent();
    console.log(chalk.yellow(`Stopped hosting ${state.vmName}.`));
    return;
  }

  const index = parseInt(vmStr, 10);
  if (isNaN(index) || index < 1) {
    console.error(chalk.red("VM must be a positive integer."));
    process.exit(1);
  }

  const name = vmName(index);

  await multipass.checkMultipass();

  const vms = await multipass.list();
  const vm = vms.find((v) => v.name === name);
  if (!vm) {
    console.error(chalk.red(`VM ${name} not found.`));
    process.exit(1);
  }
  if (vm.state !== "Running") {
    console.error(chalk.red(`VM ${name} is ${vm.state}, not running.`));
    process.exit(1);
  }

  await hostAgent(name, index);

  console.log(
    chalk.green(`Hosting ${name}`) +
    ` — localhost now routes to ${name} (${vm.ipv4})`
  );
}
