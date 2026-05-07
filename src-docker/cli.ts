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
  .name("agent-tool-docker")
  .description(
    "Run multiple AI coding agents in parallel using isolated Docker containers"
  )
  .version("0.1.0");

program
  .command("init [count]")
  .description("Create agent containers (default 1)")
  .action(init);

program
  .command("setup <container>")
  .description("Copy current project to a container and drop into shell for setup")
  .action(setup);

program
  .command("start [container...]")
  .description("Start stopped containers (all if none specified)")
  .action(start);

program
  .command("stop [container...]")
  .description("Stop running containers (all if none specified)")
  .action(stop);

program
  .command("status")
  .description("Show all agent containers and their state")
  .action(status);

program
  .command("host [container]")
  .description("Forward localhost to a container (no arg to stop hosting)")
  .action(host);

program
  .command("connect <container>")
  .description("Shell into a container (e.g. agent-tool-docker connect 3)")
  .action(connect);

program
  .command("sync-push <container> <path>")
  .description("Copy a file or directory from host to a container")
  .action(syncPush);

program
  .command("sync-pull <container> <path>")
  .description("Copy a file or directory from a container to host")
  .action(syncPull);

program.parse();
