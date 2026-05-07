import chalk from "chalk";
import * as docker from "../docker.js";
import { vmName } from "../project.js";
import { getHostedAgent, unhostAgent } from "../networking.js";

async function findAllAgentContainers(): Promise<{ name: string; state: string }[]> {
  const containers = await docker.list();
  return containers.filter((c) => /^agent-tool-\d+$/.test(c.name));
}

export async function stop(vmNumbers: string[]): Promise<void> {
  await docker.checkDocker();

  let targets: string[];

  if (vmNumbers.length === 0) {
    // Stop all running agent-tool containers
    const agents = await findAllAgentContainers();
    const running = agents.filter((c) => c.state === "Running");
    if (running.length === 0) {
      console.log("No running containers to stop.");
      return;
    }
    targets = running.map((c) => c.name);
  } else {
    targets = vmNumbers.map((n) => {
      const index = parseInt(n, 10);
      if (isNaN(index) || index < 1) {
        console.error(chalk.red(`Invalid container number: ${n}`));
        process.exit(1);
      }
      return vmName(index);
    });
  }

  // Clean up localhost forwarding if a hosted container is being stopped
  const hosted = getHostedAgent();
  if (hosted && targets.includes(hosted.vmName)) {
    await unhostAgent();
  }

  console.log(chalk.bold(`Stopping ${targets.length} container(s)...\n`));

  await Promise.all(
    targets.map(async (name) => {
      const containers = await docker.list();
      const container = containers.find((v) => v.name === name);
      if (!container) {
        console.log(chalk.yellow(`  ${name}: not found`));
        return;
      }
      if (container.state !== "Running") {
        console.log(`  ${name}: already stopped`);
      } else {
        await docker.stop(name);
        console.log(chalk.green(`  ${name}: stopped`));
      }
    })
  );
}
