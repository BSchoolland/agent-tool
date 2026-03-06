import chalk from "chalk";
import { execFileSync, spawnSync } from "node:child_process";
import * as multipass from "../multipass.js";
import { getRepoName, projectVMName, agentVMName } from "../project.js";
import { mountAuth } from "../auth.js";

function checkTmux(): void {
  try {
    execFileSync("which", ["tmux"]);
  } catch {
    console.error(chalk.red("tmux is not installed. Install it first."));
    process.exit(1);
  }
}

function createTmuxSession(sessionName: string, vmNames: string[], project: string): void {
  const vmProjectDir = `/home/ubuntu/${project}`;

  // Kill existing session if any
  try {
    execFileSync("tmux", ["kill-session", "-t", sessionName], { stdio: "ignore" });
  } catch {
    // No existing session
  }

  // Create session with first agent
  execFileSync("tmux", [
    "new-session", "-d", "-s", sessionName,
    "-n", "agent-1",
    "multipass", "exec", vmNames[0], "--", "bash", "--login", "-c",
    `cd ${vmProjectDir} && exec bash`,
  ]);

  // Add remaining agents as new windows
  for (let i = 1; i < vmNames.length; i++) {
    execFileSync("tmux", [
      "new-window", "-t", sessionName,
      "-n", `agent-${i + 1}`,
      "multipass", "exec", vmNames[i], "--", "bash", "--login", "-c",
      `cd ${vmProjectDir} && exec bash`,
    ]);
  }
}

function attachTmux(sessionName: string): void {
  spawnSync("tmux", ["attach-session", "-t", sessionName], { stdio: "inherit" });
}

async function findRunningAgents(project: string): Promise<string[]> {
  const prefix = agentVMName(project, 0).replace(/0$/, "");
  const vms = await multipass.list();
  return vms
    .filter((vm) => vm.name.startsWith(prefix))
    .map((vm) => vm.name)
    .sort();
}

export async function start(countStr?: string): Promise<void> {
  const project = getRepoName();
  const sourceVM = projectVMName(project);
  const sessionName = `agent-tool-${project}`;

  await multipass.checkMultipass();
  checkTmux();

  // No count given — resume existing agents
  if (!countStr) {
    const existing = await findRunningAgents(project);
    if (existing.length === 0) {
      console.error(chalk.red("No agent VMs found. Run \"agent-tool start <count>\" to create them."));
      process.exit(1);
    }

    console.log(chalk.bold(`Resuming ${existing.length} agent(s) for project: ${project}\n`));

    // Ensure VMs are started and auth is mounted
    for (const vmName of existing) {
      const vms = await multipass.list();
      const vm = vms.find((v) => v.name === vmName);
      if (vm && vm.state !== "Running") {
        console.log(`Starting ${vmName}...`);
        await multipass.start(vmName);
      }
      await mountAuth(vmName);
    }

    createTmuxSession(sessionName, existing, project);
    console.log(chalk.bold.green(`Resumed ${existing.length} agent(s).`));
    console.log(chalk.cyan(`Attaching... (detach with Ctrl-b d)\n`));
    attachTmux(sessionName);
    return;
  }

  // Count given — create new agents
  const count = parseInt(countStr, 10);
  if (isNaN(count) || count < 1) {
    console.error(chalk.red("Count must be a positive number."));
    process.exit(1);
  }

  // Check project VM exists
  if (!(await multipass.exists(sourceVM))) {
    console.error(
      chalk.red(`Project VM "${sourceVM}" not found. Run "agent-tool init" first.`)
    );
    process.exit(1);
  }

  console.log(chalk.bold(`Starting ${count} agent(s) for project: ${project}\n`));

  // Clone and start VMs
  const vmNames: string[] = [];
  for (let i = 1; i <= count; i++) {
    const vmName = agentVMName(project, i);
    vmNames.push(vmName);

    if (await multipass.exists(vmName)) {
      console.log(`Agent ${i} VM already exists, starting...`);
      await multipass.start(vmName);
    } else {
      console.log(`Cloning agent ${i}...`);
      await multipass.clone(sourceVM, vmName);
      console.log(`Starting agent ${i}...`);
      await multipass.start(vmName);
    }

    await mountAuth(vmName);

    // Create git branch inside VM
    const branchName = `agent-${i}`;
    try {
      await multipass.runCommand(vmName, [
        "sudo", "-u", "ubuntu", "bash", "-lc",
        `cd /home/ubuntu/${project} && git checkout -b ${branchName} 2>/dev/null || git checkout ${branchName}`,
      ]);
      console.log(chalk.green(`  Agent ${i}: branch "${branchName}"`));
    } catch {
      console.log(chalk.yellow(`  Agent ${i}: started (could not set up git branch)`));
    }
  }

  console.log("");

  createTmuxSession(sessionName, vmNames, project);
  console.log(chalk.bold.green(`tmux session created with ${count} agent(s).`));
  console.log(chalk.cyan(`Attaching... (detach with Ctrl-b d)\n`));
  attachTmux(sessionName);
}
