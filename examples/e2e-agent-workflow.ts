import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { createContextDietServer } from "../src/server/app.ts";
import { handleMcpJsonRpc } from "../src/mcp/server.ts";
import { BENCHMARK_SAMPLES } from "../src/benchmark/samples.ts";
import { countTokens, estimateCostSavingsUsd } from "../src/utils/tokenizer.ts";
import { globalVault } from "../src/store/vault.ts";
import type { AgentMessage } from "../src/memory/episodicFolder.ts";

/**
 * End-to-End Multi-Turn Coding Agent Workflow Simulation
 * Demonstrates:
 * 1. Cumulative multi-turn prompt token billing (Baseline vs. ContextDiet Proxy)
 * 2. Live SSE (`text/event-stream`) streaming pass-through
 * 3. On-demand MCP `diet_expand_frame` call against the SQLite Vault & Net Savings accounting
 */
async function runEndToEndWorkflow() {
  // Start a mock upstream LLM server that counts actual incoming prompt tokens per turn
  const upstreamTurnMetrics: Array<{
    turn: number;
    receivedPromptTokens: number;
    messageCount: number;
  }> = [];

  const mockUpstream = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.from(c)));
    req.on("end", () => {
      const bodyStr = Buffer.concat(chunks).toString("utf-8");
      const parsed = JSON.parse(bodyStr);
      const promptTokens = countTokens(JSON.stringify(parsed.messages || []));
      upstreamTurnMetrics.push({
        turn: upstreamTurnMetrics.length + 1,
        receivedPromptTokens: promptTokens,
        messageCount: (parsed.messages || []).length,
      });

      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(
        `data: ${JSON.stringify({
          id: `chatcmpl_turn_${upstreamTurnMetrics.length}`,
          object: "chat.completion.chunk",
          choices: [
            {
              index: 0,
              delta: {
                role: "assistant",
                content: `Turn ${upstreamTurnMetrics.length} verified.`,
              },
              finish_reason: "stop",
            },
          ],
        })}\n\n`
      );
      res.write(`data: [DONE]\n\n`);
      res.end();
    });
  });

  await new Promise<void>((r) => mockUpstream.listen(0, "127.0.0.1", r));
  const upstreamUrl = `http://127.0.0.1:${(mockUpstream.address() as any).port}`;

  const proxy = createContextDietServer();
  await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
  const proxyUrl = `http://127.0.0.1:${(proxy.address() as any).port}`;

  try {
    const vitestLog = BENCHMARK_SAMPLES.find((s) => s.id === "log-vitest-crash")!.rawInput;
    const tsCode = BENCHMARK_SAMPLES.find((s) => s.id === "code-ts-skeleton")!.rawInput;
    const k8sJson = BENCHMARK_SAMPLES.find((s) => s.id === "json-k8s-api")!.rawInput;

    const conversation: AgentMessage[] = [
      {
        role: "system",
        content: "You are a senior software engineering agent fixing a production bug.",
      },
      {
        role: "user",
        content: "Run the test suite, inspect the failing auth/settlement code, and check K8s health.",
      },
    ];

    const turnSteps = [
      {
        label: "Turn 1: Run Vitest Suite (225 tests, 1 buried failure)",
        assistantCall: {
          id: "call_vitest",
          name: "shell",
          args: '{"command":"pnpm test"}',
        },
        toolOutput: vitestLog,
      },
      {
        label: "Turn 2: Read TypeScript Settlement Module",
        assistantCall: {
          id: "call_read_ts",
          name: "read",
          args: '{"path":"src/settlement/service.ts"}',
        },
        toolOutput: tsCode,
      },
      {
        label: "Turn 3: Agent Calls MCP `diet_expand_frame` on Folded Function Body",
        assistantCall: {
          id: "call_expand",
          name: "diet_expand_frame",
          args: '{"reason":"Need full implementation of formatCurrencyDisplay"}',
        },
        toolOutput: "__TRIGGER_MCP_EXPAND__",
      },
      {
        label: "Turn 4: Fetch 65-Node K8s Telemetry JSON (Node #37 HTTP 500 Deadlock)",
        assistantCall: {
          id: "call_k8s",
          name: "kubectl_get",
          args: '{"cluster":"prod-global-k8s"}',
        },
        toolOutput: k8sJson,
      },
      {
        label: "Turn 5: Final Verification & Root-Cause Summary",
        assistantCall: {
          id: "call_verify",
          name: "shell",
          args: '{"command":"pnpm test src/auth/tokenVerifier.spec.ts"}',
        },
        toolOutput:
          "PASS src/auth/tokenVerifier.spec.ts (6 tests) 14ms\nTest Files 1 passed (1)\n0 failed\nexit code 0",
      },
    ];

    let cumulativeRawBilledTokens = 0;
    let cumulativeDietBilledTokens = 0;
    const reportRows: Array<{
      turn: number;
      description: string;
      rawTurnPromptTokens: number;
      dietTurnPromptTokens: number;
      turnSavingsPct: number;
    }> = [];

    for (let i = 0; i < turnSteps.length; i++) {
      const step = turnSteps[i];
      let resolvedToolOutput = step.toolOutput;

      if (resolvedToolOutput === "__TRIGGER_MCP_EXPAND__") {
        // Look up the latest code vault ref in SQLite and expand it via MCP JSON-RPC!
        const entries = globalVault.listVaultEntries(15);
        const codeEntry = entries.find((e) => e.category === "code") || entries[0];
        const mcpResp = handleMcpJsonRpc({
          jsonrpc: "2.0",
          id: `expand_${i}`,
          method: "tools/call",
          params: {
            name: "diet_expand_frame",
            arguments: { refId: codeEntry.refId },
          },
        });
        resolvedToolOutput = (mcpResp?.result as any).content[0].text;
      }

      conversation.push({
        role: "assistant",
        content: `Executing ${step.label}`,
        tool_calls: [
          {
            id: step.assistantCall.id,
            type: "function",
            function: {
              name: step.assistantCall.name,
              arguments: step.assistantCall.args,
            },
          },
        ],
      });

      conversation.push({
        role: "tool",
        name: step.assistantCall.name,
        tool_call_id: step.assistantCall.id,
        content: resolvedToolOutput,
      });

      // Baseline without ContextDiet: the raw conversation history is sent on every turn
      const rawTurnPromptTokens = countTokens(JSON.stringify(conversation));
      cumulativeRawBilledTokens += rawTurnPromptTokens;

      // With ContextDiet Streaming Proxy:
      const resp = await fetch(`${proxyUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer sk-e2e-demo",
          "x-upstream-base-url": upstreamUrl,
        },
        body: JSON.stringify({
          model: "claude-sonnet-4",
          stream: true,
          messages: conversation,
        }),
      });

      // Consume SSE stream
      await resp.text();

      const dietTurnPromptTokens =
        upstreamTurnMetrics[upstreamTurnMetrics.length - 1].receivedPromptTokens;
      cumulativeDietBilledTokens += dietTurnPromptTokens;

      const turnSavingsPct = Number(
        (((rawTurnPromptTokens - dietTurnPromptTokens) / rawTurnPromptTokens) * 100).toFixed(1)
      );

      reportRows.push({
        turn: i + 1,
        description: step.label,
        rawTurnPromptTokens,
        dietTurnPromptTokens,
        turnSavingsPct,
      });
    }

    const totalNetSaved = cumulativeRawBilledTokens - cumulativeDietBilledTokens;
    const totalNetSavingsPct = Number(
      ((totalNetSaved / cumulativeRawBilledTokens) * 100).toFixed(1)
    );

    console.log("\n================================================================================");
    console.log("  ContextDiet v0.2.0 — 5-Turn End-to-End Agent Session Billing Verification");
    console.log("================================================================================\n");
    console.log(
      "| Turn | Agent Action | Baseline Billed Prompt Tokens | ContextDiet Billed Tokens | Turn Reduction |"
    );
    console.log("| :---: | :--- | :---: | :---: | :---: |");
    for (const r of reportRows) {
      console.log(
        `| **#${r.turn}** | ${r.description} | ${r.rawTurnPromptTokens.toLocaleString()} | ${r.dietTurnPromptTokens.toLocaleString()} | **-${r.turnSavingsPct}%** |`
      );
    }
    console.log(
      `| **Cumulative Session Total** | **5 Turns (incl. Turn 3 Vault Expansion)** | **${cumulativeRawBilledTokens.toLocaleString()}** | **${cumulativeDietBilledTokens.toLocaleString()}** | **-${totalNetSavingsPct}%** |\n`
    );

    console.log(`💰 Cumulative Session Tokens Saved : ${totalNetSaved.toLocaleString()} tokens (-${totalNetSavingsPct}%)`);
    console.log(
      `💵 Estimated Session Cost Savings  : $${estimateCostSavingsUsd(totalNetSaved, "claude-sonnet-4")} (Sonnet 4) / $${estimateCostSavingsUsd(totalNetSaved, "claude-opus-4")} (Opus 4)`
    );
  } finally {
    proxy.close();
    mockUpstream.close();
  }
}

runEndToEndWorkflow().catch((err) => {
  console.error(err);
  process.exit(1);
});
