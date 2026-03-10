/* ── renderer.js — UI logic for agent-tool Electron app ── */

const api = window.electronAPI;

// ── SVG icons ──
const ICON = {
  host: '<svg viewBox="0 0 16 16"><path d="M2 3a1 1 0 011-1h10a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1V3zm1 0v5h10V3H3zm-1 9a1 1 0 011-1h10a1 1 0 110 2H3a1 1 0 01-1-1z"/></svg>',
  stop: '<svg viewBox="0 0 16 16"><rect x="3" y="3" width="10" height="10" rx="1"/></svg>',
  start: '<svg viewBox="0 0 16 16"><path d="M4 2l10 6-10 6V2z"/></svg>',
  sync: '<svg viewBox="0 0 16 16"><path d="M8 2l4 4H9v6H7V6H4l4-4z"/></svg>',
  folder: '<svg viewBox="0 0 16 16"><path d="M1 3.5A1.5 1.5 0 012.5 2h3.879a1.5 1.5 0 011.06.44l1.122 1.12A1.5 1.5 0 009.62 4H13.5A1.5 1.5 0 0115 5.5v7a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 011 12.5v-9z"/></svg>',
  terminal: '<svg class="term-icon" viewBox="0 0 16 16"><path d="M2 3h12v10H2V3zm1 2l3 2.5L3 10V5zm4 5h5v1H7v-1z"/></svg>',
  plus: '<svg viewBox="0 0 16 16"><path d="M8 2v12M2 8h12" stroke-width="1.5" stroke-linecap="round"/></svg>',
  close: '<svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" stroke-width="1.5" stroke-linecap="round"/></svg>',
  addFolder: '<svg viewBox="0 0 16 16"><path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>',
};

// ── State ──
let activeTab = null;
let hostedVmIndex = null;
let vms = [];
let projects = [];
let syncTargetVm = null;
let syncSelectedPath = null;
let syncSelectedCwd = null;

// Per-VM state: { terminals: [{ sessionId, xterm, fitAddon, paneEl }], activeTermIdx, created }
const vmState = {};

// Map sessionId → { vmIndex, termIdx }
const sessionMap = {};

// ── Context menu helper ──
function removeContextMenu() {
  document.querySelectorAll('.xterm-context-menu').forEach(m => m.remove());
}
document.addEventListener('click', removeContextMenu);

// ── DOM references ──
const $tabbar = document.getElementById('tabbar');
const $mainContent = document.getElementById('main-content');
const $statusVmCount = document.getElementById('statusbar-vm-count');
const $statusHosted = document.getElementById('statusbar-hosted');

// Sync modal
const $syncModal = document.getElementById('sync-modal');
const $syncModalVm = document.getElementById('sync-modal-vm');
const $syncDropzone = document.getElementById('sync-dropzone');
const $syncSelection = document.getElementById('sync-selection');
const $syncFileName = document.getElementById('sync-file-name-text');
const $syncFileSize = document.getElementById('sync-file-size');
const $syncDestPath = document.getElementById('sync-dest-path');
const $syncWarning = document.getElementById('sync-warning');
const $syncWarningSize = document.getElementById('sync-warning-size');
const $syncFooter = document.getElementById('sync-footer');
const $syncConfirmBtn = document.getElementById('sync-confirm-btn');

// Window controls handled by OS chrome

// ── Helpers ──
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

function shortenPath(p) {
  const home = p.replace(/^\/home\/[^/]+/, '~');
  return home;
}

// ── Tab rendering ──
function renderTabs() {
  $tabbar.innerHTML = '';
  for (const vm of vms) {
    const tab = document.createElement('div');
    tab.className = 'tab' + (activeTab === vm.index ? ' active' : '');
    tab.dataset.vm = vm.index;

    const state = vmState[vm.index] || {};
    const project = state.project || '';
    const isHosted = hostedVmIndex === vm.index;
    const running = vm.state === 'Running';

    tab.innerHTML = `
      <div class="tab-indicator ${running ? 'running' : 'stopped'}"></div>
      <span class="tab-label">VM ${vm.index}</span>
      <span class="tab-project">${project}</span>
      <span class="tab-hosted" style="${isHosted ? '' : 'display:none'}">HOST</span>
    `;
    tab.addEventListener('click', () => switchTab(vm.index));
    $tabbar.appendChild(tab);
  }
}

