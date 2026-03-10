#!/usr/bin/env node
import { Command } from "commander";
import { init } from "./commands/init.js";
import { setup } from "./commands/setup.js";
import { start } from "./commands/start.js";
import { stop } from "./commands/stop.js";
import { status } from "./commands/status.js";
import { host } from "./commands/host.js";
import { syncPush, syncPull } from "./commands/sync.js";
import { connect } from "./commands/connect.js";

const program = new Command();

program
  .name("agent-tool")
  .description(
    "Run multiple AI coding agents in parallel using isolated Multipass VMs"
  )
  .version("0.1.0");

program
  .command("init [count]")
  .description("Create global agent VMs (default 1)")
  .action(init);

program
  .command("setup <vm>")
  .description("Copy current project to a VM and drop into shell for setup")
  .action(setup);

program
  .command("start [vm...]")
  .description("Start stopped VMs (all if none specified)")
  .action(start);

program
  .command("stop [vm...]")
  .description("Stop running VMs (all if none specified)")
  .action(stop);

program
  .command("status")
  .description("Show all agent VMs and their state")
  .action(status);

program
  .command("host [vm]")
  .description("Forward localhost to a VM (no arg to stop hosting)")
  .action(host);

program
  .command("connect <vm>")
  .description("SSH into a VM (e.g. agent-tool connect 3)")
  .action(connect);

program
  .command("sync-push <vm> <path>")
  .description("Copy a file or directory from host to a VM")
  .action(syncPush);

program
  .command("sync-pull <vm> <path>")
  .description("Copy a file or directory from a VM to host")
  .action(syncPull);

program.parse();
