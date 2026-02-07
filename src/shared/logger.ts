// ============================================================
// Sentinel – Structured Logger
// Clear, colored logging for every state transition
// ============================================================

import chalk from "chalk";

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4,
}

const LEVEL_LABELS: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: chalk.gray("DEBUG"),
  [LogLevel.INFO]: chalk.blue("INFO "),
  [LogLevel.WARN]: chalk.yellow("WARN "),
  [LogLevel.ERROR]: chalk.red("ERROR"),
  [LogLevel.NONE]: "",
};

const MODULE_COLORS: Record<string, (s: string) => string> = {
  "policy-engine": chalk.magenta,
  "mcp-server": chalk.cyan,
  session: chalk.green,
  settlement: chalk.yellow,
  ens: chalk.blue,
  uniswap: chalk.hex("#FF007A"), // Uniswap pink
  demo: chalk.white,
};

export class Logger {
  private static globalLevel: LogLevel = LogLevel.DEBUG;
  private module: string;
  private colorFn: (s: string) => string;

  constructor(module: string) {
    this.module = module;
    this.colorFn = MODULE_COLORS[module] ?? chalk.white;
  }

  static setLevel(level: LogLevel): void {
    Logger.globalLevel = level;
  }

  private format(level: LogLevel, message: string, data?: unknown): string {
    const ts = new Date().toISOString().slice(11, 23); // HH:mm:ss.mmm
    const mod = this.colorFn(`[${this.module}]`);
    const base = `${chalk.dim(ts)} ${LEVEL_LABELS[level]} ${mod} ${message}`;
    if (data !== undefined) {
      return `${base} ${chalk.dim(JSON.stringify(data, null, 0))}`;
    }
    return base;
  }

  debug(message: string, data?: unknown): void {
    if (Logger.globalLevel <= LogLevel.DEBUG) {
      console.log(this.format(LogLevel.DEBUG, message, data));
    }
  }

  info(message: string, data?: unknown): void {
    if (Logger.globalLevel <= LogLevel.INFO) {
      console.log(this.format(LogLevel.INFO, message, data));
    }
  }

  warn(message: string, data?: unknown): void {
    if (Logger.globalLevel <= LogLevel.WARN) {
      console.warn(this.format(LogLevel.WARN, message, data));
    }
  }

  error(message: string, data?: unknown): void {
    if (Logger.globalLevel <= LogLevel.ERROR) {
      console.error(this.format(LogLevel.ERROR, message, data));
    }
  }

  /** Log a policy decision with pass/fail coloring */
  policyResult(approved: boolean, summary: string): void {
    const icon = approved ? chalk.green("✓ APPROVED") : chalk.red("✗ REJECTED");
    this.info(`Policy ${icon}: ${summary}`);
  }

  /** Log a state transition (e.g. session status change) */
  transition(from: string, to: string, context?: string): void {
    const arrow = chalk.dim("→");
    const msg = `${chalk.yellow(from)} ${arrow} ${chalk.green(to)}`;
    this.info(context ? `${msg} (${context})` : msg);
  }

  /** Log a separator line for demo readability */
  separator(label?: string): void {
    if (Logger.globalLevel <= LogLevel.INFO) {
      const line = "─".repeat(60);
      if (label) {
        console.log(chalk.dim(`\n${line}\n  ${label}\n${line}`));
      } else {
        console.log(chalk.dim(line));
      }
    }
  }
}
