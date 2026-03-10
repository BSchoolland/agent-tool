const { readFileSync, writeFileSync, mkdirSync, existsSync } = require('fs');
const { join } = require('path');
const { homedir } = require('os');
const { basename } = require('path');

const CONFIG_DIR = join(homedir(), '.config', 'agent-tool');
const CONFIG_FILE = join(CONFIG_DIR, 'projects.json');

function load() {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
  } catch {
    return { projects: [], vmProjects: {} };
  }
}

function save(data) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2));
}

function list() {
  return load().projects || [];
}

function add(dirPath) {
  const data = load();
  if (!data.projects) data.projects = [];
  const name = basename(dirPath);
  if (data.projects.find(p => p.path === dirPath)) return data.projects;
  data.projects.push({ name, path: dirPath });
  save(data);
  return data.projects;
}

function getVmProject(vmIndex) {
  const data = load();
  return (data.vmProjects || {})[String(vmIndex)] || null;
}

function setVmProject(vmIndex, projectName) {
  const data = load();
  if (!data.vmProjects) data.vmProjects = {};
  data.vmProjects[String(vmIndex)] = projectName;
  save(data);
}

function getProjectPath(projectName) {
  const projects = list();
  const p = projects.find(p => p.name === projectName);
  return p ? p.path : null;
}

module.exports = { list, add, getVmProject, setVmProject, getProjectPath };
