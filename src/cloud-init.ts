export function getBaseCloudInit(): string {
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
  # Node.js via nvm
  - su - ubuntu -c "curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash"
  - su - ubuntu -c ". ~/.nvm/nvm.sh && nvm install --lts && nvm alias default node"

  # Bun
  - su - ubuntu -c "curl -fsSL https://bun.sh/install | bash"

  # Python (usually pre-installed on Ubuntu, ensure pip)
  - apt-get install -y python3-pip python3-venv

  # Rust
  - su - ubuntu -c "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y"

  # GitHub CLI
  - |
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
    chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null
    apt-get update
    apt-get install -y gh

  # Claude Code
  - su - ubuntu -c ". ~/.nvm/nvm.sh && npm install -g @anthropic-ai/claude-code"

  # Docker
  - |
    curl -fsSL https://get.docker.com | sh
    usermod -aG docker ubuntu
`;
}
