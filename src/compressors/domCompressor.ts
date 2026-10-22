import { globalVault } from "../store/vault.ts";
import type { CompressionOptions, CompressorOutput } from "./jsonCompressor.ts";

/**
 * DOM / HTML / Scraped Web Output Pruner for Browser Agents
 * - Strips inline `<svg>`, `<script>`, `<style>`, and base64 `data:image/...` payloads
 * - Compresses utility CSS class soup (e.g., 20+ Tailwind classes) while keeping semantic attributes
 *   (`id`, `name`, `href`, `role`, `aria-label`, `data-testid`, `placeholder`)
 */
export function compressDomContent(
  rawHtml: string,
  _options: CompressionOptions = {}
): CompressorOutput {
  const refIds: string[] = [];
  let svgStripped = 0;
  let scriptsStripped = 0;
  let base64Stripped = 0;

  let text = rawHtml;

  // 1. Fold <script> blocks
  text = text.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, (match, inner) => {
    if (inner.trim().length < 40) return match;
    scriptsStripped++;
    const entry = globalVault.storeFoldedSlice({
      category: "dom",
      label: `<script> block (${inner.length} chars)`,
      originalContent: match,
      compressedPreview: `<script /* folded */ />`,
    });
    refIds.push(entry.refId);
    return `<!-- script folded: ${entry.refId} -->`;
  });

  // 2. Fold <style> blocks
  text = text.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (match, inner) => {
    if (inner.trim().length < 40) return match;
    const entry = globalVault.storeFoldedSlice({
      category: "dom",
      label: `<style> block (${inner.length} chars)`,
      originalContent: match,
      compressedPreview: `<style /* folded */ />`,
    });
    refIds.push(entry.refId);
    return `<!-- style folded: ${entry.refId} -->`;
  });

  // 3. Fold inline <svg> paths
  text = text.replace(/<svg\b[^>]*>([\s\S]*?)<\/svg>/gi, (match) => {
    svgStripped++;
    const entry = globalVault.storeFoldedSlice({
      category: "dom",
      label: `<svg> icon (${match.length} chars)`,
      originalContent: match,
      compressedPreview: `<svg />`,
    });
    refIds.push(entry.refId);
    return `<svg data-diet-ref="${entry.refId}" />`;
  });

  // 4. Strip long base64 data URIs
  text = text.replace(/data:[a-zA-Z0-9/+.-]+;base64,[a-zA-Z0-9+/=]{64,}/g, (match) => {
    base64Stripped++;
    const entry = globalVault.storeFoldedSlice({
      category: "dom",
      label: `Base64 data URI (${match.length} chars)`,
      originalContent: match,
      compressedPreview: `data:...base64`,
    });
    refIds.push(entry.refId);
    return `data:compressed;ref=${entry.refId}`;
  });

  // 5. Prune excessive utility CSS classes (> 45 chars)
  text = text.replace(/\bclass="([^"]{45,})"/g, (_match, classes: string) => {
    const tokens = classes.trim().split(/\s+/);
    if (tokens.length <= 4) return `class="${classes}"`;
    return `class="${tokens.slice(0, 2).join(" ")} /* +${tokens.length - 2} classes */"`;
  });

  // Collapse multiple blank lines
  text = text.replace(/\n{3,}/g, "\n\n");

  return {
    compressedText: text,
    refIds,
    metadata: {
      svgStripped,
      scriptsStripped,
      base64Stripped,
    },
  };
}
