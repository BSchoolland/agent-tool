import chalk from "chalk";
import { createTwoFilesPatch } from "diff";
import { createHash } from "node:crypto";
import { readFileSync, statSync, readdirSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import { createInterface } from "node:readline";
import * as multipass from "../multipass.js";
import { getRepoName, agentVMName } from "../project.js";

function formatDiff(patch: string): string {
  return patch
    .split("\n")
    .map((line) => {
      if (line.startsWith("@@")) return chalk.cyan(line);
      if (line.startsWith("---") || line.startsWith("+++")) return chalk.bold(line);
      if (line.startsWith("-")) return chalk.red(line);
      if (line.startsWith("+")) return chalk.green(line);
      return line;
    })
    .join("\n");
}

async function confirm(message: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${message} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y");
    });
  });
}

function md5(content: string): string {
  return createHash("md5").update(content).digest("hex");
}

async function readVMFile(vmName: string, path: string): Promise<string | null> {
  try {
    const { stdout } = await multipass.runCommand(vmName, ["cat", path]);
    return stdout;
  } catch {
    return null;
  }
}

async function vmPathExists(vmName: string, path: string): Promise<boolean> {
  try {
    await multipass.runCommand(vmName, ["test", "-e", path]);
    return true;
  } catch {
    return false;
  }
}

async function vmIsDirectory(vmName: string, path: string): Promise<boolean> {
  try {
    await multipass.runCommand(vmName, ["test", "-d", path]);
    return true;
  } catch {
    return false;
  }
}

function collectLocalFiles(basePath: string): string[] {
  const stat = statSync(basePath);
  if (!stat.isDirectory()) return [basePath];

  const files: string[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        files.push(full);
      }
    }
  }
  walk(basePath);
  return files;
}

