import chalk from "chalk";
import * as docker from "../docker.js";
import { getHostedAgent } from "../networking.js";

export async function status(): Promise<void> {
  await docker.checkDocker();

  const containers = await docker.list();
  const agents = containers
    .filter((c) => /^agent-tool-\d+$/.test(c.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  if (agents.length === 0) {
    console.log("No agent containers found. Run \"agent-tool-docker init\" to create some.");
    return;
  }

  const hosted = getHostedAgent();

  console.log(chalk.bold(`\n  Containers: ${agents.length}\n`));
  console.log(
    `  ${"NAME".padEnd(24)} ${"STATE".padEnd(12)} IP`
  );
  console.log(`  ${"─".repeat(24)} ${"─".repeat(12)} ${"─".repeat(16)}`);

  for (const c of agents) {
    const isHosted = hosted && hosted.vmName === c.name;
    const stateStr = c.state === "Running"
      ? (isHosted ? chalk.green("Running ★") : chalk.green(c.state))
      : chalk.yellow(c.state);
    const ip = c.state === "Running" ? (c.ipv4 || "—") : "—";
    console.log(
      `  ${c.name.padEnd(24)} ${stateStr.padEnd(12)} ${ip}`
    );
  }

  if (hosted) {
    console.log(chalk.cyan(`\n  ★ ${hosted.vmName} is hosted (localhost → ${hosted.vmIp})`));
  }
  console.log("");
}
