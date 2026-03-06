import chalk from "chalk";
import { execFileSync } from "node:child_process";
import * as multipass from "../multipass.js";
import { getRepoName, agentVMName } from "../project.js";

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

  const running = agents.filter((vm) => vm.state === "Running");
  const stopped = agents.filter((vm) => vm.state !== "Running");
  for (const vm of stopped) {
    console.log(`${vm.name} already stopped.`);
  }
  if (running.length > 0) {
    console.log(`Stopping ${running.map((vm) => vm.name).join(", ")}...`);
    await Promise.all(running.map((vm) => multipass.stop(vm.name)));
  }

  console.log(chalk.green(`\nStopped ${agents.length} agent(s). Run "agent-tool start" to resume.`));
}
