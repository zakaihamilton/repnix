import { describe, expect, it } from "vitest";
import { normalizeDependencyCruiser } from "../src/providers/dependency-cruiser/normalizer.js";
import { normalizeOsv } from "../src/providers/osv/normalizer.js";
import { normalizePublint } from "../src/providers/publint/normalizer.js";
import { normalizeAttw } from "../src/providers/attw/normalizer.js";
import { normalizeMarkdownlint } from "../src/providers/markdownlint/normalizer.js";
import { normalizeJscpd, normalizeKnip } from "../src/runners/health-runner.js";

describe("provider normalizers", () => {
  it("normalizes Knip issue groups conservatively", () => {
    const findings = normalizeKnip({
      issues: [
        { file: "src/old.ts", files: [{ name: "src/old.ts" }], exports: [] },
        { file: "src/math.ts", files: [], exports: [{ name: "unused", line: 4 }] },
        { file: "package.json", files: [], dependencies: [{ name: "left-pad" }], unlisted: [{ name: "missing" }] },
      ],
    });
    expect(findings.map((item) => item.type)).toEqual(["unused-file", "unused-export", "unused-dependency", "missing-dependency"]);
    expect(findings.at(-1)?.severity).toBe("error");
    expect(new Set(findings.map((item) => item.id)).size).toBe(findings.length);
  });

  it("normalizes jscpd clone pairs", () => {
    const findings = normalizeJscpd({
      duplicates: [{ lines: 27, firstFile: { name: "src/a.ts", start: 2 }, secondFile: { name: "src/b.ts", start: 8 } }],
    });
    expect(findings[0]).toMatchObject({ type: "duplication", severity: "warning", file: "src/a.ts", line: 2 });
    expect(findings[0]?.metadata).toMatchObject({ files: ["src/a.ts", "src/b.ts"], lines: 27 });
  });

  it("rejects malformed provider reports", () => {
    expect(() => normalizeKnip({ nope: [] })).toThrow("unsupported shape");
    expect(() => normalizeJscpd({ nope: [] })).toThrow("unsupported shape");
    expect(() => normalizeOsv({ nope: [] })).toThrow("unsupported shape");
    expect(() => normalizeDependencyCruiser({ nope: [] })).toThrow("unsupported shape");
    expect(() => normalizePublint({ nope: [] })).toThrow("unsupported shape");
    expect(() => normalizeAttw({ nope: [] })).toThrow("unsupported shape");
  });

  it("normalizes OSV vulnerabilities with fixes and conservative severity", () => {
    const findings = normalizeOsv({
      results: [{
        source: { path: "pnpm-lock.yaml", type: "lockfile" },
        packages: [{
          package: { name: "example", version: "1.0.0", ecosystem: "npm" },
          vulnerabilities: [{ id: "GHSA-test", aliases: ["CVE-test"], database_specific: { severity: "HIGH" }, affected: [{ ranges: [{ events: [{ fixed: "1.0.1" }] }] }] }],
        }],
      }],
    });
    expect(findings[0]).toMatchObject({ type: "vulnerability", severity: "error", file: "pnpm-lock.yaml" });
    expect(findings[0]?.message).toContain("fixed in 1.0.1");
  });

  it("normalizes dependency-cruiser rule violations", () => {
    const findings = normalizeDependencyCruiser({
      summary: { violations: [{ type: "dependency", from: "src/app.ts", to: "test/helper.ts", rule: { name: "no-source-to-test", severity: "error" } }] },
    });
    expect(findings[0]).toMatchObject({ type: "architecture-violation", severity: "error", file: "src/app.ts" });
    expect(findings[0]?.metadata).toMatchObject({ rule: "no-source-to-test", to: "test/helper.ts" });
  });

  it("normalizes Publint messages with their native severity and code", () => {
    const findings = normalizePublint({
      messages: [{ code: "FILE_DOES_NOT_EXIST", type: "error", path: ["exports", "."], args: {}, formatted: "pkg.exports[\".\"] points to a missing file." }],
    });
    expect(findings[0]).toMatchObject({
      provider: "Publint",
      category: "package-health",
      type: "publint-file-does-not-exist",
      severity: "error",
      file: "package.json",
      message: "pkg.exports[\".\"] points to a missing file.",
    });
  });

  it("normalizes ATTW problems and packages without declarations", () => {
    const findings = normalizeAttw({
      analysis: {
        types: { kind: "included" },
        problems: [{ kind: "FalseESM", entrypoint: ".", resolutionKind: "node16-cjs" }],
      },
    });
    expect(findings[0]).toMatchObject({
      provider: "Are The Types Wrong?",
      category: "package-health",
      type: "attw-false-esm",
      severity: "error",
    });
    expect(normalizeAttw({ analysis: { packageName: "demo", packageVersion: "1.0.0" } })[0]).toMatchObject({ type: "attw-untyped-package", severity: "error" });
  });

  it("respects ATTW rule ignores and resolution profiles", () => {
    const report = {
      analysis: {
        types: { kind: "included" },
        problems: [
          { kind: "FalseESM", entrypoint: ".", resolutionKind: "node16-cjs" },
          { kind: "NoResolution", entrypoint: ".", resolutionKind: "node10" },
          { kind: "NamedExports", entrypoint: ".", resolutionKind: "bundler" },
        ],
      },
    };
    expect(normalizeAttw(report, { ignoreRules: ["named-exports"], profile: "esm-only" })).toEqual([]);
  });

  it("normalizes markdownlint-cli2 text output into per-rule findings", () => {
    const findings = normalizeMarkdownlint([
      "README.md:8:81 error MD013/line-length Line length [Expected: 80; Actual: 286]",
      "docs/guide.md:7 error MD025/single-title/single-h1 Multiple top-level headings in the same document [Context: \"Test info\"]",
      "docs/guide.md:14 error MD040/fenced-code-language Fenced code blocks should have a language specified [Context: \"```\"]",
      "markdownlint-cli2 v0.18.1 (markdownlint v0.38.0)",
    ].join("\n"), "/repo");
    expect(findings).toHaveLength(3);
    expect(findings[0]).toMatchObject({
      provider: "markdownlint",
      category: "documentation",
      type: "markdown-style",
      ruleId: "MD013/line-length",
      severity: "error",
      file: "README.md",
      line: 8,
      column: 81,
      message: "Line length [Expected: 80; Actual: 286]",
    });
    expect(findings[1]).toMatchObject({
      ruleId: "MD025/single-title/single-h1",
      file: "docs/guide.md",
      line: 7,
    });
    expect(findings[1]?.column).toBeUndefined();
    expect(findings[2]?.ruleId).toBe("MD040/fenced-code-language");
  });
});
