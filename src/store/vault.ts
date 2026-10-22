import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { countTokens, estimateCostSavingsUsd } from "../utils/tokenizer.ts";

export interface VaultEntry {
  refId: string;
  category: "json" | "log" | "code" | "dom" | "episodic";
  label: string;
  originalContent: string;
  compressedPreview: string;
  originalTokens: number;
  compressedTokens: number;
  expandCount: number;
  createdAt: string;
  lastExpandedAt: string | null;
}

export interface AuditRecord {
  id: string;
  timestamp: string;
  source:
    | "proxy-openai"
    | "proxy-openai-responses"
    | "proxy-anthropic"
    | "mcp-tool"
    | "playground"
    | "cli";
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
  upstreamForwarded?: boolean;
  actualUpstreamPromptTokens?: number | null;
}

/**
 * Persistent SQLite-backed Reversible Context Vault & Net-Savings Telemetry Store.
 * Uses WAL mode so the Proxy Server, MCP stdio process, and CLI share the exact same database.
 */
export class ContextVaultStore {
  private db: DatabaseSync;
  public readonly dbPath: string;

  constructor(customDbPath?: string) {
    const resolvedPath =
      customDbPath ||
      process.env.CONTEXT_DIET_DB_PATH ||
      path.join(process.cwd(), ".context-diet", "vault.sqlite");

    this.dbPath = resolvedPath;
    if (resolvedPath !== ":memory:") {
      fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    }

    this.db = new DatabaseSync(resolvedPath);
    this.initSchema();
  }

