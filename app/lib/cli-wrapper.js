const { execFile } = require('child_process');
const { readFile, stat } = require('fs/promises');
const { join } = require('path');

function exec(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { encoding: 'utf-8', ...opts }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        reject(err);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

async function list() {
  const { stdout } = await exec('multipass', ['list', '--format', 'json']);
  const data = JSON.parse(stdout);
  const vms = (data.list || [])
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
  return vms;
}

async function start(vmIndex) {
  return exec('agent-tool', ['start', String(vmIndex)]);
}

async function stop(vmIndex) {
  return exec('agent-tool', ['stop', String(vmIndex)]);
}

async function host(vmIndex) {
  return exec('sudo', ['agent-tool', 'host', String(vmIndex)]);
}

async function unhost() {
  return exec('sudo', ['agent-tool', 'host']);
}

async function getHosted() {
  try {
    const data = await readFile('/tmp/agent-tool-hosted', 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function getBranch(vmIndex, project) {
  const vmName = `agent-tool-${vmIndex}`;
  try {
    const { stdout } = await exec('multipass', [
      'exec', vmName, '--', 'git', '-C', `/home/ubuntu/${project}`, 'branch', '--show-current',
    ]);
    return stdout.trim();
  } catch {
    return null;
  }
}

async function computeSize(dirPath) {
  const { stat: fstat } = require('fs/promises');
  const { readdir } = require('fs/promises');
  const path = require('path');

  let total = 0;
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        const s = await fstat(full);
        total += s.size;
      }
    }
  }

  const s = await fstat(dirPath);
  if (s.isDirectory()) {
    await walk(dirPath);
  } else {
    total = s.size;
  }
  return total;
}

async function syncPush(vmIndex, localPath, cwd) {
  return exec('agent-tool', ['sync-push', String(vmIndex), localPath], { cwd });
}

module.exports = { list, start, stop, host, unhost, getHosted, getBranch, computeSize, syncPush };
