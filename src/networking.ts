import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import * as multipass from "./multipass.js";

const STATE_FILE = "/tmp/agent-tool-hosted";

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

function sudo(args: string[]): void {
  execFileSync("sudo", args, { stdio: "inherit" });
}

function addIptablesRules(vmIp: string): void {
  // Enable routing to loopback from external interfaces
  sudo(["sysctl", "-w", "net.ipv4.conf.all.route_localnet=1"]);

  // Redirect localhost TCP traffic (non-privileged ports) to VM — IPv4
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
  // Tear down existing forwarding first
  await unhostAgent();

  // Get VM IP
  const vms = await multipass.list();
  const vm = vms.find((v) => v.name === vmName);
  if (!vm || !vm.ipv4) {
    throw new Error(`Cannot find IP for VM ${vmName}. Is it running?`);
  }

  addIptablesRules(vm.ipv4);
  writeState({ agentIndex, vmName, vmIp: vm.ipv4 });
}

export async function unhostAgent(): Promise<void> {
  const state = getHostedAgent();
  if (!state) return;

  removeIptablesRules(state.vmIp);
  clearState();
}
