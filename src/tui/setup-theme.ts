import type { SetupTuiModel } from "./setup-state.js";

export interface SetupTuiTheme {
  panelRaised: string;
  active: string;
  border: string;
  borderStrong: string;
  primary: string;
  secondary: string;
  text?: string;
  muted: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
}

const truecolorTheme: SetupTuiTheme = {
  panelRaised: "#1e293b",
  active: "#134e4a",
  border: "#334155",
  borderStrong: "#64748b",
  primary: "#5eead4",
  secondary: "#a5b4fc",
  text: "#e5e7eb",
  muted: "#94a3b8",
  success: "#34d399",
  warning: "#fbbf24",
  danger: "#fb7185",
  info: "#60a5fa",
};

const lightTruecolorTheme: SetupTuiTheme = {
  panelRaised: "#f1f5f9",
  active: "#ccfbf1",
  border: "#94a3b8",
  borderStrong: "#64748b",
  primary: "#0f766e",
  secondary: "#475569",
  text: "#0f172a",
  muted: "#475569",
  success: "#15803d",
  warning: "#a16207",
  danger: "#b91c1c",
  info: "#2563eb",
};

const ansiDarkTheme: SetupTuiTheme = {
  panelRaised: "blue",
  active: "blue",
  border: "gray",
  borderStrong: "blackBright",
  primary: "cyan",
  secondary: "magenta",
  muted: "gray",
  success: "green",
  warning: "yellow",
  danger: "red",
  info: "blue",
};

const ansiLightTheme: SetupTuiTheme = {
  panelRaised: "blackBright",
  active: "blackBright",
  border: "gray",
  borderStrong: "blackBright",
  primary: "blue",
  secondary: "blackBright",
  muted: "blackBright",
  success: "green",
  warning: "yellow",
  danger: "red",
  info: "blue",
};

export type ColorOutput = Pick<NodeJS.WriteStream, "isTTY" | "hasColors"> & { columns?: number };
export interface ThemeEnvironment {
  COLORTERM?: string;
  COLORFGBG?: string;
}

function supportsTruecolor(stdout: ColorOutput, environment: ThemeEnvironment): boolean {
  return Boolean(
    stdout.isTTY &&
    (stdout.hasColors?.(16_777_216) || environment.COLORTERM === "truecolor" || environment.COLORTERM === "24bit"),
  );
}

function terminalBackground(environment: ThemeEnvironment): "light" | "dark" | undefined {
  const colorFgbg = environment.COLORFGBG?.split(";").at(-1);
  if (colorFgbg === "7" || colorFgbg === "15") return "light";
  if (colorFgbg !== undefined && ["0", "1", "2", "3", "4", "5", "6", "8"].includes(colorFgbg)) return "dark";
  return undefined;
}

export function createSetupTuiTheme(stdout: ColorOutput, environment: ThemeEnvironment = process.env): SetupTuiTheme {
  const background = terminalBackground(environment);
  const truecolor = supportsTruecolor(stdout, environment);
  if (background === "dark") return truecolor ? truecolorTheme : ansiDarkTheme;
  return truecolor ? lightTruecolorTheme : ansiLightTheme;
}

export function foregroundColor(color: string | undefined): { color?: string } {
  return color === undefined ? {} : { color };
}

export function textColor(theme: SetupTuiTheme): { color?: string } {
  return foregroundColor(theme.text);
}

export function selectionIndicator(checked: boolean): string {
  return checked ? "■" : "□";
}

const ansiEscapePattern = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g");

export function normalizeTuiDiffLine(line: string): string {
  return line.replace(ansiEscapePattern, "");
}

export function diffLineColor(line: string, theme: SetupTuiTheme): string | undefined {
  const normalized = normalizeTuiDiffLine(line);
  if (normalized.startsWith("  +")) return theme.success;
  if (normalized.startsWith("  -")) return theme.danger;
  return theme.text;
}

export interface SelectionRowPresentation {
  label: string;
  color?: string;
  backgroundColor?: string;
  bold: boolean;
}

export function selectionRowPresentation(
  name: string,
  checked: boolean,
  active: boolean,
  priority: string | undefined,
  theme: SetupTuiTheme,
  width = 30,
): SelectionRowPresentation {
  const prefix = `${active ? "▸" : " "} ${selectionIndicator(checked)} `;
  const priorityLabel = priority ? `· ${priority}` : "";
  const priorityGap = priority
    ? " ".repeat(Math.max(1, width - prefix.length - name.length - priorityLabel.length))
    : "";
  const label = `${prefix}${name}${priorityGap}${priorityLabel}`.padEnd(width, " ");
  const base = {
    label: label.padEnd(width, " "),
    ...(active ? { color: theme.primary } : textColor(theme)),
    bold: active,
  };
  return active ? { ...base, backgroundColor: theme.active } : base;
}

export interface TuiLayoutMetrics {
  bodyHeight: number;
  detailViewport: number;
}
const HEADER_ROWS = 4;
const FOOTER_ROWS = 4;
const DETAIL_PANEL_CHROME_ROWS = 6;
export const SIDEBAR_WIDTH = 40;
export const SIDEBAR_CONTENT_WIDTH = SIDEBAR_WIDTH - 4;
export const COMPACT_LAYOUT_WIDTH = 100;
export const COMPACT_LAYOUT_HEIGHT = 30;
export const HORIZONTAL_PANE_MIN_WIDTH = 120;
const COMPACT_LAYOUT_EXTRA_ROWS = 3;

export type SetupPaneLayout = "horizontal" | "vertical" | "focused-sidebar";

export function setupPaneLayout(width: number, height: number): SetupPaneLayout {
  if (width < COMPACT_LAYOUT_WIDTH && height < COMPACT_LAYOUT_HEIGHT) return "focused-sidebar";
  return width < HORIZONTAL_PANE_MIN_WIDTH || width < height ? "vertical" : "horizontal";
}

export function tuiLayoutMetrics(height: number, compact = false): TuiLayoutMetrics {
  const safeHeight = Math.max(height, 1);
  const bodyHeight = Math.max(safeHeight - HEADER_ROWS - FOOTER_ROWS - (compact ? COMPACT_LAYOUT_EXTRA_ROWS : 0), 1);
  return { bodyHeight, detailViewport: Math.max(bodyHeight - DETAIL_PANEL_CHROME_ROWS, 1) };
}

export function clampTuiScroll(scroll: number, lineCount: number, viewport: number): number {
  return Math.min(Math.max(scroll, 0), Math.max(lineCount - Math.max(viewport, 1), 0));
}

export function setupStepIndex(screen: SetupTuiModel["screen"]): number {
  if (screen === "loading" || screen === "audit" || screen === "empty") return 0;
  if (screen === "manual") return 1;
  if (screen === "select" || screen === "planning") return 2;
  if (screen === "review" || screen === "details" || screen === "confirm") return 3;
  return 4;
}
