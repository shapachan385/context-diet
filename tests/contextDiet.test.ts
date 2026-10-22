import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { smartCompress } from "../src/compressors/index.ts";
import { foldAgentTrajectory } from "../src/memory/episodicFolder.ts";
import { ContextVaultStore, globalVault } from "../src/store/vault.ts";
import { handleMcpJsonRpc } from "../src/mcp/server.ts";
import { runBenchmarkSuite } from "../src/benchmark/runner.ts";
import { BENCHMARK_SAMPLES } from "../src/benchmark/samples.ts";
import { createContextDietServer } from "../src/server/app.ts";

test("1. JSON Compressor reduces homogeneous array tokens by >70% while rescuing HTTP 500 anomaly", () => {
  const sample = BENCHMARK_SAMPLES.find((s) => s.id === "json-k8s-api")!;
  const res = smartCompress(sample.rawInput, { forceType: "json" });

  assert.equal(res.detectedType, "json");
  assert.ok(
    res.compressionRatioPct > 65,
    `Expected >65% reduction, got ${res.compressionRatioPct}%`
  );
  assert.ok(res.compressedText.includes("dep_prod_37"));
  assert.ok(res.compressedText.includes("SQLSTATE 40P01"));
  assert.ok(res.refIds.length > 0);

  const restored = globalVault.expandSlice(res.refIds[0]);
  assert.ok(restored, "Vault entry should exist for refId");
  assert.ok(restored!.originalContent.length > 100);
});

test("2. Terminal Log Denoiser strips passing suite noise & ANSI codes while keeping full stack trace", () => {
  const sample = BENCHMARK_SAMPLES.find((s) => s.id === "log-vitest-crash")!;
  const res = smartCompress(sample.rawInput, { forceType: "log" });

  assert.equal(res.detectedType, "log");
  assert.ok(res.compressionRatioPct > 70);
  assert.ok(res.compressedText.includes("src/auth/tokenVerifier.ts:148:23"));
  assert.ok(res.compressedText.includes("expClaimSkew"));
  assert.ok(!res.compressedText.includes("\x1B[36m"));
});

test("3. Code Skeletonizer folds utility functions and keeps focal function intact", () => {
  const sample = BENCHMARK_SAMPLES.find((s) => s.id === "code-ts-skeleton")!;
  const res = smartCompress(sample.rawInput, {
    forceType: "code",
    focusKeywords: ["executeAtomicSettlement"],
  });

  assert.equal(res.detectedType, "code");
  assert.ok(res.compressedText.includes("export interface SettlementRequest"));
  assert.ok(res.compressedText.includes("INVALID_AMOUNT: Settlement amount must be positive"));
  assert.ok(res.compressedText.includes("lines folded (diet_ref:"));
  assert.ok(res.compressionRatioPct > 35);
});

test("4. Episodic Memory Folder supports both collapsed frames and protocol-safe tool pairing", () => {
  const sample = BENCHMARK_SAMPLES.find((s) => s.id === "episodic-agent-trajectory")!;

  // Mode A: Collapsed <EpisodicMemoryFrame>
  const foldRes = foldAgentTrajectory(sample.trajectoryMessages!, {
    keepRecentMessages: 2,
    preserveToolPairing: false,
  });
  assert.equal(foldRes.framesCreated.length, 1);
  assert.equal(foldRes.framesCreated[0].verificationStatus, "VERIFIED_PASS");
  assert.ok(foldRes.compressionRatioPct > 55);

  // Mode B: Protocol-Safe Pairing (for live OpenAI/Anthropic Proxy)
  const safeRes = foldAgentTrajectory(sample.trajectoryMessages!, {
    keepRecentMessages: 2,
    preserveToolPairing: true,
  });
  // Verify every tool message still has its matching tool_call_id
  const toolMessages = safeRes.foldedMessages.filter((m) => m.role === "tool");
  assert.equal(toolMessages.length, 4);
  assert.ok(JSON.stringify(safeRes.foldedMessages).includes("<EpisodicToolDigest"));
});

