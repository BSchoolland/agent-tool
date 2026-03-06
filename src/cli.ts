#!/usr/bin/env node
import { Command } from "commander";
import { init } from "./commands/init.js";

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
  .command("start <count>")
  .description("Boot N VMs from project snapshot, open tmux session")
  .action((count: string) => {
    console.log(`TODO: start ${count} VMs`);
  });

program
  .command("stop")
  .description("Shut down all running VMs")
  .action(() => {
    console.log("TODO: stop");
  });

program
  .command("status")
  .description("Show running VMs, branches, and port mappings")
  .action(() => {
    console.log("TODO: status");
  });

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
