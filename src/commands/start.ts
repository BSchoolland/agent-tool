import chalk from "chalk";
import * as multipass from "../multipass.js";
import { vmName } from "../project.js";
import { mountAuth } from "../auth.js";

async function findAllAgentVMs(): Promise<{ name: string; state: string }[]> {
  const vms = await multipass.list();
  return vms.filter((vm) => /^agent-tool-\d+$/.test(vm.name));
}

export async function start(vmNumbers: string[]): Promise<void> {
  await multipass.checkMultipass();

  let targets: string[];

  if (vmNumbers.length === 0) {
    // Start all stopped agent-tool VMs
    const agents = await findAllAgentVMs();
    const stopped = agents.filter((vm) => vm.state !== "Running");
    if (stopped.length === 0) {
      console.log("All VMs are already running.");
      return;
    }
    targets = stopped.map((vm) => vm.name);
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

  console.log(chalk.bold(`Starting ${targets.length} VM(s)...\n`));

  await Promise.all(
    targets.map(async (name) => {
      const vms = await multipass.list();
      const vm = vms.find((v) => v.name === name);
      if (!vm) {
        console.log(chalk.yellow(`  ${name}: not found`));
        return;
      }
      if (vm.state === "Running") {
        console.log(`  ${name}: already running`);
      } else {
        await multipass.start(name);
        console.log(chalk.green(`  ${name}: started`));
      }
      await mountAuth(name);
    })
  );
}
