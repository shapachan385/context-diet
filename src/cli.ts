#!/usr/bin/env node
import fs from "node:fs";
import { createContextDietServer } from "./server/app.ts";
import { startStdioMcpServer } from "./mcp/server.ts";
import { runBenchmarkSuite } from "./benchmark/runner.ts";
import { smartCompress } from "./compressors/index.ts";

const args = process.argv.slice(2);
const command = args[0] || "serve";

async function main() {
  if (command === "mcp") {
    startStdioMcpServer();
    return;
  }

  if (command === "benchmark" || command === "bench") {
    console.log("\n========================================================");
    console.log("  ContextDiet — Multi-Modality Compression Benchmark");
    console.log("========================================================\n");
    const suite = runBenchmarkSuite();
    console.log(suite.markdownTable);
    console.log(
      `\n✅ Overall Token Reduction: -${suite.overallCompressionPct}% (${suite.totalOriginalTokens.toLocaleString()} -> ${suite.totalCompressedTokens.toLocaleString()} tokens)`
    );
    console.log(`✅ Key Fact Retention Recall: ${suite.overallRetentionRecallPct}%`);
    console.log(`⚡ Average Pipeline Latency: ${suite.averageLatencyMs} ms\n`);
    return;
  }

  if (command === "compress") {
    const filePath = args[1];
    if (!filePath || !fs.existsSync(filePath)) {
      console.error("Usage: context-diet compress <file-path>");
      process.exit(1);
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    const res = smartCompress(raw, { source: "cli" });
    console.log(res.compressedText);
    console.error(
      `\n[ContextDiet] Type=${res.detectedType} | Raw=${res.originalTokens} tokens -> Diet=${res.compressedTokens} tokens (-${res.compressionRatioPct}%) | Latency=${res.latencyMs}ms`
    );
    return;
  }

  // Default: "serve" -> Start Proxy + Web Dashboard + HTTP MCP Gateway
  const port = Number(process.env.PORT || args[1] || 4310);
  const server = createContextDietServer();
  server.listen(port, "127.0.0.1", () => {
    console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  ⚡ ContextDiet Gateway v0.1.0 is running!                       ║
╠══════════════════════════════════════════════════════════════════╣
║  🌐 Web Dashboard & Playground : http://127.0.0.1:${port}          ║
║  🔌 OpenAI Compatible Proxy    : http://127.0.0.1:${port}/v1       ║
║  🤖 Anthropic Compatible Proxy : http://127.0.0.1:${port}/v1/messages ║
║  🛠️  MCP HTTP Endpoint          : http://127.0.0.1:${port}/mcp      ║
╚══════════════════════════════════════════════════════════════════╝
`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
