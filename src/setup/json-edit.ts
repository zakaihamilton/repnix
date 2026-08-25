import { applyEdits, modify } from "jsonc-parser";

function formattingOptions(raw: string) {
  const indent = raw.match(/\n([\t ]+)\S/)?.[1] ?? "  ";
  return {
    insertSpaces: !indent.includes("\t"),
    tabSize: indent.includes("\t") ? 1 : indent.length,
    eol: raw.includes("\r\n") ? "\r\n" : "\n",
  };
}

export function setJsonValue(raw: string, jsonPath: (string | number)[], value: unknown): string {
  return applyEdits(raw, modify(raw, jsonPath, value, { formattingOptions: formattingOptions(raw) }));
}
