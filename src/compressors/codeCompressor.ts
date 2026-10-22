import { globalVault } from "../store/vault.ts";
import type { CompressionOptions, CompressorOutput } from "./jsonCompressor.ts";

/**
 * AST-Inspired Structural Code Skeletonizer (TypeScript, JavaScript, Python, Go, Rust)
 * - Preserves imports, exports, type/interface declarations, class headers, and function/method signatures
 * - Keeps full implementation bodies when a function matches `focusKeywords` or `preserveLineNumbers`
 * - Folds large non-focal function bodies into a single reversible reference line (`diet_ref:...`)
 */
export function compressSourceCode(
  rawCode: string,
  options: CompressionOptions = {}
): CompressorOutput {
  const mode = options.aggressiveness || "balanced";
  const minFoldLines = mode === "conservative" ? 18 : mode === "balanced" ? 10 : 5;
  const focusKeywords = (options.focusKeywords || []).map((k) => k.toLowerCase());
  const preserveLines = new Set(options.preserveLineNumbers || []);
  const refIds: string[] = [];

  const lines = rawCode.replace(/\r\n/g, "\n").split("\n");
  const output: string[] = [];

  const fnStartPattern =
    /^\s*(export\s+)?(default\s+)?(async\s+)?(function\s+\w+|class\s+\w+|(public|private|protected|static|async)\s+\w+\s*\(|(const|let|var)\s+\w+\s*=\s*(async\s*)?\([^)]*\)\s*=>|def\s+\w+\s*\(|fn\s+\w+|func\s+(\([^)]+\)\s*)?\w+)/;

  let i = 0;
  let functionsFolded = 0;
  let functionsKeptFull = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Check if this line starts a brace-delimited function/method block
    if (fnStartPattern.test(line) && line.includes("{") && !line.includes("}")) {
      // Count braces to find the end of the block
      let braceDepth = 0;
      for (const ch of line) {
        if (ch === "{") braceDepth++;
        else if (ch === "}") braceDepth--;
      }

      let endIdx = i + 1;
      while (endIdx < lines.length && braceDepth > 0) {
        for (const ch of lines[endIdx]) {
          if (ch === "{") braceDepth++;
          else if (ch === "}") braceDepth--;
        }
        if (braceDepth === 0) break;
        endIdx++;
      }

      const blockLineCount = endIdx - i + 1;
      if (endIdx < lines.length && blockLineCount >= minFoldLines) {
        const blockSlice = lines.slice(i, endIdx + 1).join("\n");
        const blockLower = blockSlice.toLowerCase();

        // Check if block contains focus keywords or preserved line numbers
        let shouldPreserve = focusKeywords.some((kw) => kw && blockLower.includes(kw));
        if (!shouldPreserve && preserveLines.size > 0) {
          for (let ln = i + 1; ln <= endIdx + 1; ln++) {
            if (preserveLines.has(ln)) {
              shouldPreserve = true;
              break;
            }
          }
        }

        if (shouldPreserve) {
          functionsKeptFull++;
          for (let k = i; k <= endIdx; k++) {
            output.push(lines[k]);
          }
          i = endIdx + 1;
          continue;
        }

        // Fold the inner implementation body while preserving the signature and closing brace
        functionsFolded++;
        const innerBody = lines.slice(i + 1, endIdx).join("\n");
        const signaturePreview = line.trim().slice(0, 60);

        const vaultEntry = globalVault.storeFoldedSlice({
          category: "code",
          label: `Function body: ${signaturePreview} (lines ${i + 1}-${endIdx + 1})`,
          originalContent: innerBody,
          compressedPreview: `/* ${endIdx - i - 1} lines folded */`,
        });
        refIds.push(vaultEntry.refId);

        // Extract return statements or key calls inside body as semantic hint
        const returnHints = lines
          .slice(i + 1, endIdx)
          .map((l) => l.trim())
          .filter((l) => l.startsWith("return ") || l.startsWith("throw "))
          .slice(0, 2);

        const hintText =
          returnHints.length > 0
            ? ` | returns: ${returnHints.join("; ").slice(0, 75)}`
            : "";

        output.push(
          `${line} /* ... ${endIdx - i - 1} lines folded (${vaultEntry.refId})${hintText} ... */ }`
        );
        i = endIdx + 1;
        continue;
      }
    }

    output.push(line);
    i++;
  }

  return {
    compressedText: output.join("\n"),
    refIds,
    metadata: {
      totalLines: lines.length,
      compressedLines: output.length,
      functionsFolded,
      functionsKeptFull,
    },
  };
}
