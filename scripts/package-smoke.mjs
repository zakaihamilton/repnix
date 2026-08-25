import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { assert, packProject, projectRoot, removeTemporary, run, temporaryDirectory } from "./test-utils.mjs";

const temporary = await temporaryDirectory("repnix-package-smoke-");
const consumer = path.join(temporary, "consumer");

try {
  const projectManifest = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
  await mkdir(path.join(consumer, "src"), { recursive: true });
  await writeFile(
    path.join(consumer, "package.json"),
    `${JSON.stringify(
      {
        name: "repnix-package-smoke",
        version: "1.0.0",
        private: true,
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(path.join(consumer, "src", "index.js"), "export const answer = 42;\n");

  const tarball = await packProject(temporary);
  for (const staleArtifact of ["dist/cli/explain.js", "dist/cli/explain.d.ts", "dist/cli/explain.js.map"]) {
    try {
      await access(path.join(projectRoot, staleArtifact));
      throw new Error(
        `Stale removed build artifact is present: ${staleArtifact}. Run the clean build before packaging.`,
      );
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  await run("npm", ["install", "--no-audit", "--no-fund", "--save-dev", tarball], {
    cwd: consumer,
    env: { npm_config_cache: path.join(temporary, "npm-cache") },
  });

  const bin = path.join(consumer, "node_modules", ".bin", `repnix${process.platform === "win32" ? ".cmd" : ""}`);
  await access(bin);
  const commandOptions = process.platform === "win32" ? { shell: true } : {};
  const version = await run(bin, ["--version"], { cwd: consumer, ...commandOptions });
  assert(version.stdout.trim() === projectManifest.version, `Unexpected packaged version: ${version.stdout}`);

  const audit = await run(bin, ["audit"], { cwd: consumer, ...commandOptions });
  assert(audit.stdout.includes("Repository"), "Packaged CLI audit did not render repository metadata.");
  assert(audit.stdout.includes("Knip"), "Packaged CLI audit did not recommend Knip.");

  await run("node", [path.join(projectRoot, "scripts", "compatibility-pilot.mjs"), "--cli", bin], {
    cwd: projectRoot,
    timeoutMs: 600_000,
  });

  process.stdout.write(`Packaged CLI smoke and compatibility tests passed on ${process.platform}.\n`);
} finally {
  await removeTemporary(temporary);
}
