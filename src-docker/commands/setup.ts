import chalk from "chalk";
import { resolve } from "node:path";
import * as docker from "../docker.js";
import { getRepoName, vmName } from "../project.js";
import { mountAuth } from "../auth.js";

export async function setup(vmStr: string): Promise<void> {
  const index = parseInt(vmStr, 10);
  if (isNaN(index) || index < 1) {
    console.error(chalk.red("Please provide a valid container number (e.g. agent-tool-docker setup 1)"));
    process.exit(1);
  }

  const project = getRepoName();
  const vm = vmName(index);
  const projectDir = resolve(".");

  await docker.checkDocker();

  // Check container exists and is running
  const containers = await docker.list();
  const containerInfo = containers.find((v) => v.name === vm);
  if (!containerInfo) {
    console.error(chalk.red(`Container ${vm} does not exist. Run "agent-tool-docker init" to create containers.`));
    process.exit(1);
  }
  if (containerInfo.state !== "Running") {
    console.log(`Starting ${vm}...`);
    await docker.start(vm);
  }

  console.log(chalk.bold(`Setting up project "${project}" on ${vm}\n`));

  // Copy project files into container
  const vmProjectDir = `/home/ubuntu/${project}`;
  console.log("Copying project files into container...");
  await docker.transferTar(projectDir, vm, vmProjectDir);
  console.log(chalk.green("Files copied.\n"));

  // Mount auth
  await mountAuth(vm);

  // Drop user into shell at project root
  console.log(
    chalk.cyan("Dropping you into the container. Do any project-specific setup needed (npm install, etc).")
  );
  console.log(chalk.cyan('Type "exit" when done.\n'));

  await docker.runInteractive(vm, [
    "bash", "--login", "-c", `cd ${vmProjectDir} && exec bash`,
  ]);

  console.log(
    chalk.bold.green(`\nProject "${project}" is set up on ${vm}.`)
  );
}
