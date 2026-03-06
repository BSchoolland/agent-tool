# agent-tool

Run multiple AI coding agents (Claude Code, etc.) in parallel without them interfering with each other. Each agent gets its own Multipass VM — a real machine with full Docker support, isolated filesystem, and independent git branch.

The mental model: **a team of developers on separate machines, coordinated by a lead dev (you) via git.**

## Prerequisites

- Linux or macOS (Windows is not currently supported)
- [Multipass](https://multipass.run/) installed and running
- [tmux](https://github.com/tmux/tmux) installed
- Node.js 20+

## Install

```bash
npm install -g agent-tool
```

## Usage

### One-time setup

```bash
agent-tool init
```

Creates a base VM image with Claude Code, gh CLI, and common runtimes (Node, Python, Rust, Bun, etc.). Takes ~10 minutes, done once.

### Per-project setup

```bash
agent-tool setup my-project
```

Boots a VM from the base image, copies your project in, and lets you install project-specific dependencies. Snapshots the result. Done once per project.

### Daily workflow

```bash
# Boot 4 VMs, each on its own git branch, in a tmux session
agent-tool start 4

# Check what's running
agent-tool status

# Sync .env file to all VMs
agent-tool sync-push .env

# Pull output from a specific agent
agent-tool sync-pull agent-2 ./output.log

# Shut down at end of day
agent-tool stop
```

Each VM gets:
- Its own git branch (`agent-1/...`, `agent-2/...`, etc.)
- Port forwarding (VM:3000 -> host:3001, 3002, ...)
- Your credentials mounted in (`~/.claude`, `~/.ssh`, `~/.config/gh`)

### File sync

```bash
agent-tool sync-push .env              # host -> all VMs
agent-tool sync-push ./examples         # directories too
agent-tool sync-pull agent-2 ./out.log  # specific VM -> host
```

For syncing gitignored content like `.env`, reference files, etc. Files are explicitly synced on demand, never automatically shared.

## Architecture

- **Isolation**: Multipass VMs (KVM on Linux, QEMU on macOS)
- **Coordination**: Git branches — same as a human dev team
- **Terminals**: tmux session with one pane per agent
- **Auth sharing**: Host credentials copied into VMs
- **File sync**: multipass transfer on demand

## What this tool does NOT do

- Assign tasks to agents (you tell each agent what to do)
- Coordinate between agents (they don't know about each other)
- Auto-merge branches or resolve conflicts
- Provide a dashboard or unified UI

This is **infrastructure**, not an agent. It lets existing agents run in parallel safely.

## License

MIT
