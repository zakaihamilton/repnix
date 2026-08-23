const PRIVATE_KEY = /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi;
const AUTH_HEADER = /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/-]+=*/gi;
const KNOWN_TOKEN = /\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|npm_[A-Za-z0-9]+|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9_-]{16,})\b/g;
const CREDENTIAL_URL = /(\b[a-z][a-z\d+.-]*:\/\/)([^\s/:@]+):([^\s/@]+)@/gi;
const SECRET_ASSIGNMENT = /((?:^|[\s;&|])(?:[A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE_KEY|API_KEY)[A-Za-z0-9_]*)(?:\s*[:=]\s*))("[^"]*"|'[^']*'|[^\s;&|]+)/gi;

/** Redacts high-confidence credentials before diagnostics or reports leave the process. */
export function redactSensitiveText(value: string): string {
  return value
    .replace(PRIVATE_KEY, "[REDACTED PRIVATE KEY]")
    .replace(CREDENTIAL_URL, "$1[REDACTED]:[REDACTED]@")
    .replace(AUTH_HEADER, (match) => `${match.split(/\s+/, 1)[0]} [REDACTED]`)
    .replace(KNOWN_TOKEN, "[REDACTED TOKEN]")
    .replace(SECRET_ASSIGNMENT, "$1[REDACTED]");
}

export function redactDiagnosticValue(value: unknown): unknown {
  if (typeof value === "string") return redactSensitiveText(value);
  if (Array.isArray(value)) return value.map(redactDiagnosticValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, redactDiagnosticValue(child)]));
}