// ── Content rendering for a VM ──
function ensureContent(vmIndex) {
  let el = document.getElementById(`content-${vmIndex}`);
  if (el) return el;

  el = document.createElement('div');
  el.className = 'tab-content';
  el.id = `content-${vmIndex}`;
  $mainContent.appendChild(el);

  // Initialize vmState
  if (!vmState[vmIndex]) {
    vmState[vmIndex] = { terminals: [], activeTermIdx: -1, project: null, created: false };
  }

  return el;
}

function renderContent(vmIndex) {
  const vm = vms.find(v => v.index === vmIndex);
  if (!vm) return;

  const el = ensureContent(vmIndex);
  const state = vmState[vmIndex];
  const running = vm.state === 'Running';
  const project = state.project;
  const isHosted = hostedVmIndex === vmIndex;
  const branch = state.branch || '';

  // Build toolbar
  let toolbarHtml = `<div class="toolbar" id="toolbar-${vmIndex}">`;

  // Host button
  if (running) {
    if (isHosted) {
      toolbarHtml += `<div class="toolbar-group"><button class="toolbar-btn active-host" data-action="host" data-vm="${vmIndex}">${ICON.host} hosted</button></div>`;
    } else {
      toolbarHtml += `<div class="toolbar-group"><button class="toolbar-btn" data-action="host" data-vm="${vmIndex}">${ICON.host} host</button></div>`;
    }
  } else {
    toolbarHtml += `<div class="toolbar-group"><button class="toolbar-btn disabled">${ICON.host} host</button></div>`;
  }

  toolbarHtml += '<div class="toolbar-sep"></div>';

  // Start/Stop
  if (running) {
    toolbarHtml += `<div class="toolbar-group"><button class="toolbar-btn danger" data-action="stop" data-vm="${vmIndex}">${ICON.stop} stop</button></div>`;
  } else {
    toolbarHtml += `<div class="toolbar-group"><button class="toolbar-btn start" data-action="start" data-vm="${vmIndex}">${ICON.start} start</button></div>`;
  }

  toolbarHtml += '<div class="toolbar-sep"></div>';

  // Sync
  if (running && project) {
    toolbarHtml += `<div class="toolbar-group"><button class="toolbar-btn" data-action="sync" data-vm="${vmIndex}">${ICON.sync} sync</button></div>`;
  } else {
    toolbarHtml += `<div class="toolbar-group"><button class="toolbar-btn disabled">${ICON.sync} sync</button></div>`;
  }

  toolbarHtml += '<div class="toolbar-sep"></div>';

  // Switch project
  if (running) {
    toolbarHtml += `<div class="toolbar-group"><button class="toolbar-btn" data-action="switch-project" data-vm="${vmIndex}">${ICON.folder} switch project</button></div>`;
  }

  // Context: project:branch
  toolbarHtml += `<div class="toolbar-context" id="toolbar-context-${vmIndex}">`;
  if (project) {
    toolbarHtml += `<span class="context-project">${project}</span>`;
    if (branch) {
      toolbarHtml += `<span class="context-sep">:</span><span class="context-branch">${branch}</span>`;
    }
  } else {
    toolbarHtml += `<span class="context-project" style="color: var(--text-muted)">no project</span>`;
  }
  toolbarHtml += '</div>';

  // Status
  toolbarHtml += '<div class="toolbar-status">';
  if (running) {
    toolbarHtml += `<span class="state">running</span>`;
    toolbarHtml += `<span class="ip">${vm.ipv4 || '—'}</span>`;
  } else {
    toolbarHtml += `<span class="state stopped">stopped</span>`;
    toolbarHtml += `<span class="ip">—</span>`;
  }
  toolbarHtml += '</div></div>';

  // Determine body: terminals or overlay
  let bodyHtml = '';

  if (running && project && state.created) {
    // Terminal wrapper — we preserve existing DOM for terminal panes
    bodyHtml += `<div class="terminal-wrapper" id="terminals-${vmIndex}">`;
    bodyHtml += `<div class="terminal-main" id="terminal-main-${vmIndex}"></div>`;
    bodyHtml += renderSidebar(vmIndex);
    bodyHtml += '</div>';
  } else if (running && project && !state.created) {
    // About to create terminals
    bodyHtml += `<div class="terminal-wrapper" id="terminals-${vmIndex}">`;
    bodyHtml += `<div class="terminal-main" id="terminal-main-${vmIndex}"></div>`;
    bodyHtml += renderSidebar(vmIndex);
    bodyHtml += '</div>';
  } else {
    // Overlay: stopped or no project
    bodyHtml += `<div class="overlay" id="overlay-${vmIndex}">`;
    if (!running) {
      bodyHtml += `<span class="overlay-label">agent-tool-${vmIndex} is stopped</span>`;
      bodyHtml += `<button class="open-btn" data-action="open-project" data-vm="${vmIndex}">open project</button>`;
      bodyHtml += renderProjectPicker(vmIndex, 'setup');
    } else {
      // Running but no project — show picker immediately
      bodyHtml += `<span class="overlay-label">Select a project for agent-tool-${vmIndex}</span>`;
      bodyHtml += renderProjectPicker(vmIndex, 'open', true);
    }
    bodyHtml += '</div>';
  }

  // Check if we need to preserve terminal DOMs
  const existingTerminals = state.terminals.filter(t => t.paneEl);
  if (existingTerminals.length > 0 && running && project) {
    // Only update toolbar, keep terminal DOM intact
    const toolbarEl = el.querySelector('.toolbar');
    if (toolbarEl) {
      const tmp = document.createElement('div');
      tmp.innerHTML = toolbarHtml;
      toolbarEl.replaceWith(tmp.firstElementChild);
    } else {
      el.innerHTML = toolbarHtml + bodyHtml;
      reattachTerminals(vmIndex);
    }
    updateSidebar(vmIndex);
  } else {
    el.innerHTML = toolbarHtml + bodyHtml;
    if (running && project) {
      reattachTerminals(vmIndex);
    }
  }

  // Wire up toolbar button events
  el.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', handleToolbarAction);
  });
}

