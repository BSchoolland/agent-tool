import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import * as multipass from "./multipass.js";

const HOSTS_FILE = "/etc/hosts";
const MARKER_START = "# agent-tool:start";
const MARKER_END = "# agent-tool:end";

function agentHostname(agentIndex: number): string {
  return `agent-${agentIndex}.local`;
}

export async function setupVMNetworking(vmName: string, agentIndex: number): Promise<void> {
  const hostname = agentHostname(agentIndex);

  // Enable routing to loopback from external interfaces
  await multipass.runCommand(vmName, [
    "sudo", "sysctl", "-w", "net.ipv4.conf.all.route_localnet=1",
  ]);

  // DNAT all incoming TCP to localhost (makes localhost-bound services reachable via VM IP)
  await multipass.runCommand(vmName, [
    "sudo", "iptables", "-t", "nat", "-C", "PREROUTING",
    "-p", "tcp", "!", "-i", "lo", "-j", "DNAT", "--to-destination", "127.0.0.1",
  ]).catch(() =>
    multipass.runCommand(vmName, [
      "sudo", "iptables", "-t", "nat", "-A", "PREROUTING",
      "-p", "tcp", "!", "-i", "lo", "-j", "DNAT", "--to-destination", "127.0.0.1",
    ])
  );

  // Add hostname to VM's /etc/hosts so dev servers can bind to it
  await multipass.runCommand(vmName, [
    "sudo", "bash", "-c",
    `grep -q '${hostname}' /etc/hosts || echo '127.0.0.1 ${hostname}' >> /etc/hosts`,
  ]);

  // Set HOST env var so dev servers print clickable URLs
  await multipass.runCommand(vmName, [
    "sudo", "-u", "ubuntu", "bash", "-c",
    `grep -q 'HOST=${hostname}' ~/.bashrc || echo 'export HOST=${hostname}' >> ~/.bashrc`,
  ]);
}

export async function updateHostsFile(agents: { vmName: string; agentIndex: number }[]): Promise<void> {
  // Get IPs for all agents
  const entries: string[] = [];
  for (const agent of agents) {
    const vms = await multipass.list();
    const vm = vms.find((v) => v.name === agent.vmName);
    if (vm && vm.ipv4) {
      entries.push(`${vm.ipv4}  ${agentHostname(agent.agentIndex)}`);
    }
  }

  if (entries.length === 0) return;

  const hostsContent = readFileSync(HOSTS_FILE, "utf-8");

  // Remove existing agent-tool block
  const cleaned = removeAgentToolBlock(hostsContent);

  // Append new block
  const newBlock = `${MARKER_START}\n${entries.join("\n")}\n${MARKER_END}`;
  const updated = cleaned.trimEnd() + "\n" + newBlock + "\n";

  // Write via sudo tee
  execFileSync("sudo", ["tee", HOSTS_FILE], {
    input: updated,
    stdio: ["pipe", "ignore", "inherit"],
  });
}

export function cleanupHostsFile(): void {
  const hostsContent = readFileSync(HOSTS_FILE, "utf-8");
  const cleaned = removeAgentToolBlock(hostsContent);

  if (cleaned !== hostsContent) {
    execFileSync("sudo", ["tee", HOSTS_FILE], {
      input: cleaned,
      stdio: ["pipe", "ignore", "inherit"],
    });
  }
}

function removeAgentToolBlock(content: string): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let inBlock = false;

  for (const line of lines) {
    if (line.trim() === MARKER_START) {
      inBlock = true;
      continue;
    }
    if (line.trim() === MARKER_END) {
      inBlock = false;
      continue;
    }
    if (!inBlock) {
      result.push(line);
    }
  }

  return result.join("\n");
}

export function getAgentUrl(agentIndex: number, port: number): string {
  return `http://${agentHostname(agentIndex)}:${port}`;
}
