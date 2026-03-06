import chalk from "chalk";
import { execFile } from "node:child_process";
import { createInterface } from "node:readline";

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function openUrl(url: string): void {
  // xdg-open on Linux, open on macOS
  const cmd = process.platform === "darwin" ? "open" : "xdg-open";
  execFile(cmd, [url], (err) => {
    if (err) {
      console.error(chalk.red(`Failed to open browser: ${err.message}`));
      console.log(`Open manually: ${url}`);
    }
  });
}

export async function open(agentStr?: string, portStr?: string): Promise<void> {
  let agent = agentStr;
  let port = portStr;

  if (!agent) {
    agent = await prompt("Agent number: ");
  }
  if (!port) {
    port = await prompt("Port: ");
  }

  const agentNum = parseInt(agent, 10);
  const portNum = parseInt(port, 10);

  if (isNaN(agentNum) || agentNum < 1) {
    console.error(chalk.red("Agent must be a positive number."));
    process.exit(1);
  }
  if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
    console.error(chalk.red("Port must be between 1 and 65535."));
    process.exit(1);
  }

  const url = `http://agent-${agentNum}.local:${portNum}`;
  console.log(chalk.cyan(`Opening ${url}`));
  openUrl(url);
}