function renderSidebar(vmIndex) {
  const state = vmState[vmIndex];
  let html = `<div class="terminal-sidebar" id="sidebar-${vmIndex}">`;

  for (let i = 0; i < state.terminals.length; i++) {
    const active = i === state.activeTermIdx;
    html += `<div class="term-tab${active ? ' active' : ''}" data-term-idx="${i}" data-vm="${vmIndex}">`;
    html += ICON.terminal;
    html += `<span class="term-label">bash ${i + 1}</span>`;
    html += '</div>';
  }

  html += '<div class="term-sidebar-sep"></div>';
  html += `<button class="term-add-btn" data-action="add-term" data-vm="${vmIndex}" title="New terminal">${ICON.plus}</button>`;
  html += `<button class="term-close-btn" data-action="close-term" data-vm="${vmIndex}" title="Close terminal">${ICON.close}</button>`;
  html += '</div>';
  return html;
}

function updateSidebar(vmIndex) {
  const sidebar = document.getElementById(`sidebar-${vmIndex}`);
  if (!sidebar) return;

  const state = vmState[vmIndex];
  const tmp = document.createElement('div');
  tmp.innerHTML = renderSidebar(vmIndex);
  const newSidebar = tmp.firstElementChild;
  sidebar.replaceWith(newSidebar);

  // Wire sidebar events
  wireSidebarEvents(vmIndex);
}

function wireSidebarEvents(vmIndex) {
  const sidebar = document.getElementById(`sidebar-${vmIndex}`);
  if (!sidebar) return;

  sidebar.querySelectorAll('.term-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const idx = parseInt(tab.dataset.termIdx, 10);
      switchTerminal(vmIndex, idx);
    });
  });

  sidebar.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', handleToolbarAction);
  });
}

