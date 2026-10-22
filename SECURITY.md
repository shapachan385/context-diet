# Security Policy

## Scope and threat model

ContextDiet is a **local, single-user** tool. It is meant to run on a developer machine
next to your AI agent, not as a shared or internet-facing service.

Properties of the current design that matter for security:

- **Loopback only.** The HTTP server binds to `127.0.0.1` (`src/cli.ts`). It does not
  listen on `0.0.0.0`, so it is not reachable from your network.
- **No telemetry.** There is no analytics, crash reporting, or phone-home behaviour. The
  counters surfaced as "telemetry" in the dashboard and by the `diet_audit_roi` MCP tool
  are in-process values that never leave your machine.
- **No persistence.** The reversible vault (`src/store/vault.ts`) is held in memory only;
  folded slices disappear when the process exits and nothing is written to disk. The only
  file the codebase reads is the path you pass explicitly to
  `context-diet compress <file>`.
- **Explicit upstream forwarding only.** The OpenAI/Anthropic compatible proxy performs an
  outbound request **only when the client sets the `x-upstream-base-url` header**. Without
  that header it returns a local dry-run response and makes no network call at all. When it
  does forward, it passes through the `Authorization` header supplied by the client;
  ContextDiet does not store, log, or substitute its own credentials.

## Known limitations

- The dashboard and HTTP API have **no authentication**. Any user or process on the same
  machine can reach them while the server is running. Do not expose the port through a
  reverse proxy, tunnel, or port-forward without adding your own authentication layer.
- The vault grows in memory for the lifetime of the process, so a very long session will
  grow with it. Long-running or multi-tenant deployments are out of scope today.
- The proxy forwards whatever the client sends upstream. Review what your agent puts in
  the context window; compression does not redact secrets for you.

## Reporting a vulnerability

Please report privately through GitHub's private vulnerability reporting:

https://github.com/shapachan385/context-diet/security/advisories/new

Include reproduction steps, the affected version or commit, and the impact you observed.
Please do not open a public issue for an unfixed vulnerability.

This is a small, single-maintainer project, so a response may take a while. There is no
formal SLA.

## Supported versions

The project is pre-1.0 and evolving quickly. Only the latest release on `main` is
supported; fixes are not backported to older tags.