async function collectVMFiles(vmName: string, basePath: string): Promise<string[]> {
  try {
    const { stdout } = await multipass.runCommand(vmName, [
      "find", basePath, "-type", "f",
    ]);
    return stdout.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/** Get md5 checksums for all files under a path on a VM in a single exec call. */
async function getVMChecksums(vmName: string, basePath: string): Promise<Map<string, string>> {
  const checksums = new Map<string, string>();
  try {
    const { stdout } = await multipass.runCommand(vmName, [
      "bash", "-c", `find ${basePath} -type f -exec md5sum {} +`,
    ]);
    for (const line of stdout.trim().split("\n")) {
      if (!line) continue;
      const match = line.match(/^([a-f0-9]{32})\s+(.+)$/);
      if (match) {
        checksums.set(match[2], match[1]);
      }
    }
  } catch {
    // Path doesn't exist or is empty
  }
  return checksums;
}

function isBinary(content: string): boolean {
  return content.includes("\0");
}

async function findRunningAgents(project: string): Promise<string[]> {
  const prefix = agentVMName(project, 0).replace(/0$/, "");
  const vms = await multipass.list();
  return vms
    .filter((vm) => vm.name.startsWith(prefix) && vm.state === "Running")
    .map((vm) => vm.name)
    .sort();
}

interface FileDiff {
  relativePath: string;
  oldContent: string;
  newContent: string;
  status: "added" | "modified";
}

async function computePushDiffs(
  localBase: string,
  vmName: string,
  vmBase: string
): Promise<FileDiff[]> {
  const localFiles = collectLocalFiles(localBase);
  const isDir = statSync(localBase).isDirectory();

  // Build local checksums
  const localChecksums = new Map<string, { vmPath: string; rel: string; content: string }>();
  for (const localFile of localFiles) {
    const rel = isDir ? relative(localBase, localFile) : relative(resolve(localBase, ".."), localFile);
    const vmPath = isDir ? join(vmBase, rel) : vmBase;
    const content = readFileSync(localFile, "utf-8");
    localChecksums.set(vmPath, { vmPath, rel, content });
  }

  // Get all VM checksums in one call
  const vmChecksums = isDir
    ? await getVMChecksums(vmName, vmBase)
    : await getVMChecksums(vmName, vmBase);

  // Compare checksums to find changed files
  const changedFiles: { rel: string; vmPath: string; localContent: string; status: "added" | "modified" }[] = [];
  for (const [vmPath, { rel, content }] of localChecksums) {
    const localMd5 = md5(content);
    const vmMd5 = vmChecksums.get(vmPath);
    if (vmMd5 === undefined) {
      changedFiles.push({ rel, vmPath, localContent: content, status: "added" });
    } else if (localMd5 !== vmMd5) {
      changedFiles.push({ rel, vmPath, localContent: content, status: "modified" });
    }
  }

  if (changedFiles.length === 0) return [];

  // Only fetch VM content for modified files (need old content for diff display)
  const diffs: FileDiff[] = [];
  for (const file of changedFiles) {
    if (isBinary(file.localContent)) {
      diffs.push({
        relativePath: file.rel,
        oldContent: "",
        newContent: "(binary file)",
        status: file.status,
      });
      continue;
    }

    if (file.status === "added") {
      diffs.push({ relativePath: file.rel, oldContent: "", newContent: file.localContent, status: "added" });
    } else {
      const vmContent = await readVMFile(vmName, file.vmPath);
      diffs.push({
        relativePath: file.rel,
        oldContent: vmContent ?? "",
        newContent: file.localContent,
        status: "modified",
      });
    }
  }
  return diffs;
}

async function computePullDiffs(
  vmName: string,
  vmBase: string,
  localBase: string
): Promise<FileDiff[]> {
  const isDir = await vmIsDirectory(vmName, vmBase);
  const vmFiles = isDir ? await collectVMFiles(vmName, vmBase) : [vmBase];

  // Build local checksums for comparison
  const localChecksums = new Map<string, string>();
  for (const vmFile of vmFiles) {
    const rel = isDir ? relative(vmBase, vmFile) : relative(resolve(vmBase, ".."), vmFile);
    const localPath = isDir ? join(localBase, rel) : localBase;
    try {
      localChecksums.set(vmFile, md5(readFileSync(localPath, "utf-8")));
    } catch {
      // File doesn't exist locally
    }
  }

  // Get all VM checksums in one call
  const vmChecksums = await getVMChecksums(vmName, isDir ? vmBase : resolve(vmBase, ".."));

  // Find changed files
  const changedFiles: { vmFile: string; rel: string; localPath: string; status: "added" | "modified" }[] = [];
  for (const vmFile of vmFiles) {
    const rel = isDir ? relative(vmBase, vmFile) : relative(resolve(vmBase, ".."), vmFile);
    const localPath = isDir ? join(localBase, rel) : localBase;
    const vmMd5 = vmChecksums.get(vmFile);
    const localMd5 = localChecksums.get(vmFile);

    if (!vmMd5) continue;
    if (localMd5 === undefined) {
      changedFiles.push({ vmFile, rel, localPath, status: "added" });
    } else if (localMd5 !== vmMd5) {
      changedFiles.push({ vmFile, rel, localPath, status: "modified" });
    }
  }

  if (changedFiles.length === 0) return [];

  // Fetch VM content only for changed files
  const diffs: FileDiff[] = [];
  for (const file of changedFiles) {
    const vmContent = await readVMFile(vmName, file.vmFile);
    if (vmContent === null) continue;

    if (isBinary(vmContent)) {
      let exists = false;
      try { statSync(file.localPath); exists = true; } catch {}
      diffs.push({
        relativePath: file.rel,
        oldContent: "",
        newContent: "(binary file)",
        status: file.status,
      });
      continue;
    }

    if (file.status === "added") {
      diffs.push({ relativePath: file.rel, oldContent: "", newContent: vmContent, status: "added" });
    } else {
      let localContent = "";
      try { localContent = readFileSync(file.localPath, "utf-8"); } catch {}
      diffs.push({ relativePath: file.rel, oldContent: localContent, newContent: vmContent, status: "modified" });
    }
  }
  return diffs;
}

function displayDiffs(diffs: FileDiff[], direction: string): void {
  if (diffs.length === 0) {
    console.log(chalk.green("Already in sync — no changes to transfer."));
    return;
  }

  const added = diffs.filter((d) => d.status === "added");
  const modified = diffs.filter((d) => d.status === "modified");

  console.log(
    chalk.bold(`\n${direction}: ${added.length} new, ${modified.length} modified\n`)
  );

  let totalAdded = 0;
  let totalRemoved = 0;

  for (const diff of diffs) {
    if (diff.newContent === "(binary file)") {
      console.log(chalk.yellow(`  ${diff.status === "added" ? "new" : "modified"}: ${diff.relativePath} (binary)`));
      continue;
    }
    const patch = createTwoFilesPatch(
      `a/${diff.relativePath}`,
      `b/${diff.relativePath}`,
      diff.oldContent,
      diff.newContent,
      undefined,
      undefined,
      { context: 3 }
    );
    for (const line of patch.split("\n")) {
      if (line.startsWith("+") && !line.startsWith("+++")) totalAdded++;
      else if (line.startsWith("-") && !line.startsWith("---")) totalRemoved++;
    }
    console.log(formatDiff(patch));
  }

  console.log(chalk.bold(`${chalk.green(`++${totalAdded}`)} ${chalk.red(`--${totalRemoved}`)}`));
}

async function transferToAgent(
  agent: string,
  localPath: string,
  vmBasePath: string,
  isDir: boolean
): Promise<void> {
  if (isDir) {
    await multipass.runCommand(agent, ["mkdir", "-p", vmBasePath]);
  } else {
    const parentDir = vmBasePath.substring(0, vmBasePath.lastIndexOf("/"));
    await multipass.runCommand(agent, ["mkdir", "-p", parentDir]);
  }
  await multipass.transfer(localPath, `${agent}:${vmBasePath}`, isDir);
}

export async function syncPush(path: string): Promise<void> {
  const project = getRepoName();
  const localPath = resolve(path);

  try {
    statSync(localPath);
  } catch {
    console.error(chalk.red(`Path not found: ${localPath}`));
    process.exit(1);
  }

  await multipass.checkMultipass();
  const agents = await findRunningAgents(project);

  if (agents.length === 0) {
    console.error(chalk.red("No running agent VMs found. Start agents first."));
    process.exit(1);
  }

  console.log(chalk.bold(`Pushing to ${agents.length} agent(s)...\n`));

  const cwd = resolve(".");
  const relPath = relative(cwd, localPath);
  const vmBasePath = `/home/ubuntu/${project}/${relPath}`;

  // Show diffs against first agent (they should all be similar)
  const diffs = await computePushDiffs(localPath, agents[0], vmBasePath);

  if (diffs.length === 0) {
    console.log(chalk.green("Already in sync — no changes to transfer."));
    return;
  }

  displayDiffs(diffs, "Push");

  const hasOverwrites = diffs.some((d) => d.status === "modified");
  if (hasOverwrites) {
    const ok = await confirm(
      chalk.yellow(`This will overwrite files on ${agents.length} agent(s). Proceed?`)
    );
    if (!ok) {
      console.log("Aborted.");
      return;
    }
  }

  // Transfer to all agents in parallel
  const isDir = statSync(localPath).isDirectory();
  console.log(`Syncing to ${agents.length} agent(s)...`);
  await Promise.all(agents.map((agent) => transferToAgent(agent, localPath, vmBasePath, isDir)));

  console.log(chalk.green(`\nPushed to ${agents.length} agent(s).`));
}

export async function syncPull(agentStr: string, path: string): Promise<void> {
  const project = getRepoName();
  const agentIndex = parseInt(agentStr, 10);

  if (isNaN(agentIndex) || agentIndex < 1) {
    console.error(chalk.red("Agent must be a positive number (e.g. 1, 2, 3)."));
    process.exit(1);
  }

  await multipass.checkMultipass();
  const vmName = agentVMName(project, agentIndex);
  const vms = await multipass.list();
  const vm = vms.find((v) => v.name === vmName);

  if (!vm || vm.state !== "Running") {
    console.error(chalk.red(`Agent ${agentIndex} is not running.`));
    process.exit(1);
  }

  const vmPath = `/home/ubuntu/${project}/${path}`;
  const localPath = resolve(path);

  if (!(await vmPathExists(vmName, vmPath))) {
    console.error(chalk.red(`Path not found on agent ${agentIndex}: ${vmPath}`));
    process.exit(1);
  }

  console.log(chalk.bold(`Pulling from agent ${agentIndex}...\n`));

  const diffs = await computePullDiffs(vmName, vmPath, localPath);

  if (diffs.length === 0) {
    console.log(chalk.green("Already in sync — no changes to transfer."));
    return;
  }

  displayDiffs(diffs, "Pull");

  const hasOverwrites = diffs.some((d) => d.status === "modified");
  if (hasOverwrites) {
    const ok = await confirm(
      chalk.yellow("This will overwrite local files. Proceed?")
    );
    if (!ok) {
      console.log("Aborted.");
      return;
    }
  }

  const isDir = await vmIsDirectory(vmName, vmPath);
  if (isDir) {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(localPath, { recursive: true });
  }
  await multipass.transfer(`${vmName}:${vmPath}`, localPath, isDir);

  console.log(chalk.green(`\nPulled from agent ${agentIndex}.`));
}
