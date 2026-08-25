import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const versionSource = fs.readFileSync(path.join(root, "src/core/version.ts"), "utf8");
const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
const sourceVersion = versionSource.match(/VERSION\s*=\s*["']([^"']+)["']/)?.[1];
const changelogHeading = new RegExp(`^## ${manifest.version.replaceAll(".", "\\.")}(?:\\s|$)`, "m");

const errors = [];
if (sourceVersion !== manifest.version) {
  errors.push(
    `package.json version ${manifest.version} does not match src/core/version.ts ${sourceVersion ?? "(missing)"}.`,
  );
}
if (!changelogHeading.test(changelog)) {
  errors.push(`CHANGELOG.md does not contain a release heading for ${manifest.version}.`);
}

function pendingChangesetFiles() {
  return fs
    .readdirSync(path.join(root, ".changeset"))
    .filter((name) => name.endsWith(".md") && name.toLowerCase() !== "readme.md");
}

function gitShow(refPath) {
  const result = spawnSync("git", ["show", refPath], { cwd: root, encoding: "utf8" });
  return result.status === 0 ? result.stdout : null;
}

function baseManifestVersion() {
  for (const ref of ["origin/main:package.json", "main:package.json"]) {
    const contents = gitShow(ref);
    if (!contents) continue;
    try {
      const version = JSON.parse(contents).version;
      if (typeof version === "string" && version.length > 0) return version;
    } catch {
      // Try the next ref if the file is missing or not JSON.
    }
  }
  return null;
}

function runChangesetStatus() {
  const bin = path.join(root, "node_modules", "@changesets", "cli", "bin.js");
  const result = spawnSync(process.execPath, [bin, "status"], { cwd: root, stdio: "inherit" });
  if (result.error) {
    process.stderr.write(`${result.error.message}\n`);
    process.exitCode = 1;
    return;
  }
  if (result.status) process.exitCode = result.status;
}

if (errors.length) {
  process.stderr.write("Release metadata check failed:\n");
  for (const error of errors) process.stderr.write(`- ${error}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Release metadata is synchronized for ${manifest.name}@${manifest.version}.\n`);
  const pending = pendingChangesetFiles();
  const baseVersion = baseManifestVersion();
  if (pending.length === 0 && baseVersion && baseVersion !== manifest.version) {
    process.stdout.write(
      `Release ${manifest.version} is already prepared against ${baseVersion}; pending changeset status is not required.\n`,
    );
  } else {
    runChangesetStatus();
  }
}