function reattachTerminals(vmIndex) {
  const state = vmState[vmIndex];
  const mainEl = document.getElementById(`terminal-main-${vmIndex}`);
  if (!mainEl) return;

  for (let i = 0; i < state.terminals.length; i++) {
    const t = state.terminals[i];
    if (t.paneEl) {
      mainEl.appendChild(t.paneEl);
      t.paneEl.className = 'term-pane' + (i === state.activeTermIdx ? ' active' : '');
      if (t.fitAddon && i === state.activeTermIdx) {
        setTimeout(() => {
          try { t.fitAddon.fit(); } catch {}
        }, 50);
      }
    }
  }

  wireSidebarEvents(vmIndex);
}

function renderProjectPicker(vmIndex, actionLabel, visible) {
  let html = `<div class="project-picker" id="project-picker-${vmIndex}" style="${visible ? '' : 'display:none'}">`;
  html += '<div class="project-picker-title">select a project</div>';
  html += '<div class="project-list">';
  for (const p of projects) {
    html += `<div class="project-item" data-action="select-project" data-vm="${vmIndex}" data-project="${p.name}" data-path="${p.path}">`;
    html += `<div class="project-item-info"><span class="project-item-name">${p.name}</span><span class="project-item-path">${shortenPath(p.path)}</span></div>`;
    html += `<span class="project-item-action">${actionLabel} &rarr;</span>`;
    html += '</div>';
  }
  html += '</div>';
  html += `<div class="project-add-row"><button class="project-add-btn" data-action="add-project" data-vm="${vmIndex}">${ICON.addFolder} Add project folder</button></div>`;
  html += '</div>';
  return html;
}

// ── Tab switching ──
function switchTab(vmIndex) {
  if (activeTab === vmIndex) return;
  activeTab = vmIndex;

  // Update tab styles
  $tabbar.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', parseInt(t.dataset.vm, 10) === vmIndex);
  });

  // Show/hide content
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  const content = document.getElementById(`content-${vmIndex}`);
  if (content) content.classList.add('active');

  // Lazy-create first terminal if VM is running with a project
  const vm = vms.find(v => v.index === vmIndex);
  const state = vmState[vmIndex];
  if (vm && vm.state === 'Running' && state && state.project && state.terminals.length === 0) {
    addTerminal(vmIndex);
    state.created = true;
    renderContent(vmIndex);
  }

  // Fit active terminal
  if (state && state.terminals.length > 0 && state.activeTermIdx >= 0) {
    const t = state.terminals[state.activeTermIdx];
    if (t && t.fitAddon) {
      setTimeout(() => {
        try { t.fitAddon.fit(); } catch {}
      }, 50);
    }
  }
}

