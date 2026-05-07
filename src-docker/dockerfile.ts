import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { TOOLS } from "../src/cloud-init.js";

/**
 * Convert a cloud-init runcmd block to a Dockerfile RUN directive.
 * Strips YAML list prefixes and multiline markers, chains with &&.
 */
function cloudInitToRun(cloudInit: string): string {
  const lines = cloudInit.split("\n");
  const commands: string[] = [];

  for (const line of lines) {
    // Skip comment-only lines
    const stripped = line.replace(/^\s*-\s*\|?\s*/, "").replace(/^\s*#.*/, "").trim();
    if (!stripped) continue;
    // Skip lines that are just YAML markers
    if (stripped === "|") continue;
    commands.push(stripped);
  }

  if (commands.length === 0) return "";
  return `RUN ${commands.join(" && \\\n    ")}`;
}

export function generateDockerfile(toolIds: string[]): string {
  const selected = TOOLS.filter((t) => toolIds.includes(t.id));

  // Filter out docker tool — it's always installed in the base image
  const toolBlocks = selected
    .filter((t) => t.id !== "docker")
    .map((t) => {
      const runBlock = cloudInitToRun(t.cloudInit);
      return runBlock ? `# ${t.label}\n${runBlock}` : "";
    })
    .filter(Boolean);

  // Tools that use `su - ubuntu` need to run as root during build,
  // and the USER directive comes after all tool installs.
  const toolSection = toolBlocks.length > 0
    ? "\n" + toolBlocks.join("\n\n") + "\n"
    : "";

  return `FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get upgrade -y && \\
    apt-get install -y git curl wget unzip build-essential tmux rsync jq sudo && \\
    apt-get clean && rm -rf /var/cache/apt/archives/*

RUN id ubuntu &>/dev/null || useradd -m -s /bin/bash ubuntu && \\
    usermod -aG sudo ubuntu && \\
    echo "ubuntu ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers.d/ubuntu

# Docker (always installed for DinD)
RUN curl -fsSL https://get.docker.com | sh && usermod -aG docker ubuntu
${toolSection}
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER ubuntu
WORKDIR /home/ubuntu
ENTRYPOINT ["/entrypoint.sh"]
`;
}

export function writeEntrypoint(dir: string): void {
  const content = `#!/bin/bash
if command -v dockerd &>/dev/null; then
  dockerd &>/var/log/dockerd.log &
  for i in $(seq 1 30); do docker info &>/dev/null && break; sleep 1; done
fi
exec sleep infinity
`;
  writeFileSync(join(dir, "entrypoint.sh"), content, { mode: 0o755 });
}
