import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
const packageVersion = `${packageJson.name}@${packageJson.version}`;

let alreadyPublished = false;
try {
  const { stdout } = await execFileAsync("npm", ["view", packageVersion, "version", "--json"], {
    cwd: projectRoot,
    env: process.env,
  });
  alreadyPublished = stdout.trim() === packageJson.version;
} catch (error) {
  const output = `${error.stdout ?? ""}\n${error.stderr ?? ""}`;
  if (!/\b(?:E404|404|not found|is not in this registry)\b/i.test(output)) throw error;
}

if (alreadyPublished) {
  process.stdout.write(`${packageVersion} is already published.\n`);
} else {
  const { stdout, stderr } = await execFileAsync("npm", ["publish"], {
    cwd: projectRoot,
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  process.stdout.write(stdout);
  process.stderr.write(stderr);
}
