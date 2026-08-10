import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { assert, packProject, removeTemporary, run, temporaryDirectory } from "./test-utils.mjs";

const temporary = await temporaryDirectory("repnix-phase2-e2e-");
const consumer = path.join(temporary, "consumer");

try {
  await mkdir(path.join(consumer, "src"), { recursive: true });
  await mkdir(path.join(consumer, "test"), { recursive: true });
  await mkdir(path.join(consumer, "dist"), { recursive: true });
  await writeFile(path.join(consumer, "package.json"), `${JSON.stringify({
    name: "repnix-phase2-consumer",
    version: "1.0.0",
    private: false,
    type: "module",
    main: "dist/bundle.js",
    files: ["dist"],
  }, null, 2)}\n`);
  await writeFile(path.join(consumer, "src", "app.js"), `import { helper } from "../test/helper.js";\nexport const value = helper();\n`);
  await writeFile(path.join(consumer, "test", "helper.js"), `export function helper() { return 42; }\n`);
  await writeFile(path.join(consumer, "dist", "bundle.js"), `export const deliberatelyLargerThanOneByte = "bundle";\n`);
  await writeFile(path.join(consumer, ".dependency-cruiser.cjs"), `module.exports = {\n  forbidden: [{\n    name: "no-source-to-test",\n    severity: "error",\n    from: { path: "^src" },\n    to: { path: "^test" },\n  }],\n};\n`);
  await writeFile(path.join(consumer, ".size-limit.json"), `${JSON.stringify([{ path: "dist/bundle.js", limit: "1 B" }], null, 2)}\n`);

  const tarball = await packProject(temporary);
  await run("npm", ["install", "--no-audit", "--no-fund", "--save-dev", tarball, "dependency-cruiser", "size-limit", "@size-limit/file"], { cwd: consumer, timeoutMs: 600_000 });
  const bin = path.join(consumer, "node_modules", ".bin", `repnix${process.platform === "win32" ? ".cmd" : ""}`);

  const audit = await run(bin, ["audit"], { cwd: consumer });
  assert(audit.stdout.includes("Architecture boundaries     ✓ dependency-cruiser"), `Audit did not credit configured dependency-cruiser rules.\n${audit.stdout}`);
  assert(audit.stdout.includes("Bundle regression           ✓ Size Limit"), `Audit did not credit a configured Size Limit budget.\n${audit.stdout}`);

  const architecture = await run(bin, ["check", "architecture", "--json"], { cwd: consumer, allowExitCodes: [1], timeoutMs: 600_000 });
  const architectureReport = JSON.parse(architecture.stdout);
  assert(architectureReport.summary?.errors === 0, `dependency-cruiser execution failed: ${architecture.stdout}`);
  assert(architectureReport.results?.some((result) => result.provider === "dependency-cruiser" && result.findings.length > 0), "dependency-cruiser did not produce a normalized violation.");

  const bundle = await run(bin, ["check", "bundle", "--json"], { cwd: consumer, allowExitCodes: [1], timeoutMs: 600_000 });
  const bundleReport = JSON.parse(bundle.stdout);
  assert(bundleReport.summary?.errors === 0, `Size Limit execution failed: ${bundle.stdout}`);
  assert(bundleReport.results?.some((result) => result.provider === "size-limit" && result.findings.length > 0), "Size Limit did not produce a normalized budget finding.");

  process.stdout.write("Phase 2 provider acceptance test passed.\n");
} finally {
  await removeTemporary(temporary);
}
