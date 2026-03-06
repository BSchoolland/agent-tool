#!/usr/bin/env node
import { Command } from "commander";
import { init } from "./commands/init.js";
import { start } from "./commands/start.js";
import { stop } from "./commands/stop.js";
import { status } from "./commands/status.js";
import { open } from "./commands/open.js";
import { syncPush, syncPull } from "./commands/sync.js";

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
  .command("open [agent] [port]")
  .description("Open an agent's dev server in the browser")
  .action(open);

program
  .command("sync-push <path>")
  .description("Copy a file or directory from host to all running agent VMs")
  .action(syncPush);

program
  .command("sync-pull <agent> <path>")
  .description("Copy a file or directory from a specific VM to host")
  .action(syncPull);

program.parse();
