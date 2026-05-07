import chalk from "chalk";
import { createTwoFilesPatch } from "diff";
import { createHash } from "node:crypto";
import { readFileSync, statSync, readdirSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import { createInterface } from "node:readline";
import * as docker from "../docker.js";
import { getRepoName, vmName } from "../project.js";

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

function md5(content: string | Buffer): string {
  return createHash("md5").update(content).digest("hex");
}

function md5File(filePath: string): string {
  return md5(readFileSync(filePath));
}

async function readContainerFile(containerName: string, path: string): Promise<string | null> {
  try {
    const { stdout } = await docker.runCommand(containerName, ["cat", path]);
    return stdout;
  } catch {
    return null;
  }
}

async function containerPathExists(containerName: string, path: string): Promise<boolean> {
  try {
    await docker.runCommand(containerName, ["test", "-e", path]);
    return true;
  } catch {
    return false;
  }
}

async function containerIsDirectory(containerName: string, path: string): Promise<boolean> {
  try {
    await docker.runCommand(containerName, ["test", "-d", path]);
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
      if (statSync(full).isDirectory()) {
        walk(full);
      } else {
        files.push(full);
      }
    }
  }
  walk(basePath);
  return files;
}

/** Get md5 checksums for all files under a path on a container in a single exec call. */
async function getContainerChecksums(containerName: string, basePath: string): Promise<Map<string, string>> {
  const checksums = new Map<string, string>();
  try {
    const { stdout } = await docker.runCommand(containerName, [
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

interface FileDiff {
  relativePath: string;
  oldContent: string;
  newContent: string;
  status: "added" | "modified";
}

async function computePushDiffs(
  localBase: string,
  targetContainer: string,
  containerBase: string
): Promise<FileDiff[]> {
  const localFiles = collectLocalFiles(localBase);
  const isDir = statSync(localBase).isDirectory();

  // Build local checksums
  const localFiles_meta = new Map<string, { vmPath: string; rel: string; localFile: string; localMd5: string }>();
  for (const localFile of localFiles) {
    const rel = isDir ? relative(localBase, localFile) : relative(resolve(localBase, ".."), localFile);
    const vmPath = isDir ? join(containerBase, rel) : containerBase;
    const localMd5 = md5File(localFile);
    localFiles_meta.set(vmPath, { vmPath, rel, localFile, localMd5 });
  }

  // Get all container checksums in one call
  const containerChecksums = await getContainerChecksums(targetContainer, containerBase);

  // Compare checksums to find changed files
  const changedFiles: { rel: string; vmPath: string; localFile: string; status: "added" | "modified" }[] = [];
  for (const [vmPath, { rel, localFile, localMd5 }] of localFiles_meta) {
    const containerMd5 = containerChecksums.get(vmPath);
    if (containerMd5 === undefined) {
      changedFiles.push({ rel, vmPath, localFile, status: "added" });
    } else if (localMd5 !== containerMd5) {
      changedFiles.push({ rel, vmPath, localFile, status: "modified" });
    }
  }

  if (changedFiles.length === 0) return [];

  // Re-read only changed files for diff display
  const diffs: FileDiff[] = [];
  for (const file of changedFiles) {
    const localContent = readFileSync(file.localFile, "utf-8");

    if (isBinary(localContent)) {
      diffs.push({
        relativePath: file.rel,
        oldContent: "",
        newContent: "(binary file)",
        status: file.status,
      });
      continue;
    }

    if (file.status === "added") {
      diffs.push({ relativePath: file.rel, oldContent: "", newContent: localContent, status: "added" });
    } else {
      const containerContent = await readContainerFile(targetContainer, file.vmPath);
      diffs.push({
        relativePath: file.rel,
        oldContent: containerContent ?? "",
        newContent: localContent,
        status: "modified",
      });
    }
  }
  return diffs;
}

async function computePullDiffs(
  targetContainer: string,
  containerBase: string,
  localBase: string
): Promise<FileDiff[]> {
  const isDir = await containerIsDirectory(targetContainer, containerBase);
  const containerFiles = isDir ? await collectContainerFiles(targetContainer, containerBase) : [containerBase];

  // Build local checksums for comparison
  const localChecksums = new Map<string, string>();
  for (const containerFile of containerFiles) {
    const rel = isDir ? relative(containerBase, containerFile) : relative(resolve(containerBase, ".."), containerFile);
    const localPath = isDir ? join(localBase, rel) : localBase;
    try {
      localChecksums.set(containerFile, md5File(localPath));
    } catch {
      // File doesn't exist locally
    }
  }

  // Get all container checksums in one call
  const containerChecksums = await getContainerChecksums(targetContainer, isDir ? containerBase : resolve(containerBase, ".."));

  // Find changed files
  const changedFiles: { containerFile: string; rel: string; localPath: string; status: "added" | "modified" }[] = [];
  for (const containerFile of containerFiles) {
    const rel = isDir ? relative(containerBase, containerFile) : relative(resolve(containerBase, ".."), containerFile);
    const localPath = isDir ? join(localBase, rel) : localBase;
    const containerMd5 = containerChecksums.get(containerFile);
    const localMd5 = localChecksums.get(containerFile);

    if (!containerMd5) continue;
    if (localMd5 === undefined) {
      changedFiles.push({ containerFile, rel, localPath, status: "added" });
    } else if (localMd5 !== containerMd5) {
      changedFiles.push({ containerFile, rel, localPath, status: "modified" });
    }
  }

  if (changedFiles.length === 0) return [];

  // Fetch container content only for changed files
  const diffs: FileDiff[] = [];
  for (const file of changedFiles) {
    const containerContent = await readContainerFile(targetContainer, file.containerFile);
    if (containerContent === null) continue;

    if (isBinary(containerContent)) {
      diffs.push({
        relativePath: file.rel,
        oldContent: "",
        newContent: "(binary file)",
        status: file.status,
      });
      continue;
    }

    if (file.status === "added") {
      diffs.push({ relativePath: file.rel, oldContent: "", newContent: containerContent, status: "added" });
    } else {
      let localContent = "";
      try { localContent = readFileSync(file.localPath, "utf-8"); } catch {}
      diffs.push({ relativePath: file.rel, oldContent: localContent, newContent: containerContent, status: "modified" });
    }
  }
  return diffs;
}

async function collectContainerFiles(targetContainer: string, basePath: string): Promise<string[]> {
  try {
    const { stdout } = await docker.runCommand(targetContainer, [
      "find", basePath, "-type", "f",
    ]);
    return stdout.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
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

async function transferToContainer(
  target: string,
  localPath: string,
  containerBasePath: string,
  isDir: boolean
): Promise<void> {
  if (isDir) {
    await docker.runCommand(target, ["mkdir", "-p", containerBasePath]);
  } else {
    const parentDir = containerBasePath.substring(0, containerBasePath.lastIndexOf("/"));
    await docker.runCommand(target, ["mkdir", "-p", parentDir]);
  }
  await docker.transfer(localPath, `${target}:${containerBasePath}`, isDir);
}

export async function syncPush(vmStr: string, path: string): Promise<void> {
  const index = parseInt(vmStr, 10);
  if (isNaN(index) || index < 1) {
    console.error(chalk.red("Container must be a positive number (e.g. 1, 2, 3)."));
    process.exit(1);
  }

  const project = getRepoName();
  const name = vmName(index);
  const localPath = resolve(path);

  try {
    statSync(localPath);
  } catch {
    console.error(chalk.red(`Path not found: ${localPath}`));
    process.exit(1);
  }

  await docker.checkDocker();

  const containers = await docker.list();
  const container = containers.find((v) => v.name === name);
  if (!container || container.state !== "Running") {
    console.error(chalk.red(`Container ${name} is not running.`));
    process.exit(1);
  }

  const cwd = resolve(".");
  const relPath = relative(cwd, localPath);
  const containerBasePath = `/home/ubuntu/${project}/${relPath}`;

  console.log(chalk.bold(`Pushing to ${name}...\n`));

  const diffs = await computePushDiffs(localPath, name, containerBasePath);

  if (diffs.length === 0) {
    console.log(chalk.green("Already in sync — no changes to transfer."));
    return;
  }

  displayDiffs(diffs, "Push");

  const hasOverwrites = diffs.some((d) => d.status === "modified");
  if (hasOverwrites) {
    const ok = await confirm(
      chalk.yellow(`This will overwrite files on ${name}. Proceed?`)
    );
    if (!ok) {
      console.log("Aborted.");
      return;
    }
  }

  const isDir = statSync(localPath).isDirectory();
  await transferToContainer(name, localPath, containerBasePath, isDir);

  console.log(chalk.green(`\nPushed to ${name}.`));
}

export async function syncPull(vmStr: string, path: string): Promise<void> {
  const index = parseInt(vmStr, 10);
  if (isNaN(index) || index < 1) {
    console.error(chalk.red("Container must be a positive number (e.g. 1, 2, 3)."));
    process.exit(1);
  }

  const project = getRepoName();
  const name = vmName(index);

  await docker.checkDocker();

  const containers = await docker.list();
  const container = containers.find((v) => v.name === name);
  if (!container || container.state !== "Running") {
    console.error(chalk.red(`Container ${name} is not running.`));
    process.exit(1);
  }

  const containerPath = `/home/ubuntu/${project}/${path}`;
  const localPath = resolve(path);

  if (!(await containerPathExists(name, containerPath))) {
    console.error(chalk.red(`Path not found on ${name}: ${containerPath}`));
    process.exit(1);
  }

  console.log(chalk.bold(`Pulling from ${name}...\n`));

  const diffs = await computePullDiffs(name, containerPath, localPath);

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

  const isDir = await containerIsDirectory(name, containerPath);
  if (isDir) {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(localPath, { recursive: true });
  }
  await docker.transfer(`${name}:${containerPath}`, localPath, isDir);

  console.log(chalk.green(`\nPulled from ${name}.`));
}
