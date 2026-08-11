const UNSAFE_CHECK_COMMAND = /--fix(?:\s|$)|--write(?:\s|$)|\bwatch\b|--watch/;
const TEST_PLACEHOLDER = /no test specified/i;
const TEST_SIGNAL = /(?:^|[\s;&|])(?:node\s+--test(?:\s|$)|bun\s+test(?:\s|$)|deno\s+test(?:\s|$)|mocha(?:\s|$)|ava(?:\s|$)|tap(?:\s|$)|tape(?:\s|$)|uvu(?:\s|$)|playwright\s+test(?:\s|$)|cypress\s+run(?:\s|$)|(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test(?:[:_-][\w.-]+)?|["']?\/\^test))/;
const NON_TEST_QUALITY_SIGNAL = /(?:^|[\s;&|])(?:prettier|eslint|oxlint|biome|tsc)(?:\s|$)|(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:format|prettier|lint|typecheck)(?::[\w.-]+)?(?:\s|$)/;

export function isNonMutatingTestCommand(command: string): boolean {
  if (UNSAFE_CHECK_COMMAND.test(command) || TEST_PLACEHOLDER.test(command)) return false;
  if (TEST_SIGNAL.test(command)) return true;
  if (NON_TEST_QUALITY_SIGNAL.test(command)) return false;
  return true;
}
