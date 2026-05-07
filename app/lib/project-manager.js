const { readFileSync, writeFileSync, mkdirSync, existsSync } = require('fs');
const { join } = require('path');
const { homedir } = require('os');
const { basename } = require('path');
const { getBackendName } = require('./backend');

const CONFIG_DIR = join(homedir(), '.config', 'agent-tool');
const CONFIG_FILE = join(CONFIG_DIR, 'projects.json');

function load() {
  try {
    const data = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
    // Migrate: move old shared projects/vmProjects into multipass section
    if (data.projects && !data.multipass) {
      data.multipass = {
        projects: data.projects,
        vmProjects: data.vmProjects || {},
      };
      delete data.projects;
      delete data.vmProjects;
      if (!data.docker) data.docker = { projects: [], containerProjects: {} };
      save(data);
    }
    return data;
  } catch {
    return { multipass: { projects: [], vmProjects: {} }, docker: { projects: [], containerProjects: {} } };
  }
}

function save(data) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2));
}

function backendData() {
  const data = load();
  const name = getBackendName();
  if (!data[name]) data[name] = { projects: [], vmProjects: {}, containerProjects: {} };
  return { data, section: data[name] };
}

function list() {
  return backendData().section.projects || [];
}

function add(dirPath) {
  const { data, section } = backendData();
  if (!section.projects) section.projects = [];
  const name = basename(dirPath);
  if (section.projects.find(p => p.path === dirPath)) return section.projects;
  section.projects.push({ name, path: dirPath });
  save(data);
  return section.projects;
}

function getVmProject(vmIndex) {
  const { section } = backendData();
  const map = section.vmProjects || section.containerProjects || {};
  return map[String(vmIndex)] || null;
}

function setVmProject(vmIndex, projectName) {
  const { data, section } = backendData();
  const key = getBackendName() === 'docker' ? 'containerProjects' : 'vmProjects';
  if (!section[key]) section[key] = {};
  section[key][String(vmIndex)] = projectName;
  save(data);
}

function getProjectPath(projectName) {
  const projects = list();
  const p = projects.find(p => p.name === projectName);
  return p ? p.path : null;
}

module.exports = { list, add, getVmProject, setVmProject, getProjectPath };
