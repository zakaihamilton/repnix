const DEFAULT_INDENTATION = "  ";
const DEFAULT_NEWLINE = "\n";
const DEFAULT_TRAILING_NEWLINES = "\n";

interface JsonFormatting {
  indentation: string;
  newline: "\n" | "\r\n";
  trailingNewlines: string;
}

function formattingFor(raw: string | undefined): JsonFormatting {
  if (raw === undefined) {
    return {
      indentation: DEFAULT_INDENTATION,
      newline: DEFAULT_NEWLINE,
      trailingNewlines: DEFAULT_TRAILING_NEWLINES,
    };
  }

  return {
    // A multiline JSON file has its indentation on the first indented line.
    // An empty indent preserves a compact, existing one-line representation.
    indentation: raw.match(/^[ \t]+(?=\S)/m)?.[0] ?? "",
    newline: raw.includes("\r\n") ? "\r\n" : "\n",
    trailingNewlines: raw.match(/(?:\r\n|\n)+$/)?.[0] ?? "",
  };
}

export function formatJson(value: unknown, existingRaw?: string): string {
  const formatting = formattingFor(existingRaw);
  const serialized = JSON.stringify(value, null, formatting.indentation);
  if (serialized === undefined) throw new Error("Cannot serialize JSON value.");
  return `${serialized.replaceAll("\n", formatting.newline)}${formatting.trailingNewlines}`;
}
