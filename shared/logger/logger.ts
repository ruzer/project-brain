import { AsyncLocalStorage } from "node:async_hooks";

type LogLevel = "info" | "warn" | "error" | "debug";

export interface LogBindings {
  component?: string;
  agent?: string | null;
  action?: string | null;
  cycleId?: string | null;
}

export interface StructuredLogEvent extends LogBindings {
  timestamp: string;
  level: LogLevel;
  message: string;
  [key: string]: unknown;
}

interface LoggerOptions {
  verbose: boolean;
}

const runtimeContext = new AsyncLocalStorage<LogBindings>();
const loggerOptions: LoggerOptions = {
  verbose: false
};

function normalizeBindings(bindings?: LogBindings): LogBindings {
  return {
    component: bindings?.component,
    agent: bindings?.agent ?? null,
    action: bindings?.action ?? null,
    cycleId: bindings?.cycleId ?? null
  };
}

function currentBindings(): LogBindings {
  return normalizeBindings(runtimeContext.getStore());
}

export function setLoggerOptions(options: Partial<LoggerOptions>): void {
  if (typeof options.verbose === "boolean") {
    loggerOptions.verbose = options.verbose;
  }
}

export function getLoggerOptions(): LoggerOptions {
  return { ...loggerOptions };
}

export async function withLogContext<T>(bindings: LogBindings, run: () => Promise<T>): Promise<T> {
  const merged = {
    ...currentBindings(),
    ...normalizeBindings(bindings)
  };

  return runtimeContext.run(merged, run);
}

export function createCycleId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export class StructuredLogger {
  constructor(
    private readonly component: string,
    private readonly defaults: LogBindings = {}
  ) {}

  child(bindings: string | LogBindings): StructuredLogger {
    if (typeof bindings === "string") {
      return new StructuredLogger(`${this.component}:${bindings}`, this.defaults);
    }

    return new StructuredLogger(this.component, {
      ...this.defaults,
      ...bindings
    });
  }

  info(message: string, meta: Record<string, unknown> = {}): void {
    this.emit("info", message, meta);
  }

  warn(message: string, meta: Record<string, unknown> = {}): void {
    this.emit("warn", message, meta);
  }

  error(message: string, meta: Record<string, unknown> = {}): void {
    this.emit("error", message, meta);
  }

  debug(message: string, meta: Record<string, unknown> = {}): void {
    this.emit("debug", message, meta);
  }

  private emit(level: LogLevel, message: string, meta: Record<string, unknown>): void {
    const runtime = currentBindings();
    const payload: StructuredLogEvent = {
      timestamp: new Date().toISOString(),
      level,
      component: String(meta.component ?? this.defaults.component ?? this.component),
      agent: (meta.agent as string | null | undefined) ?? this.defaults.agent ?? runtime.agent ?? null,
      action: (meta.action as string | null | undefined) ?? this.defaults.action ?? runtime.action ?? null,
      cycleId: (meta.cycleId as string | null | undefined) ?? this.defaults.cycleId ?? runtime.cycleId ?? null,
      message
    };

    for (const [key, value] of Object.entries(meta)) {
      if (!["component", "agent", "action", "cycleId"].includes(key)) {
        payload[key] = value;
      }
    }

    if (loggerOptions.verbose) {
      process.stderr.write(`${JSON.stringify(payload)}\n`);
    }
  }
}
