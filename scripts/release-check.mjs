import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const versionSource = fs.readFileSync(path.join(root, "src/core/version.ts"), "utf8");
const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
const sourceVersion = versionSource.match(/VERSION\s*=\s*["']([^"']+)["']/)?.[1];
const changelogHeading = new RegExp(`^## ${manifest.version.replaceAll(".", "\\.")}(?:\\s|$)`, "m");

const errors = [];
if (sourceVersion !== manifest.version) {
  errors.push(`package.json version ${manifest.version} does not match src/core/version.ts ${sourceVersion ?? "(missing)"}.`);
}
if (!changelogHeading.test(changelog)) {
  errors.push(`CHANGELOG.md does not contain a release heading for ${manifest.version}.`);
}

if (errors.length) {
  process.stderr.write("Release metadata check failed:\n");
  for (const error of errors) process.stderr.write(`- ${error}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Release metadata is synchronized for ${manifest.name}@${manifest.version}.\n`);
}
