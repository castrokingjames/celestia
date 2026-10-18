// @celestia/argus — the switchable logging port (docs/NAMING.md). Code calls a scoped Logger (createLogger);
// a swappable LogSink sits behind it. ONE global switch — configureLogging({ level, sink }) — raises/lowers
// verbosity or routes everything to a different sink (console today; an analytics/tracker sink later via
// MultiSink) with zero call-site changes (ports/adapters, G7). Zero deps, framework-agnostic: server
// (Colyseus/NestJS) and the Jupiter client both import this instead of touching console directly.

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

/** A single structured log record handed to the sink. `at` is wall-clock ms (for analytics/ordering). */
export interface LogEntry {
  readonly level: Exclude<LogLevel, "silent">;
  readonly scope: string;
  readonly msg: string;
  readonly args: unknown[];
  readonly at: number;
}

/** The swap seam: where records go. Implement this for an analytics/tracker sink later. */
export interface LogSink {
  emit(entry: LogEntry): void;
}

export interface Logger {
  debug(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  /** A nested logger whose scope is `parent:sub` (e.g. "atlas:zone" → "atlas:zone:genesis"). */
  child(subScope: string): Logger;
}

const RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

/** Default sink: console, choosing the right console method per level and preserving structured args. */
export class ConsoleSink implements LogSink {
  emit(e: LogEntry): void {
    const line = `[${e.scope}] ${e.msg}`;
    const fn = e.level === "error" ? console.error : e.level === "warn" ? console.warn : console.log;
    if (e.args.length) fn(line, ...e.args);
    else fn(line);
  }
}

/** Drop everything (silence tests / headless runs without flipping call sites). */
export class NullSink implements LogSink {
  emit(): void {}
}

/** Fan a record to several sinks — e.g. console AND an analytics sink, when that lands. */
export class MultiSink implements LogSink {
  constructor(private readonly sinks: readonly LogSink[]) {}
  emit(e: LogEntry): void {
    for (const s of this.sinks) s.emit(e);
  }
}

// The ONE global switch. Mutated only by configureLogging; read on every emit.
let level: LogLevel = "info";
let sink: LogSink = new ConsoleSink();

/** Flip verbosity and/or route output to a different sink at runtime. */
export function configureLogging(cfg: { level?: LogLevel; sink?: LogSink }): void {
  if (cfg.level !== undefined) level = cfg.level;
  if (cfg.sink !== undefined) sink = cfg.sink;
}

/** Current effective level (handy for tests / conditional expensive log building). */
export function getLogLevel(): LogLevel {
  return level;
}

function write(lvl: Exclude<LogLevel, "silent">, scope: string, msg: string, args: unknown[]): void {
  if (RANK[lvl] < RANK[level]) return; // below the threshold → dropped
  sink.emit({ level: lvl, scope, msg, args, at: Date.now() });
}

/** A scoped logger. Scope is a short dotted/colon tag that prefixes every line, e.g. "atlas:zone". */
export function createLogger(scope: string): Logger {
  return {
    debug: (msg, ...args) => write("debug", scope, msg, args),
    info: (msg, ...args) => write("info", scope, msg, args),
    warn: (msg, ...args) => write("warn", scope, msg, args),
    error: (msg, ...args) => write("error", scope, msg, args),
    child: (subScope) => createLogger(`${scope}:${subScope}`),
  };
}
