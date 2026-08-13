import { describe, expect, it } from "vitest";
import { packFilenameFromReport } from "../src/runners/health/package-tools.js";

describe("npm pack report parsing", () => {
  it("accepts the array report emitted by npm versions that return a list", () => {
    expect(packFilenameFromReport([{ filename: "repnix-0.3.9.tgz" }])).toBe("repnix-0.3.9.tgz");
  });

  it("accepts the object report emitted by npm versions that return one package", () => {
    expect(packFilenameFromReport({ filename: "repnix-0.3.9.tgz" })).toBe("repnix-0.3.9.tgz");
  });

  it("accepts the package-name map emitted by npm 12", () => {
    expect(packFilenameFromReport({ repnix: { filename: "repnix-0.3.9.tgz" } })).toBe("repnix-0.3.9.tgz");
  });

  it("rejects reports without a package filename", () => {
    expect(() => packFilenameFromReport([])).toThrow("npm pack returned an unsupported report");
    expect(() => packFilenameFromReport({ files: [] })).toThrow("npm pack returned an unsupported report");
    expect(() => packFilenameFromReport({ repnix: { files: [] } })).toThrow("npm pack returned an unsupported report");
  });
});
