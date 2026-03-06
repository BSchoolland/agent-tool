import { execFileSync } from "node:child_process";
import { basename } from "node:path";
import chalk from "chalk";

export function getRepoName(): string {
  try {
    const url = execFileSync("git", ["remote", "get-url", "origin"], {
      encoding: "utf-8",
    }).trim();
    return basename(url).replace(/\.git$/, "");
  } catch {
    console.error(
      chalk.red(
        "Not a git repository or no 'origin' remote found. Run this from a project directory with a git remote."
      )
    );
    process.exit(1);
  }
}

export function projectVMName(project: string): string {
  return `at-${project}`;
}

export function agentVMName(project: string, index: number): string {
  return `at-${project}-${index}`;
}
