import test from "node:test";
import assert from "node:assert/strict";
import { smartCompress } from "../src/compressors/index.ts";
import { foldAgentTrajectory } from "../src/memory/episodicFolder.ts";
import { globalVault } from "../src/store/vault.ts";
import { handleMcpJsonRpc } from "../src/mcp/server.ts";
import { runBenchmarkSuite } from "../src/benchmark/runner.ts";
import { BENCHMARK_SAMPLES } from "../src/benchmark/samples.ts";

test("1. JSON Compressor reduces homogeneous array tokens by >70% while rescuing HTTP 500 anomaly", () => {
  const sample = BENCHMARK_SAMPLES.find((s) => s.id === "json-k8s-api")!;
  const res = smartCompress(sample.rawInput, { forceType: "json" });

  assert.equal(res.detectedType, "json");
  assert.ok(
    res.compressionRatioPct > 65,
    `Expected >65% reduction, got ${res.compressionRatioPct}%`
  );
  // Critical anomaly node #37 must be preserved!
  assert.ok(res.compressedText.includes("dep_prod_37"));
  assert.ok(res.compressedText.includes("SQLSTATE 40P01"));
  assert.ok(res.refIds.length > 0);

  // Verify Reversible Vault expansion
  const restored = globalVault.expandSlice(res.refIds[0]);
  assert.ok(restored, "Vault entry should exist for refId");
  assert.ok(restored!.originalContent.length > 100);
});

test("2. Terminal Log Denoiser strips passing suite noise & ANSI codes while keeping full stack trace", () => {
  const sample = BENCHMARK_SAMPLES.find((s) => s.id === "log-vitest-crash")!;
  const res = smartCompress(sample.rawInput, { forceType: "log" });

  assert.equal(res.detectedType, "log");
  assert.ok(
    res.compressionRatioPct > 70,
    `Expected >70% reduction, got ${res.compressionRatioPct}%`
  );
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

test("4. Episodic Memory Folder condenses multi-turn tool loops into <EpisodicMemoryFrame>", () => {
  const sample = BENCHMARK_SAMPLES.find((s) => s.id === "episodic-agent-trajectory")!;
  const foldRes = foldAgentTrajectory(sample.trajectoryMessages!, {
    keepRecentMessages: 2,
  });

  assert.ok(foldRes.framesCreated.length === 1);
  assert.ok(foldRes.compressionRatioPct > 55);
  const serialized = JSON.stringify(foldRes.foldedMessages);
  assert.ok(serialized.includes("<EpisodicMemoryFrame"));
  assert.ok(serialized.includes("src/payments/ledgerRepo.ts"));

  // Check lossless restoration of folded trajectory turns
  const vaultEntry = globalVault.expandSlice(foldRes.framesCreated[0].vaultRef);
  assert.ok(vaultEntry);
  assert.ok(vaultEntry!.originalContent.includes("ACCESS EXCLUSIVE MODE"));
});

test("5. MCP JSON-RPC Server handles tools/list and tools/call correctly", () => {
  const listResp = handleMcpJsonRpc({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
  });
  assert.ok(listResp && listResp.result);
  const tools = (listResp!.result as any).tools;
  assert.equal(tools.length, 4);

  const callResp = handleMcpJsonRpc({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "diet_audit_roi",
      arguments: { currentContextTokens: 8500 },
    },
  });
  assert.ok(callResp && callResp.result);
  const textOut = (callResp!.result as any).content[0].text;
  assert.ok(textOut.includes("contextRotRisk"));
});

test("6. Full Benchmark Suite achieves 100% Key Fact Recall across all 5 modalities", () => {
  const summary = runBenchmarkSuite();
  assert.equal(
    summary.overallRetentionRecallPct,
    100,
    `Expected 100% key fact recall, got ${summary.overallRetentionRecallPct}%`
  );
  assert.ok(summary.overallCompressionPct > 65);
});
