import { execSync } from "node:child_process";

export interface Tool {
  id: string;
  label: string;
  detect: () => boolean;
  cloudInit: string;
  verify?: { name: string; cmd: string };
}

function which(bin: string): boolean {
  try {
    execSync(`which ${bin}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export const TOOLS: Tool[] = [
  {
    id: "node",
    label: "Node.js (via nvm)",
    detect: () => which("node"),
    cloudInit: [
      '  # Node.js via nvm',
      '  - su - ubuntu -c "curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash"',
      '  - su - ubuntu -c ". ~/.nvm/nvm.sh && nvm install --lts && nvm alias default node"',
    ].join("\n"),
    verify: { name: "node", cmd: "node --version" },
  },
  {
    id: "bun",
    label: "Bun",
    detect: () => which("bun"),
    cloudInit: [
      '  # Bun',
      '  - su - ubuntu -c "curl -fsSL https://bun.sh/install | bash"',
    ].join("\n"),
    verify: { name: "bun", cmd: "bun --version" },
  },
  {
    id: "python",
    label: "Python 3 + pip",
    detect: () => which("python3"),
    cloudInit: [
      '  # Python 3 + pip',
      '  - apt-get install -y python3-pip python3-venv',
    ].join("\n"),
    verify: { name: "python3", cmd: "python3 --version" },
  },
  {
    id: "docker",
    label: "Docker",
    detect: () => which("docker"),
    cloudInit: [
      '  # Docker',
      '  - |',
      '    curl -fsSL https://get.docker.com | sh',
      '    usermod -aG docker ubuntu',
    ].join("\n"),
    verify: { name: "docker", cmd: "docker --version" },
  },
  {
    id: "gh",
    label: "GitHub CLI",
    detect: () => which("gh"),
    cloudInit: [
      '  # GitHub CLI',
      '  - |',
      '    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg',
      '    chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg',
      '    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null',
      '    apt-get update',
      '    apt-get install -y gh',
    ].join("\n"),
    verify: { name: "gh", cmd: "gh --version" },
  },
  {
    id: "claude",
    label: "Claude Code",
    detect: () => which("claude"),
    cloudInit: [
      '  # Claude Code',
      '  - su - ubuntu -c ". ~/.nvm/nvm.sh && npm install -g @anthropic-ai/claude-code"',
    ].join("\n"),
    verify: { name: "claude", cmd: "claude --version" },
  },
  {
    id: "codex",
    label: "Codex",
    detect: () => which("codex"),
    cloudInit: [
      '  # Codex',
      '  - su - ubuntu -c ". ~/.nvm/nvm.sh && npm install -g @openai/codex"',
    ].join("\n"),
    verify: { name: "codex", cmd: "codex --version" },
  },
  {
    id: "opencode",
    label: "OpenCode",
    detect: () => which("opencode"),
    cloudInit: [
      '  # OpenCode',
      '  - su - ubuntu -c "curl -fsSL https://opencode.ai/install | bash"',
    ].join("\n"),
    verify: { name: "opencode", cmd: "opencode --version" },
  },
  {
    id: "go",
    label: "Go",
    detect: () => which("go"),
    cloudInit: [
      '  # Go',
      '  - |',
      '    curl -fsSL https://go.dev/dl/go1.23.4.linux-amd64.tar.gz | tar -C /usr/local -xz',
      '    echo "export PATH=\\$PATH:/usr/local/go/bin:\\$HOME/go/bin" >> /home/ubuntu/.bashrc',
    ].join("\n"),
    verify: { name: "go", cmd: "/usr/local/go/bin/go version" },
  },
  {
    id: "rust",
    label: "Rust (via rustup)",
    detect: () => which("rustc"),
    cloudInit: [
      '  # Rust via rustup',
      '  - su - ubuntu -c "curl --proto =https --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y"',
    ].join("\n"),
    verify: { name: "rust", cmd: "rustc --version" },
  },
  {
    id: "java",
    label: "Java (OpenJDK 21)",
    detect: () => which("java"),
    cloudInit: [
      '  # Java OpenJDK 21',
      '  - apt-get install -y openjdk-21-jdk',
    ].join("\n"),
    verify: { name: "java", cmd: "java --version" },
  },
  {
    id: "ruby",
    label: "Ruby",
    detect: () => which("ruby"),
    cloudInit: [
      '  # Ruby',
      '  - apt-get install -y ruby-full',
    ].join("\n"),
    verify: { name: "ruby", cmd: "ruby --version" },
  },
  {
    id: "awscli",
    label: "AWS CLI",
    detect: () => which("aws"),
    cloudInit: [
      '  # AWS CLI',
      '  - |',
      '    curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip',
      '    unzip -q /tmp/awscliv2.zip -d /tmp',
      '    /tmp/aws/install',
      '    rm -rf /tmp/aws /tmp/awscliv2.zip',
    ].join("\n"),
    verify: { name: "aws", cmd: "aws --version" },
  },
  {
    id: "kubectl",
    label: "kubectl",
    detect: () => which("kubectl"),
    cloudInit: [
      '  # kubectl',
      '  - |',
      '    curl -fsSL "https://dl.k8s.io/release/$(curl -fsSL https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl" -o /usr/local/bin/kubectl',
      '    chmod +x /usr/local/bin/kubectl',
    ].join("\n"),
    verify: { name: "kubectl", cmd: "kubectl version --client" },
  },
  {
    id: "terraform",
    label: "Terraform",
    detect: () => which("terraform"),
    cloudInit: [
      '  # Terraform',
      '  - |',
      '    curl -fsSL https://apt.releases.hashicorp.com/gpg | gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg',
      '    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" | tee /etc/apt/sources.list.d/hashicorp.list > /dev/null',
      '    apt-get update',
      '    apt-get install -y terraform',
    ].join("\n"),
    verify: { name: "terraform", cmd: "terraform version" },
  },
];

export function getBaseCloudInit(toolIds: string[]): string {
  const selected = TOOLS.filter((t) => toolIds.includes(t.id));

  const runcmdBlocks = selected.map((t) => t.cloudInit).join("\n\n");

  return `#cloud-config
package_update: true
package_upgrade: true

packages:
  - git
  - curl
  - wget
  - unzip
  - build-essential
  - tmux
  - rsync
  - jq

runcmd:
${runcmdBlocks}

  # Clean up caches to shrink the image
  - apt-get clean
  - rm -rf /var/cache/apt/archives/*
  - su - ubuntu -c "rm -rf ~/.npm/_cacache ~/.nvm/.cache"
  - fstrim -av
`;
}