// ── Terminal management ──
async function addTerminal(vmIndex, opts = {}) {
  const state = vmState[vmIndex];
  if (!state) return;

  // Default terminals cd into the VM's project directory
  if (!opts.command && state.project) {
    opts.project = state.project;
  }

  const sessionId = await api.terminalCreate(vmIndex, opts);

  const paneEl = document.createElement('div');
  paneEl.className = 'term-pane';

  const xterm = new Terminal({
    // fontFamily: "'JetBrains Mono', monospace",
    // fontSize: 13,
    // lineHeight: 1.55,
    cursorBlink: true,
    cursorStyle: 'block',
    // theme: {
    //   background: '#0c0c0e',
    //   foreground: '#c8cad0',
    //   cursor: '#c8cad0',
    //   selectionBackground: '#2a2b35',
    //   black: '#0a0a0b',
    //   red: '#e55a5a',
    //   green: '#3dd68c',
    //   yellow: '#e5a64e',
    //   blue: '#5b9bf5',
    //   magenta: '#b48ead',
    //   cyan: '#4ec9b0',
    //   white: '#c8cad0',
    //   brightBlack: '#44464f',
    //   brightRed: '#e55a5a',
    //   brightGreen: '#3dd68c',
    //   brightYellow: '#e5a64e',
    //   brightBlue: '#5b9bf5',
    //   brightMagenta: '#b48ead',
    //   brightCyan: '#4ec9b0',
    //   brightWhite: '#c8cad0',
    // },
  });

  const FitAddonClass = FitAddon.FitAddon;
  const fitAddon = new FitAddonClass();
  xterm.loadAddon(fitAddon);
  xterm.open(paneEl);

  // Ctrl+Shift+C/V for copy/paste
  let pasteHandledByKey = false;
  xterm.attachCustomKeyEventHandler((e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'C' && e.type === 'keydown') {
      const sel = xterm.getSelection();
      if (sel) navigator.clipboard.writeText(sel);
      return false;
    }
    if (e.ctrlKey && e.shiftKey && e.key === 'V' && e.type === 'keydown') {
      pasteHandledByKey = true;
      navigator.clipboard.readText().then(text => api.terminalWrite(sessionId, text));
      return false;
    }
    return true;
  });

  // Suppress the browser paste event triggered by Ctrl+Shift+V to avoid double paste
  paneEl.addEventListener('paste', (e) => {
    if (pasteHandledByKey) {
      e.preventDefault();
      e.stopPropagation();
      pasteHandledByKey = false;
    }
  }, true);

  // Right-click context menu
  paneEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    removeContextMenu();
    const sel = xterm.getSelection();
    const menu = document.createElement('div');
    menu.className = 'xterm-context-menu';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';

    if (sel) {
      const copyItem = document.createElement('div');
      copyItem.className = 'xterm-context-item';
      copyItem.textContent = 'Copy';
      copyItem.addEventListener('click', () => {
        navigator.clipboard.writeText(sel);
        removeContextMenu();
      });
      menu.appendChild(copyItem);
    }

    const pasteItem = document.createElement('div');
    pasteItem.className = 'xterm-context-item';
    pasteItem.textContent = 'Paste';
    pasteItem.addEventListener('click', () => {
      navigator.clipboard.readText().then(text => api.terminalWrite(sessionId, text));
      removeContextMenu();
    });
    menu.appendChild(pasteItem);

    document.body.appendChild(menu);
  });

  // User keystrokes → PTY
  xterm.onData((data) => {
    api.terminalWrite(sessionId, data);
  });

  const termIdx = state.terminals.length;
  state.terminals.push({ sessionId, xterm, fitAddon, paneEl, isSetup: opts.isSetup || false });
  sessionMap[sessionId] = { vmIndex, termIdx };

  // Set active
  state.activeTermIdx = termIdx;
  state.created = true;

  // Attach to DOM
  const mainEl = document.getElementById(`terminal-main-${vmIndex}`);
  if (mainEl) {
    // Hide all panes, show new one
    mainEl.querySelectorAll('.term-pane').forEach(p => p.classList.remove('active'));
    mainEl.appendChild(paneEl);
    paneEl.classList.add('active');
    setTimeout(() => {
      try { fitAddon.fit(); } catch {}
    }, 50);
  }

  updateSidebar(vmIndex);
  return { sessionId, termIdx };
}

function switchTerminal(vmIndex, termIdx) {
  const state = vmState[vmIndex];
  if (!state || termIdx >= state.terminals.length) return;

  state.activeTermIdx = termIdx;

  const mainEl = document.getElementById(`terminal-main-${vmIndex}`);
  if (mainEl) {
    mainEl.querySelectorAll('.term-pane').forEach((p, i) => {
      p.classList.toggle('active', state.terminals[i] && state.terminals.indexOf(
        state.terminals.find(t => t.paneEl === p)
      ) === termIdx);
    });
  }

  // Simpler: iterate state terminals
  for (let i = 0; i < state.terminals.length; i++) {
    const t = state.terminals[i];
    if (t.paneEl) {
      t.paneEl.classList.toggle('active', i === termIdx);
    }
  }

  // Fit
  const t = state.terminals[termIdx];
  if (t && t.fitAddon) {
    setTimeout(() => {
      try { t.fitAddon.fit(); } catch {}
    }, 50);
  }

  updateSidebar(vmIndex);
}

