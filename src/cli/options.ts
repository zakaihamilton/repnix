import type { Command } from "commander";
import { redactDiagnosticValue, redactSensitiveText } from "../core/redaction.js";

export const LOG_LEVELS = ["silent", "error", "warn", "info", "debug"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const LOG_FORMATS = ["text", "json"] as const;
export type LogFormat = (typeof LOG_FORMATS)[number];

export interface DiagnosticLogger {
  readonly level: LogLevel;
  readonly format: LogFormat;
  isEnabled(level: Exclude<LogLevel, "silent">): boolean;
  log(level: Exclude<LogLevel, "silent">, event: string, message: string, context?: Record<string, unknown>): void;
  debug(event: string, message: string, context?: Record<string, unknown>): void;
  info(event: string, message: string, context?: Record<string, unknown>): void;
  warn(event: string, message: string, context?: Record<string, unknown>): void;
  error(event: string, message: string, context?: Record<string, unknown>): void;
  output(stream: "stdout" | "stderr", output: Buffer | string, context?: Record<string, unknown>): void;
}

export interface DiagnosticOptions {
  verbose?: boolean;
  quiet?: boolean;
  logLevel?: LogLevel;
  logFormat?: LogFormat;
  timeout?: number;
  logger?: DiagnosticLogger;
}

const LEVEL_RANK: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

function isLogger(value: DiagnosticOptions | DiagnosticLogger | boolean): value is DiagnosticLogger {
  return typeof value === "object" && value !== null && "log" in value;
}

export function parseLogLevel(value: string): LogLevel {
  if ((LOG_LEVELS as readonly string[]).includes(value)) return value as LogLevel;
  throw new Error(`Invalid log level '${value}'. Expected one of: ${LOG_LEVELS.join(", ")}`);
}

export function parseLogFormat(value: string): LogFormat {
  if ((LOG_FORMATS as readonly string[]).includes(value)) return value as LogFormat;
  throw new Error(`Invalid log format '${value}'. Expected one of: ${LOG_FORMATS.join(", ")}`);
}

export function parseTimeout(value: string): number {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`Invalid timeout '${value}'. Expected a positive number of seconds`);
  }
  return seconds;
}

function renderText(level: Exclude<LogLevel, "silent">, event: string, message: string, context: Record<string, unknown>): string {
  const details = Object.entries(context)
    .map(([key, value]) => `${key}=${typeof value === "string" ? JSON.stringify(value) : JSON.stringify(value)}`)
    .join(" ");
  const prefix = level === "debug" ? `${event}: ` : "";
  return `[repnix] ${prefix}${message}${details ? ` (${details})` : ""}\n`;
}

export function createDiagnosticLogger(options: DiagnosticOptions = {}): DiagnosticLogger {
  const level = options.quiet ? "silent" : options.logLevel ?? (options.verbose ? "debug" : "error");
  const format = options.logFormat ?? "text";

  const logger: DiagnosticLogger = {
    level,
    format,
    isEnabled(candidate) {
      return LEVEL_RANK[candidate] <= LEVEL_RANK[level];
    },
    log(candidate, event, message, context = {}) {
      if (!logger.isEnabled(candidate)) return;
      const safeMessage = redactSensitiveText(message);
      const safeContext = redactDiagnosticValue(context) as Record<string, unknown>;
      if (format === "json") {
        process.stderr.write(`${JSON.stringify({ timestamp: new Date().toISOString(), level: candidate, event, message: safeMessage, ...safeContext })}\n`);
        return;
      }
      process.stderr.write(renderText(candidate, event, safeMessage, safeContext));
    },
    debug(event, message, context) {
      logger.log("debug", event, message, context);
    },
    info(event, message, context) {
      logger.log("info", event, message, context);
    },
    warn(event, message, context) {
      logger.log("warn", event, message, context);
    },
    error(event, message, context) {
      logger.log("error", event, message, context);
    },
    output(stream, output, context = {}) {
      if (!logger.isEnabled("debug")) return;
      const value = redactSensitiveText(output.toString());
      if (format === "json") {
        logger.log("debug", "provider.output", value, { stream, ...context });
        return;
      }
      process.stderr.write(value);
    },
  };
  return logger;
}

export function resolveDiagnosticLogger(options: DiagnosticOptions | DiagnosticLogger | boolean = {}): DiagnosticLogger {
  if (isLogger(options)) return options;
  if (typeof options === "boolean") return createDiagnosticLogger({ verbose: options });
  return options.logger ?? createDiagnosticLogger(options);
}

export function addDiagnosticOptions(command: Command): Command {
  return command
    .option("--verbose", "enable debug diagnostics and stream provider output to stderr")
    .option("--quiet", "suppress diagnostic output")
    .option("--log-level <level>", `set diagnostic level (${LOG_LEVELS.join(" | ")})`, parseLogLevel)
    .option("--log-format <format>", `set diagnostic format (${LOG_FORMATS.join(" | ")})`, parseLogFormat)
    .option("--timeout <seconds>", "set the maximum runtime for each repository command", parseTimeout);
}
