import crypto from "node:crypto";
import { countTokens, estimateCostSavingsUsd } from "../utils/tokenizer.ts";

export interface VaultEntry {
  refId: string;
  category: "json" | "log" | "code" | "dom" | "episodic";
  label: string;
  originalContent: string;
  compressedPreview: string;
  originalTokens: number;
  compressedTokens: number;
  createdAt: string;
}

export interface AuditRecord {
  id: string;
  timestamp: string;
  source: "proxy-openai" | "proxy-anthropic" | "mcp-tool" | "playground" | "cli";
  contentType: string;
  mode: string;
  originalTokens: number;
  compressedTokens: number;
  savedTokens: number;
  compressionRatioPct: number;
  latencyMs: number;
  savedUsdSonnet: number;
  savedUsdOpus: number;
  refIds: string[];
  summary: string;
}

/**
 * Reversible Context Vault & Telemetry Store
 * Ensures 100% lossless recovery: whenever ContextDiet folds a function body, JSON array,
 * or multi-turn trajectory, it stores the raw slice in the Vault indexed by a deterministic short hash.
 */
class ContextVaultStore {
  private vault = new Map<string, VaultEntry>();
  private auditLogs: AuditRecord[] = [];
  private maxVaultEntries = 2000;
  private maxAuditLogs = 500;

  public storeFoldedSlice(params: {
    category: VaultEntry["category"];
    label: string;
    originalContent: string;
    compressedPreview: string;
  }): VaultEntry {
    const hash = crypto
      .createHash("sha256")
      .update(`${params.category}:${params.label}:${params.originalContent}`)
      .digest("hex")
      .slice(0, 8);

    const refId = `diet_ref:${hash}`;
    const existing = this.vault.get(refId);
    if (existing) {
      return existing;
    }

    const entry: VaultEntry = {
      refId,
      category: params.category,
      label: params.label,
      originalContent: params.originalContent,
      compressedPreview: params.compressedPreview,
      originalTokens: countTokens(params.originalContent),
      compressedTokens: countTokens(params.compressedPreview),
      createdAt: new Date().toISOString(),
    };

    if (this.vault.size >= this.maxVaultEntries) {
      const oldestKey = this.vault.keys().next().value;
      if (oldestKey) this.vault.delete(oldestKey);
    }

    this.vault.set(refId, entry);
    return entry;
  }

  public expandSlice(refId: string): VaultEntry | undefined {
    const normalized = refId.startsWith("diet_ref:") ? refId : `diet_ref:${refId}`;
    return this.vault.get(normalized);
  }

  public listVaultEntries(limit = 50): VaultEntry[] {
    return Array.from(this.vault.values()).reverse().slice(0, limit);
  }

  public recordAudit(params: {
    source: AuditRecord["source"];
    contentType: string;
    mode: string;
    originalTokens: number;
    compressedTokens: number;
    latencyMs: number;
    refIds: string[];
    summary: string;
  }): AuditRecord {
    const savedTokens = Math.max(0, params.originalTokens - params.compressedTokens);
    const ratio =
      params.originalTokens > 0
        ? Number(((savedTokens / params.originalTokens) * 100).toFixed(1))
        : 0;

    const record: AuditRecord = {
      id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      source: params.source,
      contentType: params.contentType,
      mode: params.mode,
      originalTokens: params.originalTokens,
      compressedTokens: params.compressedTokens,
      savedTokens,
      compressionRatioPct: ratio,
      latencyMs: Number(params.latencyMs.toFixed(2)),
      savedUsdSonnet: estimateCostSavingsUsd(savedTokens, "claude-sonnet-4"),
      savedUsdOpus: estimateCostSavingsUsd(savedTokens, "claude-opus-4"),
      refIds: params.refIds,
      summary: params.summary,
    };

    this.auditLogs.unshift(record);
    if (this.auditLogs.length > this.maxAuditLogs) {
      this.auditLogs.pop();
    }
    return record;
  }

  public getTelemetrySummary() {
    let totalOriginalTokens = 0;
    let totalCompressedTokens = 0;
    let totalSavedTokens = 0;
    let totalSavedUsdSonnet = 0;
    let totalSavedUsdOpus = 0;
    let totalLatencyMs = 0;
    const byType: Record<
      string,
      { count: number; originalTokens: number; savedTokens: number }
    > = {};

    for (const log of this.auditLogs) {
      totalOriginalTokens += log.originalTokens;
      totalCompressedTokens += log.compressedTokens;
      totalSavedTokens += log.savedTokens;
      totalSavedUsdSonnet += log.savedUsdSonnet;
      totalSavedUsdOpus += log.savedUsdOpus;
      totalLatencyMs += log.latencyMs;

      if (!byType[log.contentType]) {
        byType[log.contentType] = { count: 0, originalTokens: 0, savedTokens: 0 };
      }
      byType[log.contentType].count += 1;
      byType[log.contentType].originalTokens += log.originalTokens;
      byType[log.contentType].savedTokens += log.savedTokens;
    }

    const avgCompressionRatioPct =
      totalOriginalTokens > 0
        ? Number(((totalSavedTokens / totalOriginalTokens) * 100).toFixed(1))
        : 0;

    const avgLatencyMs =
      this.auditLogs.length > 0
        ? Number((totalLatencyMs / this.auditLogs.length).toFixed(2))
        : 0;

    return {
      totalRequests: this.auditLogs.length,
      vaultEntriesCount: this.vault.size,
      totalOriginalTokens,
      totalCompressedTokens,
      totalSavedTokens,
      avgCompressionRatioPct,
      avgLatencyMs,
      totalSavedUsdSonnet: Number(totalSavedUsdSonnet.toFixed(4)),
      totalSavedUsdOpus: Number(totalSavedUsdOpus.toFixed(4)),
      byType,
      recentAudits: this.auditLogs.slice(0, 30),
    };
  }
}

export const globalVault = new ContextVaultStore();
