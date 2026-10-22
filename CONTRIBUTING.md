# Contributing to ContextDiet

Thanks for taking a look. This guide covers the local workflow and the conventions the
existing code follows.

## Requirements

- Node.js **>= 22.6**. The project runs TypeScript sources directly through Node's native
  type stripping, so there is no build step.
- **No runtime dependencies.** Please keep it that way unless there is a strong reason not
  to — it is a deliberate part of the design (easy to audit, no supply chain surface).

## Setup

```bash
git clone https://github.com/shapachan385/context-diet.git
cd context-diet
```

There is nothing to install and nothing to compile.

## Running things

```bash
npm test        # 6 end-to-end tests (node:test)
npm run bench   # 5-modality compression benchmark, prints a markdown table
npm start       # dashboard + proxy gateway on http://127.0.0.1:4310
npm run mcp     # MCP server over stdio
```

## Layout

| Path | Purpose |
| --- | --- |
| `src/compressors/` | Modality detection (`index.ts`) plus one compressor per modality |
| `src/memory/episodicFolder.ts` | Folds multi-turn agent loops into `<EpisodicMemoryFrame>` |
| `src/store/vault.ts` | Reversible vault: `diet_ref` hashes for lossless restore |
| `src/mcp/server.ts` | MCP JSON-RPC server (stdio + HTTP) |
| `src/server/app.ts` | OpenAI/Anthropic compatible proxy + dashboard API |
| `src/benchmark/` | Fixtures (`samples.ts`) and the measurement harness (`runner.ts`) |

## Adding a new modality or compressor

1. Add the compressor under `src/compressors/`, following the shape of an existing one: it
   takes raw text and returns `compressedText` plus token counts and `refIds`.
2. Register it in the router in `src/compressors/index.ts`.
3. Add a realistic fixture to `BENCHMARK_SAMPLES` in `src/benchmark/samples.ts`. Fixtures
   should look like genuine tool output — that is what makes the published numbers
   meaningful.
4. Add a test in `tests/contextDiet.test.ts` asserting that the **critical facts survive**.
   Every compressor is expected to preserve anomalies, stack traces, and exit codes while
   folding the noise. Compression ratio alone is never a passing criterion.
5. Run `npm test && npm run bench` and include the resulting benchmark row in your PR
   description.

## Reporting numbers

The figures in `README.md` come from `npm run bench`. If you change a compressor or a
fixture, update the README tables in the same pull request so the documentation cannot
drift away from the measurement. Please do not publish compression numbers that are not
reproducible from the committed fixtures.

## Style

- ESM with explicit `.ts` extensions on relative imports (required by Node's type
  stripping).
- `strict` TypeScript is enabled; `npm test` must pass. CI runs the same command plus the
  benchmark suite.
- Keep naming and public API shape consistent with the surrounding code.
