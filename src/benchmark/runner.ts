import { smartCompress } from "../compressors/index.ts";
import { foldAgentTrajectory } from "../memory/episodicFolder.ts";
import { globalVault } from "../store/vault.ts";
import { BENCHMARK_SAMPLES } from "./samples.ts";

export interface BenchmarkRowResult {
  id: string;
  title: string;
  category: string;
  originalTokens: number;
  compressedTokens: number;
  grossSavedTokens: number;
  grossCompressionPct: number;
  simulatedExpansionOverheadTokens: number;
  netSavedTokens: number;
  netCompressionPct: number;
  latencyMs: number;
  retentionRecallPct: number;
  retainedCount: number;
  totalMustRetain: number;
  missingSubstrings: string[];
}

export interface BenchmarkSuiteSummary {
  timestamp: string;
  results: BenchmarkRowResult[];
  totalOriginalTokens: number;
  totalCompressedTokens: number;
  totalSavedTokens: number;
  totalNetSavedTokens: number;
  overallCompressionPct: number;
  overallNetCompressionPct: number;
  averageLatencyMs: number;
  overallRetentionRecallPct: number;
  markdownTable: string;
}

/**
 * Runs the multi-modality benchmark suite and computes BOTH:
 * 1. Gross Single-Turn Payload Reduction (%)
 * 2. Net Session Token Savings (%) accounting for a 20% Vault Expansion rate + MCP tool-call overhead
 */
export function runBenchmarkSuite(): BenchmarkSuiteSummary {
  const results: BenchmarkRowResult[] = [];
  let totalOriginalTokens = 0;
  let totalCompressedTokens = 0;
  let totalNetSavedTokens = 0;
  let totalLatencyMs = 0;
  let totalRetained = 0;
  let totalExpected = 0;

  for (const sample of BENCHMARK_SAMPLES) {
    let compressedOutput = "";
    let originalTokens = 0;
    let compressedTokens = 0;
    let grossSavedTokens = 0;
    let grossCompressionPct = 0;
    let latencyMs = 0;
    let refIds: string[] = [];

    if (sample.category === "episodic" && sample.trajectoryMessages) {
      const epRes = foldAgentTrajectory(sample.trajectoryMessages, {
        keepRecentMessages: 2,
        preserveToolPairing: false,
        source: "cli",
      });
      compressedOutput = JSON.stringify(epRes.foldedMessages, null, 2);
      originalTokens = epRes.originalTokens;
      compressedTokens = epRes.compressedTokens;
      grossSavedTokens = epRes.savedTokens;
      grossCompressionPct = epRes.compressionRatioPct;
      latencyMs = epRes.latencyMs;
      refIds = epRes.framesCreated.map((f) => f.vaultRef);
    } else {
      const compRes = smartCompress(sample.rawInput, {
        forceType: sample.category as "json" | "log" | "code" | "dom",
        focusKeywords:
          sample.category === "code" ? ["executeAtomicSettlement"] : undefined,
        source: "cli",
      });
      compressedOutput = compRes.compressedText;
      originalTokens = compRes.originalTokens;
      compressedTokens = compRes.compressedTokens;
      grossSavedTokens = compRes.savedTokens;
      grossCompressionPct = compRes.compressionRatioPct;
      latencyMs = compRes.latencyMs;
      refIds = compRes.refIds;
    }

    // Calculate realistic expansion overhead: assume the agent expands 20% of folded vault slices
    // plus 45 tokens of MCP tool call/response framing overhead per expansion
    let totalVaultSliceTokens = 0;
    for (const refId of refIds) {
      const entry = globalVault.expandSlice(refId, { recordExpansionOverhead: false });
      if (entry) totalVaultSliceTokens += entry.originalTokens;
    }
    const simulatedExpansionOverheadTokens = Math.round(totalVaultSliceTokens * 0.2) + (refIds.length > 0 ? 45 : 0);
    const netSavedTokens = Math.max(0, grossSavedTokens - simulatedExpansionOverheadTokens);
    const netCompressionPct =
      originalTokens > 0
        ? Number(((netSavedTokens / originalTokens) * 100).toFixed(1))
        : 0;

    const missingSubstrings: string[] = [];
    for (const needle of sample.mustRetainSubstrings) {
      if (!compressedOutput.includes(needle)) {
        missingSubstrings.push(needle);
      }
    }

    const retainedCount = sample.mustRetainSubstrings.length - missingSubstrings.length;
    const retentionRecallPct = Number(
      ((retainedCount / sample.mustRetainSubstrings.length) * 100).toFixed(1)
    );

    totalOriginalTokens += originalTokens;
    totalCompressedTokens += compressedTokens;
    totalNetSavedTokens += netSavedTokens;
    totalLatencyMs += latencyMs;
    totalRetained += retainedCount;
    totalExpected += sample.mustRetainSubstrings.length;

    results.push({
      id: sample.id,
      title: sample.title,
      category: sample.category.toUpperCase(),
      originalTokens,
      compressedTokens,
      grossSavedTokens,
      grossCompressionPct,
      simulatedExpansionOverheadTokens,
      netSavedTokens,
      netCompressionPct,
      latencyMs,
      retentionRecallPct,
      retainedCount,
      totalMustRetain: sample.mustRetainSubstrings.length,
      missingSubstrings,
    });
  }

  const totalSavedTokens = Math.max(0, totalOriginalTokens - totalCompressedTokens);
  const overallCompressionPct =
    totalOriginalTokens > 0
      ? Number(((totalSavedTokens / totalOriginalTokens) * 100).toFixed(1))
      : 0;
  const overallNetCompressionPct =
    totalOriginalTokens > 0
      ? Number(((totalNetSavedTokens / totalOriginalTokens) * 100).toFixed(1))
      : 0;
  const averageLatencyMs = Number((totalLatencyMs / results.length).toFixed(2));
  const overallRetentionRecallPct = Number(
    ((totalRetained / totalExpected) * 100).toFixed(1)
  );

  const mdLines = [
    "| Scenario / Modality | Raw Tokens (Est.) | Diet Tokens | Gross Reduction | Net Savings (w/ 20% Expand) | Target String Recall | Latency |",
    "| :--- | :---: | :---: | :---: | :---: | :---: | :---: |",
    ...results.map(
      (r) =>
        `| **${r.title}** (\`${r.category}\`) | ${r.originalTokens.toLocaleString()} | ${r.compressedTokens.toLocaleString()} | -${r.grossCompressionPct}% | **-${r.netCompressionPct}%** | **${r.retentionRecallPct}%** (${r.retainedCount}/${r.totalMustRetain}) | ${r.latencyMs} ms |`
    ),
    `| **Total / Average** | **${totalOriginalTokens.toLocaleString()}** | **${totalCompressedTokens.toLocaleString()}** | **-${overallCompressionPct}%** | **-${overallNetCompressionPct}%** | **${overallRetentionRecallPct}%** | **${averageLatencyMs} ms** |`,
  ];

  return {
    timestamp: new Date().toISOString(),
    results,
    totalOriginalTokens,
    totalCompressedTokens,
    totalSavedTokens,
    totalNetSavedTokens,
    overallCompressionPct,
    overallNetCompressionPct,
    averageLatencyMs,
    overallRetentionRecallPct,
    markdownTable: mdLines.join("\n"),
  };
}
