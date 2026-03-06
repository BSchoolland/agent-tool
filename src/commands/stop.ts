import chalk from "chalk";
import { execFileSync } from "node:child_process";
import * as multipass from "../multipass.js";
import { getRepoName, agentVMName } from "../project.js";
import { cleanupHostsFile } from "../networking.js";

async function findAgentVMs(project: string): Promise<{ name: string; state: string }[]> {
  const prefix = agentVMName(project, 0).replace(/0$/, "");
  const vms = await multipass.list();
  return vms.filter((vm) => vm.name.startsWith(prefix));
}

export async function stop(): Promise<void> {
  const project = getRepoName();
  const sessionName = `agent-tool-${project}`;

  await multipass.checkMultipass();

  // Kill tmux session
  try {
    execFileSync("tmux", ["kill-session", "-t", sessionName], { stdio: "ignore" });
    console.log(`Killed tmux session "${sessionName}".`);
  } catch {
    // No session running
  }

  // Find and stop agent VMs
  const agents = await findAgentVMs(project);
  if (agents.length === 0) {
    console.log("No agent VMs found.");
    return;
  }

  for (const vm of agents) {
    if (vm.state === "Running") {
      console.log(`Stopping ${vm.name}...`);
      await multipass.stop(vm.name);
    } else {
      console.log(`${vm.name} already stopped.`);
    }
  }

  // Clean up /etc/hosts entries
  console.log("Cleaning up dev server access...");
  cleanupHostsFile();

  console.log(chalk.green(`\nStopped ${agents.length} agent(s). Run "agent-tool start" to resume.`));
}
