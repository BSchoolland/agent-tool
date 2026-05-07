const pty = require('node-pty');
const crypto = require('crypto');
const { getBackend } = require('./backend');

const sessions = new Map();

function createSession(vmIndex, onData, opts = {}) {
  const sessionId = crypto.randomBytes(8).toString('hex');
  const vmName = `agent-tool-${vmIndex}`;

  let cmd, cmdArgs;
  if (opts.command) {
    cmd = opts.command[0];
    cmdArgs = opts.command.slice(1);
  } else {
    const backend = getBackend();
    const terminal = backend.terminalArgs(vmName, opts.project);
    cmd = terminal.cmd;
    cmdArgs = terminal.args;
  }

  const proc = pty.spawn(cmd, cmdArgs, {
    name: 'xterm-256color',
    cols: opts.cols || 80,
    rows: opts.rows || 24,
    cwd: opts.cwd || undefined,
    env: { ...process.env, ...opts.env },
  });

  proc.onData((data) => {
    onData(sessionId, data);
  });

  proc.onExit(({ exitCode }) => {
    sessions.delete(sessionId);
    if (opts.onExit) opts.onExit(sessionId, exitCode);
  });

  sessions.set(sessionId, { proc, vmIndex });
  return sessionId;
}

function write(sessionId, data) {
  const session = sessions.get(sessionId);
  if (session) session.proc.write(data);
}

function resize(sessionId, cols, rows) {
  const session = sessions.get(sessionId);
  if (session) session.proc.resize(cols, rows);
}

function kill(sessionId) {
  const session = sessions.get(sessionId);
  if (session) {
    session.proc.kill();
    sessions.delete(sessionId);
  }
}

function killAll() {
  for (const [id, session] of sessions) {
    try { session.proc.kill(); } catch {}
  }
  sessions.clear();
}

module.exports = { createSession, write, resize, kill, killAll };
