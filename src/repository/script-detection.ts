const UNSAFE_CHECK_COMMAND = /--fix(?:\s|$)|--write(?:\s|$)|\bwatch\b|--watch/;
const TEST_PLACEHOLDER = /no test specified/i;
const TEST_SIGNAL = /(?:^|[\s;&|])(?:node\s+--test(?:\s|$)|bun\s+test(?:\s|$)|deno\s+test(?:\s|$)|mocha(?:\s|$)|ava(?:\s|$)|tap(?:\s|$)|tape(?:\s|$)|uvu(?:\s|$)|playwright\s+test(?:\s|$)|cypress\s+run(?:\s|$)|(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test(?:[:_-][\w.-]+)?|["']?\/\^test))/;
const NON_TEST_QUALITY_SIGNAL = /(?:^|[\s;&|])(?:prettier|eslint|oxlint|biome|tsc)(?:\s|$)|(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:format|prettier|lint|typecheck)(?::[\w.-]+)?(?:\s|$)/;
const MUTATING_SCRIPT_SIGNAL = /(?:^|[;&|]|\s)(?:rm|mv|cp|mkdir|touch|chmod|chown|git|curl|wget)(?:\s|$)|(?:npm|pnpm|yarn|bun)\s+(?:install|ci|add|remove|uninstall|update|publish|exec\s+--\s+(?:npm|pnpm|yarn|bun))(?:\s|$)|\b(?:prepack|prepare|postinstall|deploy)\b/i;
const QUALITY_SCRIPT_SIGNAL = /(?:^|[\s;&|])(?:tsc|eslint|oxlint|biome|prettier|oxfmt|knip|jscpd|depcruise|dependency-cruiser|publint|attw|size-limit|syncpack|markdownlint(?:-cli2)?|license-checker|actionlint|lhci|changeset|stryker|gitleaks|c8)(?:\s|$)|release-check\.mjs|(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:build|check|format|prettier|lint|typecheck|type-check|test|size|bundle|coverage|licenses|docs|documentation|release|performance|health)(?::[\w.-]+)?(?:\s|$)/i;

export function isNonMutatingTestCommand(command: string): boolean {
  if (UNSAFE_CHECK_COMMAND.test(command) || TEST_PLACEHOLDER.test(command) || MUTATING_SCRIPT_SIGNAL.test(command)) return false;
  if (TEST_SIGNAL.test(command)) return true;
  if (NON_TEST_QUALITY_SIGNAL.test(command)) return false;
  return true;
}

/** Returns the first conventional test script that setup can safely wrap in another check. */
export function safeTestScript(scripts: Record<string, string>): string | null {
  for (const name of ["test", "test:run", "check:test"]) {
    const command = scripts[name];
    if (command && isNonMutatingTestCommand(command)) return name;
  }
  return null;
}

export function isNonMutatingQualityCommand(command: string): boolean {
  if (UNSAFE_CHECK_COMMAND.test(command) || MUTATING_SCRIPT_SIGNAL.test(command)) return false;
  return QUALITY_SCRIPT_SIGNAL.test(command);
}
