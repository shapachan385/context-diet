import { countTokens } from "../utils/tokenizer.ts";
import { globalVault, type AuditRecord } from "../store/vault.ts";
import {
  compressJsonPayload,
  type CompressionOptions,
  type CompressorOutput,
} from "./jsonCompressor.ts";
import { compressTerminalLog } from "./logCompressor.ts";
import { compressSourceCode } from "./codeCompressor.ts";
import { compressDomContent } from "./domCompressor.ts";

export type DetectedContentType = "json" | "log" | "code" | "dom" | "mixed";

export interface SmartCompressionResult {
  detectedType: DetectedContentType;
  originalText: string;
  compressedText: string;
  originalTokens: number;
  compressedTokens: number;
  savedTokens: number;
  compressionRatioPct: number;
  latencyMs: number;
  refIds: string[];
  metadata: Record<string, unknown>;
  auditRecord?: AuditRecord;
}

/**
 * Automatically detects the modality/structure of an Agent tool output
 */
export function detectContentType(text: string): DetectedContentType {
  const trimmed = text.trim();
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      JSON.parse(trimmed);
      return "json";
    } catch {
      // Fall through
    }
  }

  if (
    /<(!DOCTYPE|html|head|body|div|script|svg|table|section)\b/i.test(trimmed) &&
    /<\/(div|html|body|svg|script|section)>/i.test(trimmed)
  ) {
    return "dom";
  }

  const lines = trimmed.split("\n").slice(0, 40);
  const logIndicators = lines.filter((l) =>
    /(\b(INFO|DEBUG|WARN|ERROR|PASS|FAIL)\b|^\s*(✓|✔|✕|●)\s|\x1B\[|\bat\s+.+:\d+:\d+|\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2})/.test(
      l
    )
  ).length;
  if (logIndicators >= 3) {
    return "log";
  }

  const codeIndicators = lines.filter((l) =>
    /^\s*(import\s+.+from|export\s+(interface|type|class|function|const)|function\s+\w+|def\s+\w+|class\s+\w+|package\s+\w+)/.test(
      l
    )
  ).length;
  if (codeIndicators >= 2) {
    return "code";
  }

  return "log";
}

/**
 * Main entry point for ContextDiet Smart Tool Output Compression
 */
export function smartCompress(
  rawText: string,
  options: CompressionOptions & {
    forceType?: DetectedContentType;
    source?: AuditRecord["source"];
    recordAudit?: boolean;
  } = {}
): SmartCompressionResult {
  const start = performance.now();
  const detectedType =
    options.forceType && options.forceType !== "mixed"
      ? options.forceType
      : detectContentType(rawText);

  let output: CompressorOutput;
  switch (detectedType) {
    case "json":
      output = compressJsonPayload(rawText, options);
      break;
    case "dom":
      output = compressDomContent(rawText, options);
      break;
    case "code":
      output = compressSourceCode(rawText, options);
      break;
    case "log":
    default:
      output = compressTerminalLog(rawText, options);
      break;
  }

  const latencyMs = Number((performance.now() - start).toFixed(2));
  const originalTokens = countTokens(rawText);
  const compressedTokens = countTokens(output.compressedText);
  const savedTokens = Math.max(0, originalTokens - compressedTokens);
  const compressionRatioPct =
    originalTokens > 0
      ? Number(((savedTokens / originalTokens) * 100).toFixed(1))
      : 0;

  let auditRecord: AuditRecord | undefined;
  if (options.recordAudit !== false) {
    auditRecord = globalVault.recordAudit({
      source: options.source || "playground",
      contentType: detectedType,
      mode: options.aggressiveness || "balanced",
      originalTokens,
      compressedTokens,
      latencyMs,
      refIds: output.refIds,
      summary: `Compressed ${detectedType.toUpperCase()} (${originalTokens} → ${compressedTokens} tokens, -${compressionRatioPct}%)`,
    });
  }

  return {
    detectedType,
    originalText: rawText,
    compressedText: output.compressedText,
    originalTokens,
    compressedTokens,
    savedTokens,
    compressionRatioPct,
    latencyMs,
    refIds: output.refIds,
    metadata: output.metadata,
    auditRecord,
  };
}