  private initSchema() {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = 5000;

      CREATE TABLE IF NOT EXISTS vault_entries (
        ref_id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        label TEXT NOT NULL,
        original_content TEXT NOT NULL,
        compressed_preview TEXT NOT NULL,
        original_tokens INTEGER NOT NULL,
        compressed_tokens INTEGER NOT NULL,
        expand_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        last_expanded_at TEXT
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        source TEXT NOT NULL,
        content_type TEXT NOT NULL,
        mode TEXT NOT NULL,
        original_tokens INTEGER NOT NULL,
        compressed_tokens INTEGER NOT NULL,
        saved_tokens INTEGER NOT NULL,
        compression_ratio_pct REAL NOT NULL,
        latency_ms REAL NOT NULL,
        saved_usd_sonnet REAL NOT NULL,
        saved_usd_opus REAL NOT NULL,
        ref_ids_json TEXT NOT NULL,
        summary TEXT NOT NULL,
        upstream_forwarded INTEGER NOT NULL DEFAULT 0,
        actual_upstream_prompt_tokens INTEGER
      );
    `);
  }

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
      .slice(0, 10);

    const refId = `diet_ref:${hash}`;
    const now = new Date().toISOString();
    const originalTokens = countTokens(params.originalContent);
    const compressedTokens = countTokens(params.compressedPreview);

    const stmt = this.db.prepare(`
      INSERT INTO vault_entries (
        ref_id, category, label, original_content, compressed_preview,
        original_tokens, compressed_tokens, expand_count, created_at, last_expanded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, NULL)
      ON CONFLICT(ref_id) DO NOTHING
    `);

    stmt.run(
      refId,
      params.category,
      params.label,
      params.originalContent,
      params.compressedPreview,
      originalTokens,
      compressedTokens,
      now
    );

    return {
      refId,
      category: params.category,
      label: params.label,
      originalContent: params.originalContent,
      compressedPreview: params.compressedPreview,
      originalTokens,
      compressedTokens,
      expandCount: 0,
      createdAt: now,
      lastExpandedAt: null,
    };
  }

  /**
   * Restores a folded slice from SQLite and increments its expansion counter
   * so Net Token Savings (Gross Saved - Expansion Overhead) is accurately tracked.
   */
  public expandSlice(
    refId: string,
    options: { recordExpansionOverhead?: boolean } = {}
  ): VaultEntry | undefined {
    const normalized = refId.startsWith("diet_ref:") ? refId : `diet_ref:${refId}`;
    const shouldTrack = options.recordExpansionOverhead !== false;

    if (shouldTrack) {
      const updateStmt = this.db.prepare(`
        UPDATE vault_entries
        SET expand_count = expand_count + 1,
            last_expanded_at = ?
        WHERE ref_id = ?
      `);
      updateStmt.run(new Date().toISOString(), normalized);
    }

    const selectStmt = this.db.prepare(`
      SELECT ref_id, category, label, original_content, compressed_preview,
             original_tokens, compressed_tokens, expand_count, created_at, last_expanded_at
      FROM vault_entries
      WHERE ref_id = ?
    `);
    const row = selectStmt.get(normalized) as Record<string, unknown> | undefined;
    if (!row) return undefined;

    return {
      refId: String(row.ref_id),
      category: row.category as VaultEntry["category"],
      label: String(row.label),
      originalContent: String(row.original_content),
      compressedPreview: String(row.compressed_preview),
      originalTokens: Number(row.original_tokens),
      compressedTokens: Number(row.compressed_tokens),
      expandCount: Number(row.expand_count),
      createdAt: String(row.created_at),
      lastExpandedAt: row.last_expanded_at ? String(row.last_expanded_at) : null,
    };
  }

  public listVaultEntries(limit = 50): VaultEntry[] {
    const stmt = this.db.prepare(`
      SELECT ref_id, category, label, original_content, compressed_preview,
             original_tokens, compressed_tokens, expand_count, created_at, last_expanded_at
      FROM vault_entries
      ORDER BY created_at DESC
      LIMIT ?
    `);
    const rows = stmt.all(limit) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      refId: String(row.ref_id),
      category: row.category as VaultEntry["category"],
      label: String(row.label),
      originalContent: String(row.original_content),
      compressedPreview: String(row.compressed_preview),
      originalTokens: Number(row.original_tokens),
      compressedTokens: Number(row.compressed_tokens),
      expandCount: Number(row.expand_count),
      createdAt: String(row.created_at),
      lastExpandedAt: row.last_expanded_at ? String(row.last_expanded_at) : null,
    }));
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
    upstreamForwarded?: boolean;
    actualUpstreamPromptTokens?: number | null;
  }): AuditRecord {
    const savedTokens = Math.max(0, params.originalTokens - params.compressedTokens);
    const ratio =
      params.originalTokens > 0
        ? Number(((savedTokens / params.originalTokens) * 100).toFixed(1))
        : 0;

    const record: AuditRecord = {
      id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
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
      upstreamForwarded: Boolean(params.upstreamForwarded),
      actualUpstreamPromptTokens: params.actualUpstreamPromptTokens ?? null,
    };

    const stmt = this.db.prepare(`
      INSERT INTO audit_logs (
        id, timestamp, source, content_type, mode,
        original_tokens, compressed_tokens, saved_tokens, compression_ratio_pct,
        latency_ms, saved_usd_sonnet, saved_usd_opus, ref_ids_json, summary,
        upstream_forwarded, actual_upstream_prompt_tokens
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      record.id,
      record.timestamp,
      record.source,
      record.contentType,
      record.mode,
      record.originalTokens,
      record.compressedTokens,
      record.savedTokens,
      record.compressionRatioPct,
      record.latencyMs,
      record.savedUsdSonnet,
      record.savedUsdOpus,
      JSON.stringify(record.refIds),
      record.summary,
      record.upstreamForwarded ? 1 : 0,
      record.actualUpstreamPromptTokens ?? null
    );

    return record;
  }

