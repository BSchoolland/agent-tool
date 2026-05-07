const { execFile } = require('child_process');
const { readFile, stat } = require('fs/promises');
const { join } = require('path');
const { getBackend } = require('./backend');

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

async function getDockerIP(vmName) {
  try {
    const { stdout } = await exec('docker', [
      'inspect', '--format', '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}', vmName,
    ]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function list() {
  const backend = getBackend();
  const { stdout } = await exec(backend.execCmd, backend.listArgs);
  const vms = backend.parseList(stdout);

  // Docker needs a separate inspect call for IPs
  if (backend === require('./backend').BACKENDS.docker) {
    await Promise.all(
      vms.filter(vm => vm.state === 'Running').map(async (vm) => {
        vm.ipv4 = await getDockerIP(vm.name);
      })
    );
  }

  return vms;
}

async function start(vmIndex) {
  const backend = getBackend();
  return exec(backend.cliCmd, ['start', String(vmIndex)]);
}

async function stop(vmIndex) {
  const backend = getBackend();
  return exec(backend.cliCmd, ['stop', String(vmIndex)]);
}

async function host(vmIndex) {
  const backend = getBackend();
  return exec(backend.cliCmd, ['host', String(vmIndex)]);
}

async function unhost() {
  const backend = getBackend();
  return exec(backend.cliCmd, ['host']);
}

async function getHosted() {
  const backend = getBackend();
  try {
    const data = await readFile(backend.stateFile, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function getBranch(vmIndex, project) {
  const backend = getBackend();
  const vmName = `agent-tool-${vmIndex}`;
  try {
    const { stdout } = await exec(backend.execCmd,
      backend.execArgs(vmName, ['git', '-C', `/home/ubuntu/${project}`, 'branch', '--show-current'])
    );
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
  const backend = getBackend();
  return exec(backend.cliCmd, ['sync-push', String(vmIndex), localPath], { cwd });
}

module.exports = { list, start, stop, host, unhost, getHosted, getBranch, computeSize, syncPush };
