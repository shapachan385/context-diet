import { globalVault } from "../store/vault.ts";
import type { CompressionOptions, CompressorOutput } from "./jsonCompressor.ts";

/**
 * Terminal, Build & Test Runner Log Denoiser
 * - Strips ANSI escape codes and progress bar spinner noise
 * - Folds passing test blocks & repetitive debug/info logs
 * - Preserves 100% of stack traces, assertion errors, exit codes, and surrounding causal context lines
 */
export function compressTerminalLog(
  rawLog: string,
  options: CompressionOptions = {}
): CompressorOutput {
  const mode = options.aggressiveness || "balanced";
  const contextRadius = mode === "conservative" ? 4 : mode === "balanced" ? 2 : 1;
  const refIds: string[] = [];

  // 1. Strip ANSI escape codes & carriage-return progress overwrites
  const ansiRegex = /\x1B\[[0-?]*[ -/]*[@-~]/g;
  const cleanedLines = rawLog
    .replace(ansiRegex, "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => {
      // If a line has carriage return overwrites (like progress bars), keep only final state
      if (line.includes("\r")) {
        const parts = line.split("\r").filter(Boolean);
        return parts[parts.length - 1] || "";
      }
      return line;
    });

  // 2. Classify each line's importance
  const errorPattern =
    /\b(error|exception|fail|failed|fatal|panic|traceback|syntaxerror|typeerror|referenceerror|assertionerror|segfault|err!|elifecycle|enoent|econnrefused|status\s*[45]\d\d)\b/i;
  const stackFramePattern =
    /^\s*(at\s+.+\(.+:\d+:\d+\)|at\s+.+:\d+:\d+|File\s+".+",\s+line\s+\d+|\d+:\s*0x[0-9a-fA-F]+|---\s+FAIL:|●\s+|✕\s+|×\s+)/;
  const warningPattern = /\b(warn|warning|deprecated|retry|timeout|slow)\b/i;
  const summaryPattern =
    /\b(test suites?:|tests?:|passed|failed|total time|exit code|build finished|summary)\b/i;
  const noisyPassPattern =
    /^\s*(✓|✔|PASS\s|ok\s+\d+|\[INFO\]|\[DEBUG\]|Downloading\s|Installing\s|Compiling\s|Building\s|GET\s+\/\S+\s+200\b)/i;

  const keepFlags = new Array<boolean>(cleanedLines.length).fill(false);
  let errorLinesDetected = 0;

  for (let i = 0; i < cleanedLines.length; i++) {
    const line = cleanedLines[i];
    const isError = errorPattern.test(line) || stackFramePattern.test(line);
    const isSummary = summaryPattern.test(line);
    const isWarn = warningPattern.test(line) && mode !== "aggressive";

    if (isError) {
      errorLinesDetected++;
      const start = Math.max(0, i - contextRadius);
      const end = Math.min(cleanedLines.length - 1, i + contextRadius + 1);
      for (let j = start; j <= end; j++) {
        keepFlags[j] = true;
      }
    } else if (isSummary || isWarn) {
      keepFlags[i] = true;
    }
  }

  // Always keep first 3 and last 5 lines for command header & exit footer
  for (let i = 0; i < Math.min(3, cleanedLines.length); i++) keepFlags[i] = true;
  for (let i = Math.max(0, cleanedLines.length - 5); i < cleanedLines.length; i++) {
    keepFlags[i] = true;
  }

  // 3. Deduplicate repetitive template lines & fold contiguous noisy blocks
  const outputLines: string[] = [];
  let foldedBuffer: string[] = [];
  let foldedBlocksCount = 0;

  function flushFoldedBuffer() {
    if (foldedBuffer.length === 0) return;
    if (foldedBuffer.length <= 3) {
      outputLines.push(...foldedBuffer);
    } else {
      foldedBlocksCount++;
      const passingCount = foldedBuffer.filter((l) => noisyPassPattern.test(l)).length;
      const rawBlock = foldedBuffer.join("\n");
      const previewLabel =
        passingCount > 0
          ? `[... ${foldedBuffer.length} lines folded (${passingCount} passing/routine checks omitted)`
          : `[... ${foldedBuffer.length} routine log lines folded`;

      const entry = globalVault.storeFoldedSlice({
        category: "log",
        label: `Terminal log block (${foldedBuffer.length} lines)`,
        originalContent: rawBlock,
        compressedPreview: previewLabel,
      });
      refIds.push(entry.refId);
      outputLines.push(`${previewLabel} | expand: ${entry.refId} ...]`);
    }
    foldedBuffer = [];
  }

  for (let i = 0; i < cleanedLines.length; i++) {
    const line = cleanedLines[i];
    if (keepFlags[i] && !noisyPassPattern.test(line)) {
      flushFoldedBuffer();
      outputLines.push(line);
    } else {
      foldedBuffer.push(line);
    }
  }
  flushFoldedBuffer();

  return {
    compressedText: outputLines.join("\n"),
    refIds,
    metadata: {
      totalLines: cleanedLines.length,
      keptLines: outputLines.length,
      errorLinesDetected,
      foldedBlocksCount,
    },
  };
}
