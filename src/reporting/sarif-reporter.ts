import type { HealthRun } from "../core/types.js";

/** Render a SARIF 2.1.0 JSON report from a repository health check run. */
export function renderSarif(run: HealthRun): string {
  const findings = run.results.flatMap((result) => result.findings);
  const rules = [
    ...new Map(
      findings.map((finding) => {
        const ruleId = finding.ruleId ?? `${finding.provider}/${finding.type}`;
        return [
          ruleId,
          {
            id: ruleId,
            name: finding.title ?? finding.type,
            shortDescription: { text: finding.title ?? finding.type },
            ...(finding.documentationUrl ? { helpUri: finding.documentationUrl } : {}),
          },
        ];
      }),
    ).values(),
  ];
  return JSON.stringify(
    {
      version: "2.1.0",
      $schema: "https://json.schemastore.org/sarif-2.1.0.json",
      runs: [
        {
          tool: { driver: { name: "RepNix", rules } },
          results: findings.map((finding) => ({
            ruleId: finding.ruleId ?? `${finding.provider}/${finding.type}`,
            level: finding.severity === "error" ? "error" : finding.severity === "warning" ? "warning" : "note",
            message: { text: finding.message },
            baselineState: finding.baselineState === "existing" ? "unchanged" : "new",
            partialFingerprints: { repnixFingerprint: finding.fingerprint },
            ...(finding.file
              ? {
                  locations: [
                    {
                      physicalLocation: {
                        artifactLocation: { uri: finding.file },
                        ...(finding.line
                          ? {
                              region: {
                                startLine: finding.line,
                                ...(finding.column ? { startColumn: finding.column } : {}),
                              },
                            }
                          : {}),
                      },
                    },
                  ],
                }
              : {}),
          })),
        },
      ],
    },
    null,
    2,
  );
}