async function closeTerminal(vmIndex) {
  const state = vmState[vmIndex];
  if (!state || state.terminals.length <= 1) return;

  const idx = state.activeTermIdx;
  const term = state.terminals[idx];

  // Kill PTY
  if (term.sessionId) {
    await api.terminalKill(term.sessionId);
    delete sessionMap[term.sessionId];
  }

  // Remove DOM
  if (term.paneEl && term.paneEl.parentNode) {
    term.paneEl.remove();
  }
  if (term.xterm) {
    term.xterm.dispose();
  }

  // Remove from state
  state.terminals.splice(idx, 1);

  // Update sessionMap indices
  for (let i = 0; i < state.terminals.length; i++) {
    const t = state.terminals[i];
    if (t.sessionId && sessionMap[t.sessionId]) {
      sessionMap[t.sessionId].termIdx = i;
    }
  }

  // Switch to nearest
  state.activeTermIdx = Math.min(idx, state.terminals.length - 1);
  switchTerminal(vmIndex, state.activeTermIdx);
}

// ── PTY data listener ──
api.onTerminalData((sessionId, data) => {
  const info = sessionMap[sessionId];
  if (!info) return;
  const state = vmState[info.vmIndex];
  if (!state) return;
  const term = state.terminals[info.termIdx];
  if (term && term.xterm) {
    term.xterm.write(data);
  }
});

api.onTerminalExit((sessionId, exitCode) => {
  const info = sessionMap[sessionId];
  if (!info) return;
  const state = vmState[info.vmIndex];
  if (!state) return;
  const term = state.terminals[info.termIdx];

  if (term && term.isSetup) {
    // Setup finished — remove setup terminal, create a normal one
    delete sessionMap[sessionId];
    if (term.paneEl && term.paneEl.parentNode) term.paneEl.remove();
    if (term.xterm) term.xterm.dispose();
    state.terminals.splice(info.termIdx, 1);

    // Reindex
    for (let i = 0; i < state.terminals.length; i++) {
      const t = state.terminals[i];
      if (t.sessionId && sessionMap[t.sessionId]) {
        sessionMap[t.sessionId].termIdx = i;
      }
    }

    if (state.terminals.length === 0) {
      state.activeTermIdx = -1;
      addTerminal(info.vmIndex);
    } else {
      state.activeTermIdx = Math.min(info.termIdx, state.terminals.length - 1);
      switchTerminal(info.vmIndex, state.activeTermIdx);
    }
    renderContent(info.vmIndex);
  }
});

// ── Toolbar action handler ──
async function handleToolbarAction(e) {
  const btn = e.currentTarget;
  const action = btn.dataset.action;
  const vmIndex = parseInt(btn.dataset.vm, 10);

  switch (action) {
    case 'host':
      await handleHost(vmIndex);
      break;
    case 'stop':
      await handleStop(vmIndex);
      break;
    case 'start':
      await handleStart(vmIndex);
      break;
    case 'sync':
      openSyncModal(vmIndex);
      break;
    case 'switch-project':
      showProjectPicker(vmIndex);
      break;
    case 'open-project':
      showProjectPickerFromOverlay(vmIndex);
      break;
    case 'select-project':
      await selectProject(vmIndex, btn.dataset.project, btn.dataset.path);
      break;
    case 'add-project':
      await addNewProject(vmIndex);
      break;
    case 'add-term':
      await addTerminal(vmIndex);
      renderContent(vmIndex);
      break;
    case 'close-term':
      await closeTerminal(vmIndex);
      break;
  }
}

// ── VM actions ──
async function handleHost(vmIndex) {
  try {
    if (hostedVmIndex === vmIndex) {
      await api.vmUnhost();
      hostedVmIndex = null;
    } else {
      await api.vmHost(vmIndex);
      hostedVmIndex = vmIndex;
    }
    renderTabs();
    renderContent(vmIndex);
    updateStatusBar();
  } catch (err) {
    console.error('Host error:', err);
  }
}

async function handleStop(vmIndex) {
  try {
    // Kill all terminals for this VM
    const state = vmState[vmIndex];
    if (state) {
      for (const t of state.terminals) {
        if (t.sessionId) {
          await api.terminalKill(t.sessionId);
          delete sessionMap[t.sessionId];
        }
        if (t.xterm) t.xterm.dispose();
        if (t.paneEl && t.paneEl.parentNode) t.paneEl.remove();
      }
      state.terminals = [];
      state.activeTermIdx = -1;
      state.created = false;
    }

    await api.vmStop(vmIndex);

    // Update local state
    const vm = vms.find(v => v.index === vmIndex);
    if (vm) vm.state = 'Stopped';
    if (hostedVmIndex === vmIndex) hostedVmIndex = null;

    renderTabs();
    renderContent(vmIndex);
    updateStatusBar();
  } catch (err) {
    console.error('Stop error:', err);
  }
}

