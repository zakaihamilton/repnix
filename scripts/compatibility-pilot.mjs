import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { isDeepStrictEqual } from "node:util";
import { assert, projectRoot, run } from "./test-utils.mjs";

const pilots = [
  {
    id: "minimal-js",
    packageManager: "npm",
    scopes: [{ path: ".", roles: ["node-app"], frameworks: [] }],
    recommendations: ["knip", "jscpd", "osv-scanner", "dependency-cruiser", "c8", "stryker", "gitleaks"],
    packages: ["repnix", "knip", "jscpd", "c8"],
    files: ["package.json", "repnix.config.json", ".jscpd.json"],
  },
  {
    id: "node-typescript",
    packageManager: "yarn",
    scopes: [{ path: ".", roles: ["node-app"], frameworks: [] }],
    recommendations: ["knip", "osv-scanner", "gitleaks", "license-checker"],
    packages: ["repnix", "knip"],
    files: ["package.json", "repnix.config.json"],
  },
  {
    id: "npm-library",
    packageManager: "npm",
    scopes: [{ path: ".", roles: ["library"], frameworks: [] }],
    recommendations: ["knip", "osv-scanner", "publint", "attw", "gitleaks", "license-checker", "changesets"],
    packages: ["repnix", "knip", "publint", "@arethetypeswrong/cli"],
    files: ["package.json", "repnix.config.json"],
  },
  {
    id: "react-eslint",
    packageManager: "npm",
    scopes: [{ path: ".", roles: ["node-app"], frameworks: ["React"] }],
    recommendations: ["knip", "jscpd", "osv-scanner", "eslint-boundaries", "c8", "stryker", "gitleaks", "license-checker"],
    packages: ["repnix", "knip", "jscpd", "c8"],
    files: ["package.json", "repnix.config.json", ".jscpd.json"],
  },
  {
    id: "next-biome",
    packageManager: "pnpm",
    scopes: [{ path: ".", roles: ["web-app"], frameworks: ["Next.js", "React"] }],
    recommendations: ["knip", "osv-scanner", "size-limit", "jsx-a11y", "gitleaks", "license-checker", "lhci"],
    packages: ["repnix", "knip"],
    files: ["package.json", "repnix.config.json"],
  },
  {
    id: "pnpm-monorepo",
    packageManager: "pnpm",
    scopes: [
      { path: ".", roles: ["node-app"], frameworks: [] },
      { path: "packages/a", roles: ["node-app"], frameworks: [] },
      { path: "packages/b", roles: ["node-app"], frameworks: [] },
    ],
    recommendations: ["knip", "jscpd", "osv-scanner", "dependency-cruiser", "syncpack", "gitleaks", "license-checker"],
    packages: ["repnix", "knip", "jscpd", "syncpack"],
    files: ["package.json", "repnix.config.json", ".jscpd.json"],
  },
];

async function snapshotDirectory(root, relative = ".") {
  const snapshot = new Map();

  async function visit(directory) {
    const entries = await readdir(path.join(root, directory), { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name === ".git") continue;
      const child = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(child);
      } else if (entry.isFile()) {
        snapshot.set(child, (await readFile(path.join(root, child))).toString("base64"));
      }
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

function cliCommand() {
  const index = process.argv.indexOf("--cli");
  if (index === -1) return { command: process.execPath, prefix: [path.join(projectRoot, "dist", "cli.js")] };
  const command = process.argv[index + 1];
  assert(command, "--cli requires the path to a RepNix executable.");
  return { command, prefix: [] };
}

async function runPilot(pilot, cli) {
  const root = path.join(projectRoot, "fixtures", pilot.id);
  const before = await snapshotDirectory(root);
  const execute = async (args) => {
    const result = await run(cli.command, [...cli.prefix, ...args], {
      cwd: root,
      shell: process.platform === "win32",
      timeoutMs: 60_000,
    });
    return JSON.parse(result.stdout);
  };

  const audit = await execute(["audit", "--format", "json", "--quiet"]);
  assertEqual(audit.repository.packageManager, pilot.packageManager, `${pilot.id}: wrong package manager.`);
  assertEqual(
    audit.repository.scopes.map((scope) => ({ path: scope.path, roles: scope.roles, frameworks: scope.frameworks })),
    pilot.scopes,
    `${pilot.id}: wrong detected repository scopes.`,
  );
  assertEqual(audit.recommendations.map((recommendation) => recommendation.provider), pilot.recommendations, `${pilot.id}: unexpected recommendations.`);

  const plan = await execute(["setup", "--plan", "--format", "json", "--quiet"]);
  assertEqual(plan.packages.map((item) => item.name), pilot.packages, `${pilot.id}: unexpected setup packages.`);
  assertEqual(plan.files.map((item) => item.path), pilot.files, `${pilot.id}: unexpected setup files.`);
  assertEqual(plan.warnings, [], `${pilot.id}: setup plan emitted warnings.`);
  assertEqual(plan.conflicts, [], `${pilot.id}: setup plan reported conflicts.`);

  assertEqual([...await snapshotDirectory(root)], [...before], `${pilot.id}: read-only commands changed the fixture.`);
  process.stdout.write(`Compatibility pilot passed: ${pilot.id}\n`);
}

const cli = cliCommand();
for (const pilot of pilots) await runPilot(pilot, cli);
process.stdout.write(`Compatibility pilot suite passed (${pilots.length} repositories).\n`);
