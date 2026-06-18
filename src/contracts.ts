/**
 * Shared type contracts between CLI handlers and the client library.
 */

/** Parsed command-line arguments. */
export interface ParsedArgs {
  positionals: string[];
  options: Map<string, string[]>;
}

/** CLI runtime environment. */
export interface Runtime {
  stdout: (line: string) => void;
  stdoutRaw: (text: string) => void;
  stderr: (line: string) => void;
  fetch: typeof globalThis.fetch;
  env: Record<string, string | undefined>;
  homedir: () => string;
  isTTY: boolean;
}

/** Custom error for CLI usage / validation errors. */
export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliUsageError';
  }
}
