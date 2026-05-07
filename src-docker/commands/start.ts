import chalk from "chalk";
import * as docker from "../docker.js";
import { vmName } from "../project.js";
import { mountAuth } from "../auth.js";

async function findAllAgentContainers(): Promise<{ name: string; state: string }[]> {
  const containers = await docker.list();
  return containers.filter((c) => /^agent-tool-\d+$/.test(c.name));
}

export async function start(vmNumbers: string[]): Promise<void> {
  await docker.checkDocker();

  let targets: string[];

  if (vmNumbers.length === 0) {
    // Start all stopped agent-tool containers
    const agents = await findAllAgentContainers();
    const stopped = agents.filter((c) => c.state !== "Running");
    if (stopped.length === 0) {
      console.log("All containers are already running.");
      return;
    }
    targets = stopped.map((c) => c.name);
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

  console.log(chalk.bold(`Starting ${targets.length} container(s)...\n`));

  await Promise.all(
    targets.map(async (name) => {
      const containers = await docker.list();
      const container = containers.find((v) => v.name === name);
      if (!container) {
        console.log(chalk.yellow(`  ${name}: not found`));
        return;
      }
      if (container.state === "Running") {
        console.log(`  ${name}: already running`);
      } else {
        await docker.start(name);
        console.log(chalk.green(`  ${name}: started`));
      }
      await mountAuth(name);
    })
  );
}
