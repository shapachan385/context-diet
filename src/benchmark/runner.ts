import { smartCompress } from "../compressors/index.ts";
import { foldAgentTrajectory } from "../memory/episodicFolder.ts";
import { BENCHMARK_SAMPLES } from "./samples.ts";

export interface BenchmarkRowResult {
  id: string;
  title: string;
  category: string;
  originalTokens: number;
  compressedTokens: number;
  savedTokens: number;
  compressionRatioPct: number;
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
  overallCompressionPct: number;
  averageLatencyMs: number;
  overallRetentionRecallPct: number;
  markdownTable: string;
}

export function runBenchmarkSuite(): BenchmarkSuiteSummary {
  const results: BenchmarkRowResult[] = [];
  let totalOriginalTokens = 0;
  let totalCompressedTokens = 0;
  let totalLatencyMs = 0;
  let totalRetained = 0;
  let totalExpected = 0;

  for (const sample of BENCHMARK_SAMPLES) {
    let compressedOutput = "";
    let originalTokens = 0;
    let compressedTokens = 0;
    let savedTokens = 0;
    let compressionRatioPct = 0;
    let latencyMs = 0;

    if (sample.category === "episodic" && sample.trajectoryMessages) {
      const epRes = foldAgentTrajectory(sample.trajectoryMessages, {
        keepRecentMessages: 2,
        source: "cli",
      });
      compressedOutput = JSON.stringify(epRes.foldedMessages, null, 2);
      originalTokens = epRes.originalTokens;
      compressedTokens = epRes.compressedTokens;
      savedTokens = epRes.savedTokens;
      compressionRatioPct = epRes.compressionRatioPct;
      latencyMs = epRes.latencyMs;
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
      savedTokens = compRes.savedTokens;
      compressionRatioPct = compRes.compressionRatioPct;
      latencyMs = compRes.latencyMs;
    }

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
    totalLatencyMs += latencyMs;
    totalRetained += retainedCount;
    totalExpected += sample.mustRetainSubstrings.length;

    results.push({
      id: sample.id,
      title: sample.title,
      category: sample.category.toUpperCase(),
      originalTokens,
      compressedTokens,
      savedTokens,
      compressionRatioPct,
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
  const averageLatencyMs = Number((totalLatencyMs / results.length).toFixed(2));
  const overallRetentionRecallPct = Number(
    ((totalRetained / totalExpected) * 100).toFixed(1)
  );

  const mdLines = [
    "| Scenario / Modality | Raw Tokens | Diet Tokens | Token Reduction | Key Fact Recall | Latency |",
    "| :--- | :---: | :---: | :---: | :---: | :---: |",
    ...results.map(
      (r) =>
        `| **${r.title}** (\`${r.category}\`) | ${r.originalTokens.toLocaleString()} | ${r.compressedTokens.toLocaleString()} | **-${r.compressionRatioPct}%** | **${r.retentionRecallPct}%** (${r.retainedCount}/${r.totalMustRetain}) | ${r.latencyMs} ms |`
    ),
    `| **Total / Average** | **${totalOriginalTokens.toLocaleString()}** | **${totalCompressedTokens.toLocaleString()}** | **-${overallCompressionPct}%** | **${overallRetentionRecallPct}%** | **${averageLatencyMs} ms** |`,
  ];

  return {
    timestamp: new Date().toISOString(),
    results,
    totalOriginalTokens,
    totalCompressedTokens,
    totalSavedTokens,
    overallCompressionPct,
    averageLatencyMs,
    overallRetentionRecallPct,
    markdownTable: mdLines.join("\n"),
  };
}
