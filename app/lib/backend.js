const { readFileSync, writeFileSync, mkdirSync } = require('fs');
const { join } = require('path');
const { homedir } = require('os');

const CONFIG_DIR = join(homedir(), '.config', 'agent-tool');
const CONFIG_FILE = join(CONFIG_DIR, 'app-settings.json');

const BACKENDS = {
  multipass: {
    execCmd: 'multipass',
    cliCmd: 'agent-tool',
    stateFile: '/tmp/agent-tool-hosted',
    listArgs: ['list', '--format', 'json'],
    parseList(stdout) {
      const data = JSON.parse(stdout);
      return (data.list || [])
        .filter(vm => /^agent-tool-\d+$/.test(vm.name))
        .map(vm => {
          const match = vm.name.match(/agent-tool-(\d+)/);
          return {
            name: vm.name,
            index: match ? parseInt(match[1], 10) : 0,
            state: vm.state,
            ipv4: vm.ipv4 && vm.ipv4.length > 0 ? vm.ipv4[0] : null,
          };
        })
        .sort((a, b) => a.index - b.index);
    },
    execArgs(vmName, cmd) {
      return ['exec', vmName, '--', ...cmd];
    },
    terminalArgs(vmName, project) {
      if (project) {
        return {
          cmd: 'multipass',
          args: ['exec', vmName, '--', 'bash', '--login', '-c',
            `cd /home/ubuntu/${project} && exec bash --login`],
        };
      }
      return {
        cmd: 'multipass',
        args: ['exec', vmName, '--', 'bash', '--login'],
      };
    },
  },
  docker: {
    execCmd: 'docker',
    cliCmd: 'agent-tool-docker',
    stateFile: '/tmp/agent-tool-docker-hosted',
    listArgs: ['ps', '-a', '--filter', 'label=agent-tool', '--format', '{{json .}}'],
    parseList(stdout) {
      const containers = [];
      for (const line of stdout.trim().split('\n')) {
        if (!line) continue;
        const data = JSON.parse(line);
        const name = data.Names;
        if (!/^agent-tool-\d+$/.test(name)) continue;
        const match = name.match(/agent-tool-(\d+)/);
        containers.push({
          name,
          index: match ? parseInt(match[1], 10) : 0,
          state: data.State === 'running' ? 'Running' : 'Stopped',
          ipv4: null, // filled in by cli-wrapper after inspect
        });
      }
      return containers.sort((a, b) => a.index - b.index);
    },
    execArgs(vmName, cmd) {
      return ['exec', vmName, ...cmd];
    },
    terminalArgs(vmName, project) {
      if (project) {
        return {
          cmd: 'docker',
          args: ['exec', '-it', vmName, 'bash', '--login', '-c',
            `cd /home/ubuntu/${project} && exec bash --login`],
        };
      }
      return {
        cmd: 'docker',
        args: ['exec', '-it', vmName, 'bash', '--login'],
      };
    },
  },
};

function load() {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function save(data) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2));
}

function getBackendName() {
  return load().backend || 'multipass';
}

function setBackendName(name) {
  if (!BACKENDS[name]) throw new Error(`Unknown backend: ${name}`);
  const data = load();
  data.backend = name;
  save(data);
}

function getBackend() {
  return BACKENDS[getBackendName()];
}

module.exports = { getBackend, getBackendName, setBackendName, BACKENDS };
