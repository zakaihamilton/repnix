import { stripVTControlCharacters } from "node:util";

export function terminalWidth(): number | undefined {
  return process.stdout.isTTY && process.stdout.columns && process.stdout.columns > 0
    ? process.stdout.columns
    : undefined;
}

export function visibleLength(value: string): number {
  return stripVTControlCharacters(value).length;
}

export function rule(width: number | undefined): string {
  return "─".repeat(Math.min(48, width ?? 48));
}

/** Wrap terminal text cleanly while preserving indentation and ANSI escape lengths. */
export function wrapTerminalText(
  text: string,
  width: number | undefined,
  prefix = "",
  continuationPrefix = prefix,
): string[] {
  if (!width || width <= 0) return [`${prefix}${text}`];

  return text.split("\n").flatMap((sourceLine) => {
    if (!sourceLine.trim()) return [prefix];

    const words = sourceLine.trim().split(/\s+/);
    const lines: string[] = [];
    let linePrefix = prefix;
    let line = linePrefix;

    for (const word of words) {
      const separator = line === linePrefix ? "" : " ";
      const available = width - visibleLength(line) - separator.length;
      if (word.length <= available) {
        line += `${separator}${word}`;
        continue;
      }

      if (line !== linePrefix) lines.push(line);
      linePrefix = continuationPrefix;
      line = linePrefix;
      let remaining = word;
      const chunkWidth = Math.max(width - visibleLength(linePrefix), 1);
      while (remaining.length > chunkWidth) {
        lines.push(`${linePrefix}${remaining.slice(0, chunkWidth)}`);
        remaining = remaining.slice(chunkWidth);
      }
      line += remaining;
    }

    lines.push(line);
    return lines;
  });
}

export function addWrapped(
  lines: string[],
  text: string,
  width: number | undefined,
  prefix = "",
  continuationPrefix = prefix,
): void {
  lines.push(...wrapTerminalText(text, width, prefix, continuationPrefix));
}
