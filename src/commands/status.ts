import chalk from "chalk";
import * as multipass from "../multipass.js";
import { getRepoName, projectVMName, agentVMName } from "../project.js";

export async function status(): Promise<void> {
  const project = getRepoName();
  const projectVM = projectVMName(project);
  const agentPrefix = agentVMName(project, 0).replace(/0$/, "");

  await multipass.checkMultipass();

  const vms = await multipass.list();
  const agents = vms.filter((vm) => vm.name.startsWith(agentPrefix));

  console.log(chalk.bold(`Project: ${project}\n`));

  // Project VM status
  const pvm = vms.find((vm) => vm.name === projectVM);
  if (pvm) {
    console.log(`  Project VM: ${pvm.state === "Running" ? chalk.green(pvm.state) : chalk.yellow(pvm.state)}`);
  } else {
    console.log(chalk.red("  Project VM: not found (run \"agent-tool init\")"));
  }

  if (agents.length === 0) {
    console.log("\n  No agent VMs found.");
    return;
  }

  console.log(`\n  Agents: ${agents.length}\n`);
  console.log(
    `  ${"NAME".padEnd(40)} ${"STATE".padEnd(12)} ${"IP".padEnd(16)} BRANCH`
  );
  console.log(`  ${"─".repeat(40)} ${"─".repeat(12)} ${"─".repeat(16)} ${"─".repeat(20)}`);

  for (const vm of agents) {
    let branch = "—";
    if (vm.state === "Running") {
      try {
        const { stdout } = await multipass.runCommand(vm.name, [
          "sudo", "-u", "ubuntu", "bash", "-lc",
          `cd /home/ubuntu/${project} && git branch --show-current`,
        ]);
        branch = stdout.trim() || "—";
      } catch {
        // Can't get branch
      }
    }

    const stateColor = vm.state === "Running" ? chalk.green : chalk.yellow;
    console.log(
      `  ${vm.name.padEnd(40)} ${stateColor(vm.state.padEnd(12))} ${(vm.ipv4 || "—").padEnd(16)} ${branch}`
    );
  }
}
