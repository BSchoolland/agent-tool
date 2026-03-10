const cliWrapper = require('./cli-wrapper');
const projectManager = require('./project-manager');

let interval = null;
let mainWindow = null;

async function poll() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  try {
    const [vms, hosted] = await Promise.all([
      cliWrapper.list(),
      cliWrapper.getHosted(),
    ]);

    // Fetch branch for each running VM that has a project
    const branches = {};
    await Promise.all(
      vms.filter(vm => vm.state === 'Running').map(async (vm) => {
        const project = projectManager.getVmProject(vm.index);
        if (project) {
          branches[vm.index] = await cliWrapper.getBranch(vm.index, project);
        }
      })
    );

    mainWindow.webContents.send('status-update', { vms, hosted, branches });
  } catch (err) {
    // Silently ignore polling errors (multipass may be temporarily unavailable)
  }
}

function start(win) {
  mainWindow = win;
  poll();
  interval = setInterval(poll, 3000);
}

function stop() {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}

module.exports = { start, stop };
