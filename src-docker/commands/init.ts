import chalk from "chalk";
import { checkbox } from "@inquirer/prompts";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import * as docker from "../docker.js";
import { TOOLS } from "../../src/cloud-init.js";
import { generateDockerfile, writeEntrypoint } from "../dockerfile.js";
import { vmName } from "../project.js";
import { mountAuth } from "../auth.js";

const BASE_IMAGE_NAME = "agent-tool-base";

async function selectTools(): Promise<string[]> {
  return checkbox({
    message: "Select tools to install in containers (detected from host):",
    pageSize: TOOLS.length,
    choices: TOOLS.map((tool) => ({
      name: tool.label,
      value: tool.id,
      checked: tool.detect(),
    })),
  });
}

function dockerBuild(contextDir: string, tag: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["build", "-t", tag, contextDir], { stdio: "inherit" });
    child.on("error", (err) => reject(new Error(`docker build failed: ${err.message}`)));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`docker build exited with code ${code}`));
      } else {
        resolve();
      }
    });
  });
}

async function ensureBaseImage(): Promise<void> {
  // Check if base image already exists
  try {
    const { stdout } = await docker.runCommand("", []).catch(() => ({ stdout: "" }));
  } catch {}

  // Check for existing image
  const { execFileSync } = await import("node:child_process");
  let imageExists = false;
  try {
    const result = execFileSync("docker", ["images", "-q", `${BASE_IMAGE_NAME}:latest`], {
      encoding: "utf-8",
    }).trim();
    imageExists = result.length > 0;
  } catch {}

  if (imageExists) {
    return;
  }

  const selectedTools = await selectTools();

  if (selectedTools.length === 0) {
    console.log(chalk.yellow("No tools selected — base image will only have core packages.\n"));
  } else {
    const labels = selectedTools.map((id) => TOOLS.find((t) => t.id === id)!.label);
    console.log(chalk.cyan(`\nInstalling: ${labels.join(", ")}\n`));
  }

  console.log(
    chalk.yellow(
      "Building base Docker image. This may take a few minutes but only happens once.\n"
    )
  );

  // Create temp build context
  const buildDir = mkdtempSync(join(tmpdir(), "agent-tool-docker-"));
  try {
    writeFileSync(join(buildDir, "Dockerfile"), generateDockerfile(selectedTools));
    writeEntrypoint(buildDir);

    console.log("Building image...\n");
    await dockerBuild(buildDir, `${BASE_IMAGE_NAME}:latest`);
  } catch (e: any) {
    console.error(chalk.red(`Failed to build image: ${e.message}`));
    rmSync(buildDir, { recursive: true, force: true });
    process.exit(1);
  }
  rmSync(buildDir, { recursive: true, force: true });

  // Verify selected tools
  const checks = selectedTools
    .map((id) => TOOLS.find((t) => t.id === id)!)
    .filter((t) => t.verify)
    .map((t) => t.verify!);

  if (checks.length > 0) {
    console.log("\nVerifying installations...");
    const ENV_SETUP = "source ~/.nvm/nvm.sh 2>/dev/null; export PATH=$HOME/.bun/bin:$PATH;";

    // Run a temporary container for verification
    const verifyContainer = "agent-tool-verify-tmp";
    try {
      execFileSync("docker", ["run", "-d", "--rm", "--name", verifyContainer, `${BASE_IMAGE_NAME}:latest`], {
        stdio: "ignore",
      });
      // Wait a moment for entrypoint to run
      await new Promise((r) => setTimeout(r, 2000));

      for (const check of checks) {
        try {
          const { stdout } = await docker.runCommand(verifyContainer, [
            "sudo", "-u", "ubuntu", "bash", "-c", `${ENV_SETUP} ${check.cmd}`,
          ]);
          console.log(chalk.green(`  ${check.name}: ${stdout.trim().split("\n")[0]}`));
        } catch {
          console.log(
            chalk.yellow(`  ${check.name}: not found (may need manual install)`)
          );
        }
      }
    } finally {
      try {
        execFileSync("docker", ["rm", "-f", verifyContainer], { stdio: "ignore" });
      } catch {}
    }
  }

  // Tag as base snapshot
  try {
    execFileSync("docker", ["tag", `${BASE_IMAGE_NAME}:latest`, `${BASE_IMAGE_NAME}:base`], {
      stdio: "ignore",
    });
  } catch {}

  console.log(chalk.green("\nBase image ready.\n"));
}

/** Find the next available container index. */
async function nextContainerIndex(): Promise<number> {
  const containers = await docker.list();
  const existing = containers
    .filter((c) => c.name.startsWith("agent-tool-"))
    .map((c) => {
      const match = c.name.match(/^agent-tool-(\d+)$/);
      return match ? parseInt(match[1], 10) : 0;
    })
    .filter((n) => n > 0);

  if (existing.length === 0) return 1;
  return Math.max(...existing) + 1;
}

export async function init(countStr?: string): Promise<void> {
  const count = countStr ? parseInt(countStr, 10) : 1;
  if (isNaN(count) || count < 1) {
    console.error(chalk.red("Count must be a positive number."));
    process.exit(1);
  }

  await docker.checkDocker();
  await ensureBaseImage();

  const startIndex = await nextContainerIndex();

  console.log(chalk.bold(`Creating ${count} container(s)...\n`));

  for (let i = 0; i < count; i++) {
    const index = startIndex + i;
    const name = vmName(index);

    console.log(`Creating ${name}...`);
    try {
      await docker.clone(BASE_IMAGE_NAME, name);
    } catch (e: any) {
      console.error(chalk.red(`Failed to create container: ${e.message}`));
      process.exit(1);
    }

    await mountAuth(name);
    console.log(chalk.green(`  ${name}: ready`));
  }

  console.log(
    chalk.bold.green(
      `\n${count} container(s) created (${vmName(startIndex)}${count > 1 ? ` – ${vmName(startIndex + count - 1)}` : ""}). Use "agent-tool-docker setup <N>" to add a project.`
    )
  );
}
