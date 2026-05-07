import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdtempSync, rmdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { userInfo, tmpdir } from "node:os";
import { join } from "node:path";
import chalk from "chalk";
import * as docker from "./docker.js";

const STATE_FILE = "/tmp/agent-tool-docker-hosted";
const SUDOERS_FILE = "/etc/sudoers.d/agent-tool";
const SUDOERS_CMDS = ["/usr/sbin/iptables", "/usr/sbin/ip6tables", "/usr/sbin/sysctl"];

interface HostState {
  agentIndex: number;
  vmName: string;
  vmIp: string;
}

export function getHostedAgent(): HostState | null {
  try {
    if (!existsSync(STATE_FILE)) return null;
    return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return null;
  }
}

function writeState(state: HostState): void {
  writeFileSync(STATE_FILE, JSON.stringify(state));
}

function clearState(): void {
  try {
    unlinkSync(STATE_FILE);
  } catch {
    // Already gone
  }
}

function hasSudoersRule(): boolean {
  return existsSync(SUDOERS_FILE);
}

export function installSudoersRule(): void {
  const user = userInfo().username;
  const rule = `${user} ALL=(root) NOPASSWD: ${SUDOERS_CMDS.join(", ")}\n`;

  // Write rule and install script to a unique temp dir
  const tmpDir = mkdtempSync(join(tmpdir(), "agent-tool-"));
  const tmpRule = join(tmpDir, "sudoers");
  const tmpScript = join(tmpDir, "install.sh");
  writeFileSync(tmpRule, rule, { mode: 0o644 });
  writeFileSync(tmpScript, [
    "#!/bin/sh",
    `set -e`,
    `cp "${tmpRule}" "${SUDOERS_FILE}"`,
    `chmod 440 "${SUDOERS_FILE}"`,
  ].join("\n"), { mode: 0o755 });

  try {
    // Validate syntax before installing (doesn't need root)
    execFileSync("visudo", ["-cf", tmpRule], { stdio: "inherit" });
    // Use pkexec for a graphical auth prompt that works without a TTY
    execFileSync("pkexec", [tmpScript], { stdio: "inherit" });
  } finally {
    try { unlinkSync(tmpRule); } catch {}
    try { unlinkSync(tmpScript); } catch {}
    try { rmdirSync(tmpDir); } catch {}
  }
}

export function ensureSudoers(): void {
  if (hasSudoersRule()) return;

  console.log(chalk.yellow(
    "Hosting requires iptables/sysctl access. Installing a passwordless sudoers rule\n" +
    "so future host/unhost operations won't prompt for a password.\n"
  ));
  console.log(chalk.dim(`  File: ${SUDOERS_FILE}`));
  console.log(chalk.dim(`  Commands: ${SUDOERS_CMDS.join(", ")}\n`));

  installSudoersRule();
  console.log(chalk.green("Sudoers rule installed.\n"));
}

function sudo(args: string[]): void {
  execFileSync("sudo", args, { stdio: "inherit" });
}

function addIptablesRules(vmIp: string): void {
  // Enable routing to loopback from external interfaces
  sudo(["sysctl", "-w", "net.ipv4.conf.all.route_localnet=1"]);

  // Redirect localhost TCP traffic (non-privileged ports) to container — IPv4
  sudo([
    "iptables", "-t", "nat", "-A", "OUTPUT",
    "-p", "tcp", "-d", "127.0.0.1",
    "--dport", "1024:65535",
    "-j", "DNAT", "--to-destination", vmIp,
  ]);

  // Reject IPv6 localhost so clients fall back to IPv4 (where DNAT applies)
  sudo([
    "ip6tables", "-A", "OUTPUT",
    "-p", "tcp", "-d", "::1",
    "--dport", "1024:65535",
    "-j", "REJECT", "--reject-with", "icmp6-addr-unreachable",
  ]);

  // Masquerade so return traffic routes correctly
  sudo([
    "iptables", "-t", "nat", "-A", "POSTROUTING",
    "-p", "tcp", "-d", vmIp,
    "--dport", "1024:65535",
    "-j", "MASQUERADE",
  ]);
}

function removeIptablesRules(vmIp: string): void {
  try {
    sudo([
      "iptables", "-t", "nat", "-D", "OUTPUT",
      "-p", "tcp", "-d", "127.0.0.1",
      "--dport", "1024:65535",
      "-j", "DNAT", "--to-destination", vmIp,
    ]);
  } catch {
    // Rule may not exist
  }

  try {
    sudo([
      "ip6tables", "-D", "OUTPUT",
      "-p", "tcp", "-d", "::1",
      "--dport", "1024:65535",
      "-j", "REJECT", "--reject-with", "icmp6-addr-unreachable",
    ]);
  } catch {
    // Rule may not exist
  }

  try {
    sudo([
      "iptables", "-t", "nat", "-D", "POSTROUTING",
      "-p", "tcp", "-d", vmIp,
      "--dport", "1024:65535",
      "-j", "MASQUERADE",
    ]);
  } catch {
    // Rule may not exist
  }
}

export async function hostAgent(vmName: string, agentIndex: number): Promise<void> {
  ensureSudoers();

  // Tear down existing forwarding first
  await unhostAgent();

  // Get container IP
  const vmIp = await docker.getIP(vmName);
  if (!vmIp) {
    throw new Error(`Cannot find IP for container ${vmName}. Is it running?`);
  }

  addIptablesRules(vmIp);
  writeState({ agentIndex, vmName, vmIp });
}

export async function unhostAgent(): Promise<void> {
  const state = getHostedAgent();
  if (!state) return;

  removeIptablesRules(state.vmIp);
  clearState();
}
