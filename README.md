<div align="center">

# ⚡ ContextDiet (v0.2.0)

**Streaming Context Engineering Proxy, Cross-Process SQLite Vault & MCP Server for Coding Agents**  
*面向 AI 编程 Agent（Codex CLI / Claude Code / OpenCode）的流式上下文压缩代理、持久化 SQLite 切片金库与 MCP 服务*

[![CI](https://github.com/shapachan385/context-diet/actions/workflows/ci.yml/badge.svg)](https://github.com/shapachan385/context-diet/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-emerald.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.6-38bdf8.svg)](https://nodejs.org)
[![MCP Compatible](https://img.shields.io/badge/MCP-2024--11--05-8b5cf6.svg)](https://modelcontextprotocol.io)
[![Net Savings](https://img.shields.io/badge/Net_Savings-67.1%25_(w/_20%25_Expand)-10b981.svg)](#reproducible-benchmark-gross-vs-net-savings)

</div>

---

## 🎯 Problem & Engineering Scope

When Coding & Web Agents (**OpenAI Codex CLI, Claude Code, OpenCode, Cursor**) run multi-step debugging workflows, single tool outputs (`vitest`/`pytest` logs, K8s JSON responses, large source files, DOM snapshots) routinely inject **5,000–10,000+ noisy tokens** into the conversation history. Because stateless LLM APIs re-send the conversation history on every turn, a single 8,000-token log in Turn 1 costs **40,000 billed prompt tokens** across a 5-turn debugging loop.

**ContextDiet** is a zero-dependency, deterministic local middleware that operates as both a **Streaming Reverse Proxy** and a **Model Context Protocol (MCP) Server**:

1. **Real Upstream Forwarding with SSE Streaming (`stream: true`)**:
   - **OpenAI Chat Completions** (`POST /v1/chat/completions`)
   - **OpenAI Responses API** (`POST /v1/responses` — used by OpenAI Codex CLI)
   - **Anthropic Messages API** (`POST /v1/messages` — used by Claude Code)
2. **Cross-Process Persistent SQLite Vault (`node:sqlite` WAL Mode)**:
   - Every omitted JSON array slice, log block, or folded function body is persisted in `.context-diet/vault.sqlite` with a deterministic hash (`diet_ref:<sha256_prefix>`).
   - Using SQLite in `WAL` (`Write-Ahead Logging`) mode allows the **HTTP Proxy**, **MCP stdio process**, and **CLI** to share the exact same persistent store across processes and restarts.
   - When an agent needs raw omitted lines, calling the MCP tool `diet_expand_frame({ refId })` restores the exact original slice from SQLite and records the **Expansion Overhead** so you can track true **Net Token Savings** (`Gross Saved - Expansion Overhead`).
3. **Protocol-Safe Episodic Folding (`preserveToolPairing: true`)**:
   - In live Proxy mode, historical tool outputs outside the active window are folded *in-place* into `<EpisodicToolDigest>` summaries without breaking `assistant.tool_calls` ↔ `tool.tool_call_id` schema pairing constraints.

---

## 📊 Reproducible Benchmark: Gross vs. Net Savings

Run `npm run bench` to execute the built-in 5-modality benchmark suite.

### Methodology & Honest Accounting Notes:
- **Token Estimation**: Offline benchmarks use a deterministic heuristic BPE estimator (`src/utils/tokenizer.ts`). When forwarding live traffic through the proxy, actual upstream `usage.prompt_tokens` / `usage.input_tokens` are returned alongside local estimates.
- **Gross vs. Net Savings**: Aggressive compression occasionally requires the model to expand a folded block. The benchmark below explicitly models a **20% Vault Expansion rate** (plus 45 tokens of MCP tool call framing per expansion) to report realistic **Net Single-Turn Savings**.
- **Target String Recall**: Verifies that designated critical strings (buried HTTP 500 deadlock entries, stack trace line numbers, exported TypeScript interfaces, interactive DOM selectors) remain present in the compressed output.

| Scenario / Modality | Raw Tokens (Est.) | Diet Tokens | Gross Reduction | Net Savings (w/ 20% Expand) | Target String Recall | Latency |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **K8s Cluster 65-Node JSON Telemetry (Anomalous 500 Deadlock)** (`JSON`) | 7,970 | 817 | -89.7% | **-69.8%** | **100%** (5/5) | 3.54 ms |
| **Vitest 225-Test Verbose CI Log (1 Buried Assertion Failure)** (`LOG`) | 7,759 | 293 | -96.2% | **-76.3%** | **100%** (5/5) | 1.74 ms |
| **TypeScript Settlement Service (AST Skeleton + Focus Preservation)** (`CODE`) | 974 | 626 | -35.7% | **-21.4%** | **100%** (6/6) | 0.96 ms |
| **Browser Agent DOM Snapshot (SVG + Base64 + Tailwind Pruning)** (`DOM`) | 5,918 | 1,236 | -79.1% | **-63.5%** | **100%** (5/5) | 1.25 ms |
| **12-Turn Debugging Trajectory (Episodic Memory Folding)** (`EPISODIC`) | 2,167 | 534 | -75.4% | **-54.5%** | **100%** (5/5) | 1.11 ms |
| **Total / Average** | **24,788** | **3,506** | **-85.9%** | **-67.1%** | **100%** | **1.72 ms** |

---

## 🔄 End-to-End 5-Turn Agent Session Evaluation (`npm run demo:e2e`)

To verify how single-payload compression and on-demand Vault expansion behave across a multi-turn session, run `npm run demo:e2e` (see full analysis in [`docs/REAL_WORLD_EVALUATION.md`](docs/REAL_WORLD_EVALUATION.md)):

| Turn | Agent Action | Baseline Billed Prompt Tokens | ContextDiet Billed Tokens | Turn Reduction |
| :---: | :--- | :---: | :---: | :---: |
| **#1** | Turn 1: Run Vitest Suite (225 tests, 1 buried failure) | 8,331 | 494 | **-94.1%** |
| **#2** | Turn 2: Read TypeScript Settlement Module | 9,576 | 1,305 | **-86.4%** |
| **#3** | Turn 3: Agent Calls MCP `diet_expand_frame` on Folded Function Body | 9,896 | 1,395 | **-85.9%** |
| **#4** | Turn 4: Fetch 65-Node K8s Telemetry JSON (Node #37 HTTP 500 Deadlock) | 19,923 | 1,937 | **-90.3%** |
| **#5** | Turn 5: Final Verification & Root-Cause Summary | 20,078 | 2,083 | **-89.6%** |
| **Cumulative Session Total** | **5 Turns (incl. Turn 3 Vault Expansion)** | **67,804** | **7,214** | **-89.4%** |

---

## 🚀 Quick Start & Agent Integration

### 1. Clone & Verify (Zero Runtime Dependencies, Requires Node.js >= 22.6)
```bash
git clone https://github.com/shapachan385/context-diet.git
cd context-diet
npm test
npm run bench
npm run demo:e2e
```

### 2. Start the Gateway & Web Dashboard
```bash
npm start
# Open http://127.0.0.1:4310 in your browser
```

### 3. Connect Real Agents via Streaming Proxy + MCP

#### Option A: OpenAI Codex CLI / OpenAI SDK (`/v1/responses` & `/v1/chat/completions`)
```bash
export OPENAI_BASE_URL="http://127.0.0.1:4310/v1"
export OPENAI_API_KEY="sk-..."
```
ContextDiet automatically compresses oversized `function_call_output` / `tool` payloads, preserves `tool_call_id` pairing, and streams SSE responses (`text/event-stream`) from `https://api.openai.com` (or any custom `x-upstream-base-url`).

#### Option B: Claude Code / Anthropic SDK (`/v1/messages`)
```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:4310"
export ANTHROPIC_API_KEY="sk-ant-..."
```
ContextDiet compresses `tool_result` blocks inside user turns and forwards `x-api-key`, `anthropic-version`, and `anthropic-beta` headers to `https://api.anthropic.com` with full SSE streaming pass-through.

#### Option C: Register the MCP Server (for On-Demand Vault Expansion)
Add `context-diet` to your Agent's `mcpServers` config so the Agent can call `diet_expand_frame` against the shared `.context-diet/vault.sqlite` database:
```json
{
  "mcpServers": {
    "context-diet": {
      "command": "node",
      "args": [
        "--no-warnings",
        "--experimental-strip-types",
        "/absolute/path/to/context-diet/src/cli.ts",
        "mcp"
      ]
    }
  }
}
```