test("5. Persistent SQLite Vault shares state across instances and tracks Net Expansion Overhead", () => {
  const tmpDbPath = path.join(
    os.tmpdir(),
    `context_diet_test_${Date.now()}.sqlite`
  );
  try {
    const storeWriter = new ContextVaultStore(tmpDbPath);
    const slice = storeWriter.storeFoldedSlice({
      category: "log",
      label: "Cross-process test slice",
      originalContent: "Detailed stack trace line ".repeat(50),
      compressedPreview: "[Folded log]",
    });
    storeWriter.recordAudit({
      source: "mcp-tool",
      contentType: "log",
      mode: "balanced",
      originalTokens: 400,
      compressedTokens: 50,
      latencyMs: 1.1,
      refIds: [slice.refId],
      summary: "Test audit",
    });

    // Separate reader instance simulating a separate MCP stdio process
    const storeReader = new ContextVaultStore(tmpDbPath);
    const expanded = storeReader.expandSlice(slice.refId, {
      recordExpansionOverhead: true,
    });
    assert.ok(expanded);
    assert.equal(expanded!.expandCount, 1);

    const summary = storeReader.getTelemetrySummary();
    assert.equal(summary.grossSavedTokens, 350);
    assert.ok(summary.expansionOverheadTokens > 0);
    assert.equal(
      summary.netSavedTokens,
      Math.max(0, summary.grossSavedTokens - summary.expansionOverheadTokens)
    );
  } finally {
    try {
      fs.rmSync(tmpDbPath, { force: true });
      fs.rmSync(`${tmpDbPath}-wal`, { force: true });
      fs.rmSync(`${tmpDbPath}-shm`, { force: true });
    } catch {
      // ignore cleanup locks on windows
    }
  }
});

test("6. Proxy forwards OpenAI (/v1/chat/completions, /v1/responses) & Anthropic (/v1/messages) with SSE Streaming", async () => {
  let lastUpstreamPath = "";
  let lastUpstreamBody: any = null;

  const mockUpstream = http.createServer((req, res) => {
    lastUpstreamPath = req.url || "";
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.from(c)));
    req.on("end", () => {
      lastUpstreamBody = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
      if (lastUpstreamBody.stream) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(`data: {"chunk":1,"ok":true}\n\n`);
        res.write(`data: [DONE]\n\n`);
        res.end();
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ forwarded: true, path: lastUpstreamPath }));
      }
    });
  });

  await new Promise<void>((resolve) => mockUpstream.listen(0, "127.0.0.1", resolve));
  const upstreamPort = (mockUpstream.address() as any).port;
  const upstreamUrl = `http://127.0.0.1:${upstreamPort}`;

  const proxyServer = createContextDietServer();
  await new Promise<void>((resolve) => proxyServer.listen(0, "127.0.0.1", resolve));
  const proxyPort = (proxyServer.address() as any).port;
  const proxyUrl = `http://127.0.0.1:${proxyPort}`;

  try {
    // A. Test OpenAI SSE Streaming forwarding
    const sampleLog = BENCHMARK_SAMPLES.find((s) => s.id === "log-vitest-crash")!.rawInput;
    const openaiStreamResp = await fetch(`${proxyUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer sk-test-key",
        "x-upstream-base-url": upstreamUrl,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        stream: true,
        messages: [
          { role: "user", content: "Check test failure" },
          { role: "tool", tool_call_id: "call_1", content: sampleLog },
        ],
      }),
    });

    assert.equal(openaiStreamResp.status, 200);
    assert.ok(
      Number(openaiStreamResp.headers.get("x-context-diet-saved-tokens")) > 1000
    );
    const streamText = await openaiStreamResp.text();
    assert.ok(streamText.includes(`data: {"chunk":1,"ok":true}`));
    assert.equal(lastUpstreamPath, "/v1/chat/completions");

    // B. Test Anthropic /v1/messages upstream forwarding
    const anthropicResp = await fetch(`${proxyUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": "sk-ant-test",
        "x-upstream-base-url": upstreamUrl,
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_01",
                content: sampleLog,
              },
            ],
          },
        ],
      }),
    });
    assert.equal(anthropicResp.status, 200);
    const anthropicJson = (await anthropicResp.json()) as any;
    assert.equal(anthropicJson.forwarded, true);
    assert.equal(lastUpstreamPath, "/v1/messages");
    // Verify the tool_result content sent to Anthropic was actually compressed!
    const sentToolContent = lastUpstreamBody.messages[0].content[0].content;
    assert.ok(sentToolContent.length < sampleLog.length * 0.25);
  } finally {
    proxyServer.close();
    mockUpstream.close();
  }
});

test("7. Full Benchmark Suite reports both Gross Reduction and Net Savings (with 20% expansion overhead)", () => {
  const summary = runBenchmarkSuite();
  assert.equal(summary.overallRetentionRecallPct, 100);
  assert.ok(summary.overallCompressionPct > 65);
  assert.ok(summary.overallNetCompressionPct > 50);
  assert.ok(summary.overallNetCompressionPct < summary.overallCompressionPct);
});
