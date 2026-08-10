import { describe, expect, it } from "vitest";
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
  });
});
