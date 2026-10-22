import { globalVault } from "../store/vault.ts";

export interface CompressionOptions {
  aggressiveness?: "conservative" | "balanced" | "aggressive";
  focusKeywords?: string[];
  preserveLineNumbers?: number[];
}

export interface CompressorOutput {
  compressedText: string;
  refIds: string[];
  metadata: Record<string, unknown>;
}

/**
 * Infers a concise TypeScript-like schema description for an array of homogeneous objects,
 * preserves any items that contain error/warning/focus keywords, keeps top-K head/tail samples,
 * and stores the omitted items in the Reversible Vault.
 */
export function compressJsonPayload(
  rawText: string,
  options: CompressionOptions = {}
): CompressorOutput {
  const mode = options.aggressiveness || "balanced";
  const maxArraySamples = mode === "conservative" ? 4 : mode === "balanced" ? 2 : 1;
  const maxStringLength = mode === "conservative" ? 300 : mode === "balanced" ? 140 : 80;
  const focusKeywords = (options.focusKeywords || []).map((k) => k.toLowerCase());
  const refIds: string[] = [];
  let arraysFolded = 0;
  let stringsTruncated = 0;

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return {
      compressedText: rawText,
      refIds: [],
      metadata: { validJson: false },
    };
  }

  function containsFocusOrAnomaly(item: unknown): boolean {
    if (!item || typeof item !== "object") return false;
    const str = JSON.stringify(item).toLowerCase();
    if (
      str.includes('"error"') ||
      str.includes('"failed"') ||
      str.includes('"exception"') ||
      str.includes('"critical"') ||
      str.includes('"status":500') ||
      str.includes('"status":4')
    ) {
      return true;
    }
    return focusKeywords.some((kw) => kw && str.includes(kw));
  }

  function inferObjectArraySchema(items: Record<string, unknown>[]): Record<string, string> {
    const schema: Record<string, Set<string>> = {};
    const sampleSlice = items.slice(0, 25);
    for (const obj of sampleSlice) {
      for (const [k, v] of Object.entries(obj)) {
        if (!schema[k]) schema[k] = new Set();
        if (v === null) schema[k].add("null");
        else if (Array.isArray(v)) schema[k].add(`Array(${v.length})`);
        else schema[k].add(typeof v);
      }
    }
    const result: Record<string, string> = {};
    for (const [k, types] of Object.entries(schema)) {
      result[k] = Array.from(types).join(" | ");
    }
    return result;
  }

  function summarizeFieldDistributions(
    items: Record<string, unknown>[]
  ): Record<string, unknown> {
    const summary: Record<string, unknown> = {};
    if (items.length === 0) return summary;
    const keys = Object.keys(items[0] || {}).slice(0, 8);

    for (const key of keys) {
      const vals = items.map((it) => it[key]).filter((v) => v !== undefined && v !== null);
      if (vals.length === 0) continue;

      if (typeof vals[0] === "number") {
        const nums = vals as number[];
        const min = Math.min(...nums);
        const max = Math.max(...nums);
        summary[key] = `number [range: ${min}..${max}]`;
      } else if (typeof vals[0] === "boolean" || (typeof vals[0] === "string" && vals.length >= 4)) {
        const counts = new Map<string, number>();
        for (const v of vals) {
          const s = String(v);
          if (s.length <= 32) {
            counts.set(s, (counts.get(s) || 0) + 1);
          }
        }
        if (counts.size > 0 && counts.size <= 6) {
          const dist = Array.from(counts.entries())
            .map(([k, c]) => `${k}(${c})`)
            .join(", ");
          summary[key] = dist;
        }
      }
    }
    return summary;
  }

  function transformNode(node: unknown, path: string): unknown {
    if (typeof node === "string") {
      if (node.length > maxStringLength && !node.includes("diet_ref:")) {
        stringsTruncated++;
        const vaultEntry = globalVault.storeFoldedSlice({
          category: "json",
          label: `String at ${path} (${node.length} chars)`,
          originalContent: node,
          compressedPreview: `${node.slice(0, maxStringLength)}...`,
        });
        refIds.push(vaultEntry.refId);
        return `${node.slice(0, maxStringLength)}... [truncated ${node.length - maxStringLength} chars | ${vaultEntry.refId}]`;
      }
      return node;
    }

    if (Array.isArray(node)) {
      if (node.length > maxArraySamples + 2) {
        arraysFolded++;
        const isObjectArray =
          node.every((it) => it !== null && typeof it === "object" && !Array.isArray(it));

        const keptHead = node
          .slice(0, maxArraySamples)
          .map((item, idx) => transformNode(item, `${path}[${idx}]`));

        // Always rescue anomalous or focus-matching items in the middle!
        const rescuedAnomalies: unknown[] = [];
        for (let i = maxArraySamples; i < node.length - 1; i++) {
          if (containsFocusOrAnomaly(node[i]) && rescuedAnomalies.length < 3) {
            rescuedAnomalies.push(transformNode(node[i], `${path}[${i}]`));
          }
        }

        const omittedSlice = node.slice(maxArraySamples, node.length - 1);
        const vaultEntry = globalVault.storeFoldedSlice({
          category: "json",
          label: `JSON Array at ${path} (${omittedSlice.length} omitted items)`,
          originalContent: JSON.stringify(omittedSlice, null, 2),
          compressedPreview: `[${omittedSlice.length} items folded]`,
        });
        refIds.push(vaultEntry.refId);

        const foldDescriptor: Record<string, unknown> = {
          _contextDietFolded: `${omittedSlice.length} homogeneous items omitted (Total: ${node.length})`,
          _expandRef: vaultEntry.refId,
        };

        if (isObjectArray) {
          const objItems = node as Record<string, unknown>[];
          foldDescriptor._inferredSchema = inferObjectArraySchema(objItems);
          const dist = summarizeFieldDistributions(objItems);
          if (Object.keys(dist).length > 0) {
            foldDescriptor._valueDistribution = dist;
          }
        }

        const tailItem = transformNode(
          node[node.length - 1],
          `${path}[${node.length - 1}]`
        );

        return [...keptHead, ...rescuedAnomalies, foldDescriptor, tailItem];
      }
      return node.map((item, idx) => transformNode(item, `${path}[${idx}]`));
    }

    if (node !== null && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
        out[key] = transformNode(val, `${path}.${key}`);
      }
      return out;
    }

    return node;
  }

  const transformed = transformNode(parsed, "$");
  // Compact formatting with 2-space indent for top level readability
  const compressedText = JSON.stringify(transformed, null, 2);

  return {
    compressedText,
    refIds,
    metadata: {
      validJson: true,
      arraysFolded,
      stringsTruncated,
    },
  };
}