  public getTelemetrySummary() {
    const aggRow = this.db
      .prepare(`
        SELECT
          COUNT(*) AS total_requests,
          COALESCE(SUM(original_tokens), 0) AS total_original,
          COALESCE(SUM(compressed_tokens), 0) AS total_compressed,
          COALESCE(SUM(saved_tokens), 0) AS gross_saved,
          COALESCE(SUM(saved_usd_sonnet), 0) AS usd_sonnet,
          COALESCE(SUM(saved_usd_opus), 0) AS usd_opus,
          COALESCE(AVG(latency_ms), 0) AS avg_latency,
          COALESCE(SUM(upstream_forwarded), 0) AS forwarded_count
        FROM audit_logs
      `)
      .get() as Record<string, unknown>;

    const vaultRow = this.db
      .prepare(`
        SELECT
          COUNT(*) AS vault_count,
          COALESCE(SUM(expand_count), 0) AS total_expansions,
          COALESCE(SUM(expand_count * original_tokens), 0) AS expansion_overhead_tokens
        FROM vault_entries
      `)
      .get() as Record<string, unknown>;

    const totalRequests = Number(aggRow.total_requests || 0);
    const totalOriginalTokens = Number(aggRow.total_original || 0);
    const totalCompressedTokens = Number(aggRow.total_compressed || 0);
    const grossSavedTokens = Number(aggRow.gross_saved || 0);
    const expansionOverheadTokens = Number(vaultRow.expansion_overhead_tokens || 0);
    const netSavedTokens = Math.max(0, grossSavedTokens - expansionOverheadTokens);

    const avgCompressionRatioPct =
      totalOriginalTokens > 0
        ? Number(((grossSavedTokens / totalOriginalTokens) * 100).toFixed(1))
        : 0;
    const netCompressionRatioPct =
      totalOriginalTokens > 0
        ? Number(((netSavedTokens / totalOriginalTokens) * 100).toFixed(1))
        : 0;

    const byTypeRows = this.db
      .prepare(`
        SELECT content_type,
               COUNT(*) AS count,
               SUM(original_tokens) AS original_tokens,
               SUM(saved_tokens) AS saved_tokens
        FROM audit_logs
        GROUP BY content_type
      `)
      .all() as Array<Record<string, unknown>>;

    const byType: Record<
      string,
      { count: number; originalTokens: number; savedTokens: number }
    > = {};
    for (const r of byTypeRows) {
      byType[String(r.content_type)] = {
        count: Number(r.count),
        originalTokens: Number(r.original_tokens),
        savedTokens: Number(r.saved_tokens),
      };
    }

    const recentRows = this.db
      .prepare(`
        SELECT id, timestamp, source, content_type, mode,
               original_tokens, compressed_tokens, saved_tokens,
               compression_ratio_pct, latency_ms, saved_usd_sonnet,
               saved_usd_opus, ref_ids_json, summary,
               upstream_forwarded, actual_upstream_prompt_tokens
        FROM audit_logs
        ORDER BY timestamp DESC
        LIMIT 30
      `)
      .all() as Array<Record<string, unknown>>;

    const recentAudits: AuditRecord[] = recentRows.map((r) => ({
      id: String(r.id),
      timestamp: String(r.timestamp),
      source: r.source as AuditRecord["source"],
      contentType: String(r.content_type),
      mode: String(r.mode),
      originalTokens: Number(r.original_tokens),
      compressedTokens: Number(r.compressed_tokens),
      savedTokens: Number(r.saved_tokens),
      compressionRatioPct: Number(r.compression_ratio_pct),
      latencyMs: Number(r.latency_ms),
      savedUsdSonnet: Number(r.saved_usd_sonnet),
      savedUsdOpus: Number(r.saved_usd_opus),
      refIds: JSON.parse(String(r.ref_ids_json || "[]")),
      summary: String(r.summary),
      upstreamForwarded: Boolean(r.upstream_forwarded),
      actualUpstreamPromptTokens:
        r.actual_upstream_prompt_tokens !== null
          ? Number(r.actual_upstream_prompt_tokens)
          : null,
    }));

    return {
      dbPath: this.dbPath,
      totalRequests,
      forwardedRequestsCount: Number(aggRow.forwarded_count || 0),
      vaultEntriesCount: Number(vaultRow.vault_count || 0),
      totalExpansionsCount: Number(vaultRow.total_expansions || 0),
      totalOriginalTokens,
      totalCompressedTokens,
      totalSavedTokens: grossSavedTokens,
      grossSavedTokens,
      expansionOverheadTokens,
      netSavedTokens,
      avgCompressionRatioPct,
      netCompressionRatioPct,
      avgLatencyMs: Number(Number(aggRow.avg_latency || 0).toFixed(2)),
      totalSavedUsdSonnet: estimateCostSavingsUsd(netSavedTokens, "claude-sonnet-4"),
      totalSavedUsdOpus: estimateCostSavingsUsd(netSavedTokens, "claude-opus-4"),
      byType,
      recentAudits,
    };
  }
}

export const globalVault = new ContextVaultStore();
