import { describe, expect, it } from "vitest";
import { redactDiagnosticValue, redactSensitiveText } from "../src/core/redaction.js";

describe("diagnostic redaction", () => {
  it("redacts common credentials without changing ordinary output", () => {
    const text = [
      "Authorization: Bearer abc.def.ghi",
      "token=ghp_1234567890abcdefghijklmnop",
      "https://user:password@example.test/path",
      "-----BEGIN PRIVATE KEY-----secret-----END PRIVATE KEY-----",
      "normal source/index.ts output",
    ].join("\n");

    const redacted = redactSensitiveText(text);
    expect(redacted).not.toContain("abc.def.ghi");
    expect(redacted).not.toContain("ghp_1234567890abcdefghijklmnop");
    expect(redacted).not.toContain("user:password");
    expect(redacted).not.toContain("BEGIN PRIVATE KEY-----secret");
    expect(redacted).toContain("normal source/index.ts output");
  });

  it("redacts nested diagnostic values", () => {
    expect(redactDiagnosticValue({ message: "TOKEN=secret", nested: ["Bearer abc"] })).toEqual({
      message: "TOKEN=[REDACTED]",
      nested: ["Bearer [REDACTED]"],
    });
  });
});