async function handleStart(vmIndex) {
  try {
    await api.vmStart(vmIndex);
    const vm = vms.find(v => v.index === vmIndex);
    if (vm) vm.state = 'Running';
    renderTabs();
    renderContent(vmIndex);
    updateStatusBar();
  } catch (err) {
    console.error('Start error:', err);
  }
}

// ── Project picker ──
function showProjectPicker(vmIndex) {
  const state = vmState[vmIndex];
  // Hide terminals, show overlay with picker
  const terminals = document.getElementById(`terminals-${vmIndex}`);
  if (terminals) terminals.style.display = 'none';

  // Create overlay if it doesn't exist
  let overlay = document.getElementById(`overlay-${vmIndex}`);
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.id = `overlay-${vmIndex}`;
    const content = document.getElementById(`content-${vmIndex}`);
    if (content) content.appendChild(overlay);
  }

  overlay.style.display = '';
  overlay.innerHTML = `<span class="overlay-label">Switch project on agent-tool-${vmIndex}</span>` + renderProjectPicker(vmIndex, 'open');

  const picker = overlay.querySelector('.project-picker');
  if (picker) picker.style.display = '';

  // Wire events
  overlay.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', handleToolbarAction);
  });
}

function showProjectPickerFromOverlay(vmIndex) {
  const picker = document.getElementById(`project-picker-${vmIndex}`);
  if (picker) picker.style.display = '';

  const openBtn = document.querySelector(`#overlay-${vmIndex} .open-btn`);
  if (openBtn) openBtn.style.display = 'none';

  // Wire events on newly visible picker items
  const overlay = document.getElementById(`overlay-${vmIndex}`);
  if (overlay) {
    overlay.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', handleToolbarAction);
    });
  }
}

async function selectProject(vmIndex, projectName, projectPath) {
  const state = vmState[vmIndex];
  state.project = projectName;

  await api.projectSetVm(vmIndex, projectName);

  // Show terminals area, hide overlay
  const overlay = document.getElementById(`overlay-${vmIndex}`);
  if (overlay) overlay.style.display = 'none';

  const terminals = document.getElementById(`terminals-${vmIndex}`);
  if (terminals) terminals.style.display = '';

  // Run setup in a terminal pane
  renderContent(vmIndex);

  // Spawn setup PTY: agent-tool setup <N> with cwd set to project path
  await addTerminal(vmIndex, {
    command: ['agent-tool', 'setup', String(vmIndex)],
    cwd: projectPath,
    isSetup: true,
  });

  renderTabs();
  renderContent(vmIndex);
}

async function addNewProject(vmIndex) {
  const newProjects = await api.projectAdd();
  if (newProjects) {
    projects = newProjects;
    // Re-render the content (which includes the picker)
    renderContent(vmIndex);
    // Re-show picker
    showProjectPicker(vmIndex);
  }
}

// ── Sync modal ──
function openSyncModal(vmIndex) {
  syncTargetVm = vmIndex;
  syncSelectedPath = null;
  syncSelectedCwd = null;
  $syncModalVm.textContent = `VM ${vmIndex}`;
  $syncSelection.classList.remove('visible');
  $syncWarning.classList.remove('visible');
  $syncFooter.style.display = 'none';
  $syncModal.classList.add('open');
}

function closeSyncModal() {
  $syncModal.classList.remove('open');
  syncTargetVm = null;
  syncSelectedPath = null;
  syncSelectedCwd = null;
}

