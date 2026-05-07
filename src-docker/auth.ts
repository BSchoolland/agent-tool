import chalk from "chalk";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import * as docker from "./docker.js";

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
    else if (inUsers && /^\s{8}(\S+):/.test(line)) {
      const match = line.match(/^\s{8}(\S+):/);
      if (match) usernames.push(match[1]);
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

async function setupCodingTools(containerName: string): Promise<void> {
  // Auth dirs are bind-mounted at container creation time.
  // Fix ownership so ubuntu user can write to them.
  try {
    await docker.runCommand(containerName, [
      "sudo", "bash", "-c",
      "for d in /home/ubuntu/.claude /home/ubuntu/.codex /home/ubuntu/.config /home/ubuntu/.config/opencode /home/ubuntu/.cache/opencode; do [ -d \"$d\" ] && chown ubuntu:ubuntu \"$d\"; done; true",
    ]);
  } catch {}

  // Copy single files that can't be bind-mounted.

  // Copy ~/.claude.json into the container (can't bind-mount a single file reliably)
  const claudeJson = join(homedir(), ".claude.json");
  if (existsSync(claudeJson)) {
    try {
      const content = readFileSync(claudeJson, "utf-8");
      await docker.runCommand(containerName, [
        "sudo", "-u", "ubuntu", "bash", "-c",
        `cat > /home/ubuntu/.claude.json << 'CLAUDE_JSON_EOF'\n${content}\nCLAUDE_JSON_EOF\nchmod 600 /home/ubuntu/.claude.json`,
      ]);
    } catch (e: any) {
      console.log(chalk.yellow(`  Warning: could not copy ~/.claude.json: ${e.message}`));
    }
  }
}

async function setupGhAuth(containerName: string): Promise<void> {
  const accounts = getGhAccounts();
  if (accounts.length === 0) return;

  // Ensure ~/.config/gh exists and is writable by ubuntu (container runs as ubuntu, but .config may be root-owned from bind mounts)
  try {
    await docker.runCommand(containerName, [
      "sudo", "bash", "-c", "mkdir -p /home/ubuntu/.config/gh && chown -R ubuntu:ubuntu /home/ubuntu/.config/gh",
    ]);
  } catch {}

  for (const account of accounts) {
    try {
      await docker.runCommand(containerName, [
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

async function setupSshKeys(containerName: string): Promise<void> {
  const sshDir = join(homedir(), ".ssh");
  if (!existsSync(sshDir)) return;

  // Ensure ~/.ssh exists in container with correct permissions
  await docker.runCommand(containerName, [
    "sudo", "-u", "ubuntu", "bash", "-c",
    "mkdir -p ~/.ssh && chmod 700 ~/.ssh",
  ]);

  // Copy all key files (id_*) and config
  const entries = readdirSync(sshDir);
  const toCopy = entries.filter(
    (f) => f.startsWith("id_") || f === "config"
  );

  for (const file of toCopy) {
    const filePath = join(sshDir, file);
    try {
      const content = readFileSync(filePath, "utf-8");
      const isPrivate = !file.endsWith(".pub") && file !== "config";
      const perms = isPrivate ? "600" : "644";
      await docker.runCommand(containerName, [
        "sudo", "-u", "ubuntu", "bash", "-c",
        `cat > ~/.ssh/${basename(file)} << 'SSH_KEY_EOF'\n${content}\nSSH_KEY_EOF\nchmod ${perms} ~/.ssh/${basename(file)}`,
      ]);
    } catch (e: any) {
      console.log(chalk.yellow(`  Warning: could not copy SSH key ${file}: ${e.message}`));
    }
  }

  // Add GitHub to known_hosts
  try {
    await docker.runCommand(containerName, [
      "sudo", "-u", "ubuntu", "bash", "-c",
      "ssh-keyscan github.com >> ~/.ssh/known_hosts 2>/dev/null",
    ]);
  } catch {}
}

export async function mountAuth(containerName: string): Promise<void> {
  await setupGhAuth(containerName);
  await setupSshKeys(containerName);
  await setupCodingTools(containerName);
}
