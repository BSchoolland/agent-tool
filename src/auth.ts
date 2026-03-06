import chalk from "chalk";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import * as multipass from "./multipass.js";

interface GhAccount {
  username: string;
  host: string;
  token: string;
}

function getGhAccounts(): GhAccount[] {
  const hostsPath = join(homedir(), ".config", "gh", "hosts.yml");
  if (!existsSync(hostsPath)) return [];

  const content = readFileSync(hostsPath, "utf-8");
  const accounts: GhAccount[] = [];

  // Parse hosts.yml to find host, usernames, and active user
  let currentHost: string | null = null;
  let activeUser: string | null = null;
  let inUsers = false;
  const usernames: string[] = [];

  for (const line of content.split("\n")) {
    // Top-level host (e.g. "github.com:")
    if (/^\S+:/.test(line) && !line.startsWith(" ")) {
      currentHost = line.replace(":", "").trim();
      inUsers = false;
      activeUser = null;
      usernames.length = 0;
    }
    // "users:" section
    else if (/^\s+users:\s*$/.test(line)) {
      inUsers = true;
    }
    // "user: <active>" line
    else if (/^\s+user:\s+\S+/.test(line)) {
      activeUser = line.split(":")[1].trim();
      inUsers = false;
    }
    // Username entry under users (deeper indent than "users:")
    else if (inUsers && /^\s{8}\S+:\s*$/.test(line)) {
      usernames.push(line.replace(":", "").trim());
    }
    // Any line at users-level indent or less exits users section
    else if (inUsers && /^\s{0,4}\S/.test(line)) {
      inUsers = false;
    }
  }

  if (!currentHost || usernames.length === 0) return [];

  // Get tokens for each user, active account last so it becomes the default
  const ordered = usernames.filter((u) => u !== activeUser);
  if (activeUser && usernames.includes(activeUser)) {
    ordered.push(activeUser);
  }

  for (const username of ordered) {
    try {
      const token = execFileSync("gh", ["auth", "token", "-u", username], {
        encoding: "utf-8",
      }).trim();
      if (token) {
        accounts.push({ username, host: currentHost, token });
      }
    } catch {
      // Token not available for this user
    }
  }

  return accounts;
}

async function setupClaudeAuth(vmName: string): Promise<void> {
  const credentialsPath = join(homedir(), ".claude", ".credentials.json");
  if (!existsSync(credentialsPath)) return;

  try {
    // Ensure .claude directory exists in VM
    await multipass.runCommand(vmName, [
      "sudo", "-u", "ubuntu", "mkdir", "-p", "/home/ubuntu/.claude",
    ]);
    // Read credentials and write into VM via stdin (avoids snap SFTP permission issues)
    const credentials = readFileSync(credentialsPath, "utf-8");
    await multipass.runCommand(vmName, [
      "sudo", "-u", "ubuntu", "bash", "-c",
      `cat > /home/ubuntu/.claude/.credentials.json << 'CREDENTIALS_EOF'\n${credentials}\nCREDENTIALS_EOF\nchmod 600 /home/ubuntu/.claude/.credentials.json`,
    ]);
  } catch (e: any) {
    console.log(chalk.yellow(`  Warning: could not set up Claude auth: ${e.message}`));
  }
}

async function setupGhAuth(vmName: string): Promise<void> {
  const accounts = getGhAccounts();
  if (accounts.length === 0) return;

  for (const account of accounts) {
    try {
      await multipass.runCommand(vmName, [
        "sudo", "-u", "ubuntu", "bash", "-lc",
        `echo '${account.token}' | gh auth login --hostname ${account.host} --with-token`,
      ]);
    } catch (e: any) {
      console.log(
        chalk.yellow(`  Warning: could not set up gh auth for ${account.username}: ${e.message}`)
      );
    }
  }
}

export async function mountAuth(vmName: string): Promise<void> {
  await setupGhAuth(vmName);
  await setupClaudeAuth(vmName);
}
