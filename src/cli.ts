#!/usr/bin/env node
import { Command } from "commander";
import { init } from "./commands/init.js";
import { start } from "./commands/start.js";
import { stop } from "./commands/stop.js";
import { status } from "./commands/status.js";

const program = new Command();

program
  .name("agent-tool")
  .description(
    "Run multiple AI coding agents in parallel using isolated Multipass VMs"
  )
  .version("0.1.0");

program
  .command("init")
  .description("Initialize current project for agent-tool (run from a git repo)")
  .action(init);

program
  .command("start [count]")
  .description("Boot N agent VMs (or resume existing ones with no count)")
  .action(start);

program
  .command("stop")
  .description("Stop all agent VMs for this project")
  .action(stop);

program
  .command("status")
  .description("Show agent VMs, their state, IPs, and branches")
  .action(status);

program
  .command("sync-push <path>")
  .description("Copy a file or directory from host to all VMs")
  .action((path: string) => {
    console.log(`TODO: sync-push ${path}`);
  });

program
  .command("sync-pull <agent> <path>")
  .description("Copy a file or directory from a specific VM to host")
  .action((agent: string, path: string) => {
    console.log(`TODO: sync-pull ${agent} ${path}`);
  });

program.parse();
