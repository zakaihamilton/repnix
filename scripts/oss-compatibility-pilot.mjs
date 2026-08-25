import { mkdtemp, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { isDeepStrictEqual } from "node:util";
import { assert, projectRoot, removeTemporary, run } from "./test-utils.mjs";

const manifestPath = path.join(projectRoot, "fixtures", "oss-pilots.json");
const pilots = JSON.parse(await readFile(manifestPath, "utf8"));

async function snapshotDirectory(root, relative = ".") {
  const snapshot = new Map();

  async function visit(directory) {
    const entries = await readdir(path.join(root, directory), { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name === ".git") continue;
      const child = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile()) snapshot.set(child, (await readFile(path.join(root, child))).toString("base64"));
    }
  }

  await visit(relative);
  return snapshot;
}

function assertEqual(actual, expected, message) {
  assert(
    isDeepStrictEqual(actual, expected),
    `${message}\nExpected: ${JSON.stringify(expected)}\nReceived: ${JSON.stringify(actual)}`,
  );
}

async function checkoutPilot(pilot, root) {
  await run("git", ["init", "--quiet", root]);
  await run("git", ["remote", "add", "origin", pilot.repository], { cwd: root });
  await run("git", ["fetch", "--depth", "1", "origin", pilot.revision], { cwd: root, timeoutMs: 300_000 });
  const revision = await run("git", ["rev-parse", "FETCH_HEAD"], { cwd: root });
  assertEqual(
    revision.stdout.trim(),
    pilot.revision,
    `${pilot.id}: fetched revision differs from the pinned revision.`,
  );
  await run("git", ["checkout", "--detach", "--quiet", "FETCH_HEAD"], { cwd: root });
}

async function runPilot(pilot, temporary) {
  const root = path.join(temporary, pilot.id);
  await checkoutPilot(pilot, root);
  const before = await snapshotDirectory(root);
  const execute = async (args) => {
    const result = await run(process.execPath, [path.join(projectRoot, "dist", "cli.js"), ...args], {
      cwd: root,
      timeoutMs: 120_000,
    });
    return JSON.parse(result.stdout);
  };

  const audit = await execute(["audit", "--format", "json", "--quiet"]);
  assertEqual(audit.repository.packageManager, pilot.packageManager, `${pilot.id}: wrong package manager.`);
  assert(audit.repository.scopes.length > 0, `${pilot.id}: audit found no repository scopes.`);

  const plan = await execute(["setup", "--plan", "--format", "json", "--quiet"]);
  assertEqual(plan.warnings, [], `${pilot.id}: setup plan emitted warnings.`);
  assertEqual(plan.conflicts, [], `${pilot.id}: setup plan reported conflicts.`);
  assertEqual(
    [...(await snapshotDirectory(root))],
    [...before],
    `${pilot.id}: read-only commands changed the repository.`,
  );

  process.stdout.write(
    `OSS compatibility pilot passed: ${pilot.id} (${audit.recommendations.map((item) => item.provider).join(", ") || "no recommendations"})\n`,
  );
}

const temporary = await mkdtemp(path.join(os.tmpdir(), "repnix-oss-compatibility-"));
try {
  for (const pilot of pilots) await runPilot(pilot, temporary);
  process.stdout.write(`OSS compatibility pilot suite passed (${pilots.length} repositories).\n`);
} finally {
  await removeTemporary(temporary);
}
