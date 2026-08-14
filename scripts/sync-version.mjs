import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const packagePath = path.join(root, "package.json");
const versionPath = path.join(root, "src/core/version.ts");
const manifest = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const source = fs.readFileSync(versionPath, "utf8");
const versionPattern = /export const VERSION = ["'][^"']+["'];/;

if (!versionPattern.test(source)) {
  throw new Error(`Could not find the VERSION export in ${path.relative(root, versionPath)}.`);
}

const nextSource = source.replace(versionPattern, `export const VERSION = "${manifest.version}";`);
if (nextSource !== source) {
  fs.writeFileSync(versionPath, nextSource);
  process.stdout.write(`Synchronized CLI version to ${manifest.version}.\n`);
} else {
  process.stdout.write(`CLI version already matches ${manifest.version}.\n`);
}
