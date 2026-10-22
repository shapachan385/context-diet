<div align="center">

# ⚡ ContextDiet

**Smart Context Engineering Gateway, Lossless Tool Output Compressor & Episodic Memory Folder for AI Agents**  
*面向 AI Agent 的智能上下文压缩网关、可逆无损切片金库与情景记忆折叠引擎*

[![CI](https://github.com/shapachan385/context-diet/actions/workflows/ci.yml/badge.svg)](https://github.com/shapachan385/context-diet/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-emerald.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.6-38bdf8.svg)](https://nodejs.org)
[![MCP Compatible](https://img.shields.io/badge/MCP-2024--11--05-8b5cf6.svg)](https://modelcontextprotocol.io)
[![Token Savings](https://img.shields.io/badge/Token_Savings-up_to_96%25-10b981.svg)](#benchmark--evaluation)

</div>

---

## 🔥 Why ContextDiet? (The Problem)

Modern AI Coding & Research Agents (**Claude Code, OpenCode, Cursor, LangGraph, AutoGen**) suffer from two critical bottlenecks during long-horizon tasks:
1. **Token Bloat from Noisy Tool Outputs**: A single `vitest` run, K8s JSON dump, or scraped DOM page can inject **8,000+ noisy tokens** into the context window, where 95% is repetitive boilerplate.
2. **Context Rot (Attention Dilution)**: After 15–30 turns of trial-and-error (`grep` → `read` → failed test → retry), intermediate noise pollutes the LLM's attention mechanism, degrading reasoning accuracy while multiplying API costs.

**ContextDiet** sits between your Agent and Tools/LLMs (as an **MCP Server** or **Transparent OpenAI/Anthropic Proxy**) and shrinks context tokens by **36%–96%** (**85.9%** average across its five-modality benchmark) in a few milliseconds with **100% lossless recovery on demand**.

---

## ✨ Core Architecture & Key Innovations

```text
+--------------------+         +-------------------------------------------------------+
|   Coding / Web     |  MCP /  |                  ⚡ ContextDiet Engine                 |
|      Agents        |  Proxy  |                                                       |
| (Claude / OpenCode | <=====> |  1. Modality Router (JSON / Log / AST Code / DOM)     |
|  Cursor / OpenAI)  |         |  2. Anomaly & Stack-Trace Rescue Filter               |
+--------------------+         |  3. Episodic Memory Folder (<EpisodicMemoryFrame>)    |
                               |  4. Reversible Vault (diet_ref:hash -> 100% Restore)  |
                               +-------------------------------------------------------+
```

1. **Structure-Aware Multi-Modal Compression (`src/compressors/`)**:
   - **`JSON Schema & Anomaly Compressor`**: Infers unified schema & value distributions for homogeneous arrays, keeps head/tail samples, **automatically rescues any middle item containing HTTP 4xx/5xx or error keywords**, and folds the rest.
   - **`Terminal & CI Log Denoiser`**: Strips ANSI codes and passing test spam (`✓ 224 passed`) while preserving 100% of error stack traces, causal context lines, and exit codes.
   - **`AST-Inspired Code Skeletonizer`**: Preserves imports, exported interfaces/types, and function signatures while folding non-focal implementation bodies.
   - **`Browser Agent DOM Pruner`**: Strips inline `<svg>`, base64 blobs, `<script>` blocks, and Tailwind class soup while keeping interactive selectors (`id`, `name`, `data-testid`, `role`).
2. **Episodic Memory Folding (`src/memory/episodicFolder.ts`)**:
   - Condenses multi-turn intermediate debugging loops into structured `<EpisodicMemoryFrame>` blocks containing `<ToolsInvoked>`, `<FilesTouched>`, and `<PitfallsEncountered>` (preventing agents from repeating the same mistake).
3. **100% Lossless Reversible Vault (`src/store/vault.ts`)**:
   - Every folded block is indexed by a deterministic hash (`diet_ref:a1b2c3d4`). If the LLM ever needs the raw omitted lines, it simply invokes the MCP tool `diet_expand_frame({ refId })` to restore the exact original content.

---

## 📊 Reproducible Benchmark & Key Fact Recall

Run `npm run bench` to verify on the built-in 5-modality benchmark suite:

| Scenario / Modality | Raw Tokens | Diet Tokens | Token Reduction | Key Fact Recall | Latency |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **K8s Cluster 65-Node JSON Telemetry (Anomalous 500 Deadlock)** (`JSON`) | 7,970 | 814 | **-89.8%** | **100%** (5/5) | 3.43 ms |
| **Vitest 225-Test Verbose CI Log (1 Buried Assertion Failure)** (`LOG`) | 7,759 | 292 | **-96.2%** | **100%** (5/5) | 2.09 ms |
| **TypeScript Settlement Service (AST Skeleton + Focus Preservation)** (`CODE`) | 974 | 625 | **-35.8%** | **100%** (6/6) | 0.91 ms |
| **Browser Agent DOM Snapshot (SVG + Base64 + Tailwind Pruning)** (`DOM`) | 5,918 | 1,222 | **-79.4%** | **100%** (5/5) | 0.83 ms |
| **12-Turn Debugging Trajectory (Episodic Memory Folding)** (`EPISODIC`) | 2,167 | 533 | **-75.4%** | **100%** (5/5) | 0.72 ms |
| **Total / Average** | **24,788** | **3,486** | **-85.9%** | **100%** | **1.60 ms** |

Token counts and key-fact recall are deterministic and reproducible from the committed fixtures.
The latency column is wall-clock time from a single machine and will vary with your hardware and
load — treat it as indicative rather than a comparable benchmark result.

---

## 🚀 Quick Start

### 1. Get the code

ContextDiet has no runtime dependencies, so there is nothing to install and no build step.
You only need Node.js >= 22.6.

```bash
git clone https://github.com/shapachan385/context-diet.git
cd context-diet
node --version   # must be >= 22.6
```

### 2. Start the Web Dashboard, Playground & Proxy Gateway
```bash
node --experimental-strip-types src/cli.ts serve 4310
# Open http://127.0.0.1:4310 in your browser
```

### 3. Run Automated Tests & Benchmark Suite
```bash
npm test
npm run bench
```

### 4. Connect as an MCP Server (Claude Code / OpenCode / Cursor)
Add to your MCP configuration:
```json
{
  "mcpServers": {
    "context-diet": {
      "command": "node",
      "args": [
        "--experimental-strip-types",
        "/absolute/path/to/context-diet/src/cli.ts",
        "mcp"
      ]
    }
  }
}
```

#### Exposed MCP Tools:
- `diet_compress_output`: Compress noisy JSON, logs, source code, or DOM snapshots.
- `diet_fold_trajectory`: Fold multi-turn agent trajectories into `<EpisodicMemoryFrame>` blocks.
- `diet_expand_frame`: Losslessly restore any folded slice by its `diet_ref:...` ID.
- `diet_audit_roi`: Query session token savings, USD ROI, and Context Rot risk score.
