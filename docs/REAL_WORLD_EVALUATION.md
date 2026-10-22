# End-to-End Multi-Turn Agent Session Evaluation (`v0.2.0`)

This document addresses how single-payload compression translates into **cumulative multi-turn prompt billing savings** during a realistic coding agent debugging session, including the token overhead of on-demand Vault expansions (`diet_expand_frame`).

You can reproduce this exact 5-turn verification locally at any time by running:

```bash
npm run demo:e2e
```

---

## 1. Why Multi-Turn Cumulative Accounting Matters

In stateless LLM APIs (`/v1/chat/completions`, `/v1/responses`, `/v1/messages`), every turn re-transmits the prior `messages[]` array.
- If Turn 1 injects a **7,759-token** verbose test log, that payload is billed **5 times** over a 5-turn debugging loop (**38,795 tokens** of cumulative billing from a single command).
- Conversely, if the agent needs to expand a folded slice on Turn 3 via `diet_expand_frame`, only that specific slice is added from Turn 3 onward.

---

## 2. Reproducible 5-Turn Debugging Trajectory (`examples/e2e-agent-workflow.ts`)

The script spins up a local upstream server, routes all 5 streaming (`stream: true`) turns through the ContextDiet Proxy, triggers an explicit MCP `diet_expand_frame` call on Turn 3 against `.context-diet/vault.sqlite`, and measures the exact prompt payload delivered to the upstream model on each turn:

| Turn | Agent Action | Baseline Billed Prompt Tokens | ContextDiet Billed Tokens | Turn Reduction |
| :---: | :--- | :---: | :---: | :---: |
| **#1** | Turn 1: Run Vitest Suite (225 tests, 1 buried failure) | 8,331 | 494 | **-94.1%** |
| **#2** | Turn 2: Read TypeScript Settlement Module | 9,576 | 1,305 | **-86.4%** |
| **#3** | Turn 3: Agent Calls MCP `diet_expand_frame` on Folded Function Body | 9,896 | 1,395 | **-85.9%** |
| **#4** | Turn 4: Fetch 65-Node K8s Telemetry JSON (Node #37 HTTP 500 Deadlock) | 19,923 | 1,937 | **-90.3%** |
| **#5** | Turn 5: Final Verification & Root-Cause Summary | 20,078 | 2,083 | **-89.6%** |
| **Cumulative Session Total** | **5 Turns (incl. Turn 3 Vault Expansion)** | **67,804** | **7,214** | **-89.4%** |

---

## 3. Architectural Guarantees Verified

1. **SSE Streaming Pass-Through**: Every turn uses `stream: true` (`Content-Type: text/event-stream`) and verifies chunked streaming delivery.
2. **Protocol-Safe Tool Pairing (`preserveToolPairing: true`)**: When Turn 5 folds earlier historical tool outputs (`Turns 1–2`), it replaces their content with `<EpisodicToolDigest ref="diet_ref:..." />` *in-place* while preserving `role: "tool"` and `tool_call_id` so strict OpenAI/Anthropic schema validators never reject the request.
3. **Cross-Process SQLite WAL Persistence**: Turn 3 invokes `handleMcpJsonRpc` (`diet_expand_frame`) and reads the folded code slice directly from `.context-diet/vault.sqlite`, incrementing `expand_count` and billing the expanded tokens in Turns 3–5.
