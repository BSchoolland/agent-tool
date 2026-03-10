import chalk from "chalk";
import * as multipass from "../multipass.js";
import { getHostedAgent } from "../networking.js";

export async function status(): Promise<void> {
  await multipass.checkMultipass();

  const vms = await multipass.list();
  const agents = vms
    .filter((vm) => /^agent-tool-\d+$/.test(vm.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  if (agents.length === 0) {
    console.log("No agent VMs found. Run \"agent-tool init\" to create some.");
    return;
  }

  const hosted = getHostedAgent();

  console.log(chalk.bold(`\n  VMs: ${agents.length}\n`));
  console.log(
    `  ${"NAME".padEnd(24)} ${"STATE".padEnd(12)} IP`
  );
  console.log(`  ${"─".repeat(24)} ${"─".repeat(12)} ${"─".repeat(16)}`);

  for (const vm of agents) {
    const isHosted = hosted && hosted.vmName === vm.name;
    const stateStr = vm.state === "Running"
      ? (isHosted ? chalk.green("Running ★") : chalk.green(vm.state))
      : chalk.yellow(vm.state);
    const ip = vm.state === "Running" ? (vm.ipv4 || "—") : "—";
    console.log(
      `  ${vm.name.padEnd(24)} ${stateStr.padEnd(12)} ${ip}`
    );
  }

  if (hosted) {
    console.log(chalk.cyan(`\n  ★ ${hosted.vmName} is hosted (localhost → ${hosted.vmIp})`));
  }
  console.log("");
}