$syncDropzone.addEventListener('click', async () => {
  const picked = await api.syncPickFolder();
  if (!picked) return;

  syncSelectedPath = picked;

  // Determine project cwd
  const state = vmState[syncTargetVm];
  const project = state ? state.project : '';
  const projectPath = project ? await api.projectGetPath(project) : null;
  syncSelectedCwd = projectPath || picked;

  // Get basename for display
  const parts = picked.split('/');
  const name = parts[parts.length - 1];
  $syncFileName.textContent = name;

  // Compute size
  try {
    const size = await api.syncComputeSize(picked);
    $syncFileSize.textContent = formatSize(size);

    // Compute VM dest path
    const relative = projectPath ? picked.replace(projectPath + '/', '') : name;
    $syncDestPath.textContent = `/home/ubuntu/${project}/${relative}`;

    // Large file warning
    const WARN_THRESHOLD = 100 * 1024 * 1024; // 100 MB
    if (size > WARN_THRESHOLD) {
      $syncWarningSize.textContent = formatSize(size);
      $syncWarning.classList.add('visible');
      $syncConfirmBtn.className = 'modal-btn warn';
      $syncConfirmBtn.textContent = 'sync anyway';
    } else {
      $syncWarning.classList.remove('visible');
      $syncConfirmBtn.className = 'modal-btn primary';
      $syncConfirmBtn.textContent = 'sync';
    }

    $syncSelection.classList.add('visible');
    $syncFooter.style.display = 'flex';
  } catch (err) {
    console.error('Size computation error:', err);
  }
});

document.getElementById('sync-modal-close').addEventListener('click', closeSyncModal);
document.getElementById('sync-cancel-btn').addEventListener('click', closeSyncModal);

$syncConfirmBtn.addEventListener('click', async () => {
  if (!syncTargetVm || !syncSelectedPath) return;
  try {
    await api.syncPush(syncTargetVm, syncSelectedPath, syncSelectedCwd);
  } catch (err) {
    console.error('Sync error:', err);
  }
  closeSyncModal();
});

$syncModal.addEventListener('click', (e) => {
  if (e.target === $syncModal) closeSyncModal();
});

// ── Status bar ──
function updateStatusBar() {
  const running = vms.filter(v => v.state === 'Running').length;
  $statusVmCount.textContent = `${vms.length} VMs (${running} running)`;

  if (hostedVmIndex) {
    $statusHosted.textContent = `\u2605 agent-tool-${hostedVmIndex} hosted`;
  } else {
    $statusHosted.textContent = '';
  }
}

// ── Status poller listener ──
api.onStatusUpdate(({ vms: newVms, hosted, branches }) => {
  vms = newVms;

  if (hosted) {
    hostedVmIndex = hosted.agentIndex;
  } else {
    hostedVmIndex = null;
  }

  // Update branches and project associations
  for (const vm of vms) {
    if (!vmState[vm.index]) {
      vmState[vm.index] = { terminals: [], activeTermIdx: -1, project: null, created: false };
    }
    if (branches && branches[vm.index]) {
      vmState[vm.index].branch = branches[vm.index];
    }
  }

  renderTabs();
  updateStatusBar();

  // Re-render active tab content (toolbar only updates)
  if (activeTab) {
    renderContent(activeTab);
  }
});

// ── Resize observer for terminal fit ──
const resizeObserver = new ResizeObserver(() => {
  if (!activeTab) return;
  const state = vmState[activeTab];
  if (!state || state.activeTermIdx < 0) return;
  const t = state.terminals[state.activeTermIdx];
  if (t && t.fitAddon) {
    try {
      t.fitAddon.fit();
      if (t.sessionId) {
        api.terminalResize(t.sessionId, t.xterm.cols, t.xterm.rows);
      }
    } catch {}
  }
});

resizeObserver.observe(document.querySelector('.app'));

// ── Init ──
async function init() {
  // Load projects
  projects = await api.projectList();

  // Load VM→project associations
  vms = await api.vmList();

  for (const vm of vms) {
    if (!vmState[vm.index]) {
      vmState[vm.index] = { terminals: [], activeTermIdx: -1, project: null, created: false };
    }
    const project = await api.projectGetVm(vm.index);
    if (project) {
      vmState[vm.index].project = project;
    }
  }

  // Hosted state will arrive via status-update poller

  renderTabs();

  // Create content containers for all VMs
  for (const vm of vms) {
    ensureContent(vm.index);
    renderContent(vm.index);
  }

  // Activate first tab
  if (vms.length > 0) {
    switchTab(vms[0].index);
  }

  updateStatusBar();
}

init();
