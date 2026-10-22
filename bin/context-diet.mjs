#!/usr/bin/env node
/**
 * npm launcher for ContextDiet.
 *
 * The TypeScript entrypoint (src/cli.ts) needs Node's native type stripping, and a
 * portable shebang cannot carry CLI flags (`--experimental-strip-types`) across
 * Windows and POSIX. This shim re-executes the real CLI on the current Node binary
 * with the flag set, so `npx context-diet ...` works everywhere.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

const result = spawnSync(
  process.execPath,
  ["--no-warnings", "--experimental-strip-types", cli, ...process.argv.slice(2)],
  { stdio: "inherit" }
);

if (result.error) {
  console.error(`Failed to launch ContextDiet: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 0);
