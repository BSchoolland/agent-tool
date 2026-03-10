import chalk from "chalk";
import * as multipass from "../multipass.js";
import { vmName } from "../project.js";
import { getHostedAgent, unhostAgent } from "../networking.js";

async function findAllAgentVMs(): Promise<{ name: string; state: string }[]> {
  const vms = await multipass.list();
  return vms.filter((vm) => /^agent-tool-\d+$/.test(vm.name));
}

export async function stop(vmNumbers: string[]): Promise<void> {
  await multipass.checkMultipass();

  let targets: string[];

  if (vmNumbers.length === 0) {
    // Stop all running agent-tool VMs
    const agents = await findAllAgentVMs();
    const running = agents.filter((vm) => vm.state === "Running");
    if (running.length === 0) {
      console.log("No running VMs to stop.");
      return;
    }
    targets = running.map((vm) => vm.name);
  } else {
    targets = vmNumbers.map((n) => {
      const index = parseInt(n, 10);
      if (isNaN(index) || index < 1) {
        console.error(chalk.red(`Invalid VM number: ${n}`));
        process.exit(1);
      }
      return vmName(index);
    });
  }

  // Clean up localhost forwarding if a hosted VM is being stopped
  const hosted = getHostedAgent();
  if (hosted && targets.includes(hosted.vmName)) {
    await unhostAgent();
  }

  console.log(chalk.bold(`Stopping ${targets.length} VM(s)...\n`));

  await Promise.all(
    targets.map(async (name) => {
      const vms = await multipass.list();
      const vm = vms.find((v) => v.name === name);
      if (!vm) {
        console.log(chalk.yellow(`  ${name}: not found`));
        return;
      }
      if (vm.state !== "Running") {
        console.log(`  ${name}: already stopped`);
      } else {
        await multipass.stop(name);
        console.log(chalk.green(`  ${name}: stopped`));
      }
    })
  );
}
