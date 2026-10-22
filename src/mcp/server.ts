import readline from "node:readline";
import { smartCompress, type DetectedContentType } from "../compressors/index.ts";
import { foldAgentTrajectory, type AgentMessage } from "../memory/episodicFolder.ts";
import { globalVault } from "../store/vault.ts";
import { calculateContextRotRisk } from "../utils/tokenizer.ts";

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export const MCP_TOOLS_DEFINITION = [
  {
    name: "diet_compress_output",
    description:
      "Compress large tool outputs (JSON payloads, CI/test terminal logs, source code files, or scraped DOM HTML) by 60-90% while preserving 100% of error stack traces, schemas, and focal symbols. Stores omitted slices in the Reversible Vault.",
    inputSchema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "Raw tool output or file content to compress.",
        },
        aggressiveness: {
          type: "string",
          enum: ["conservative", "balanced", "aggressive"],
          description: "Compression level (default: balanced).",
        },
        forceType: {
          type: "string",
          enum: ["json", "log", "code", "dom"],
          description: "Optional explicit modality override.",
        },
        focusKeywords: {
          type: "array",
          items: { type: "string" },
          description: "Symbols, function names, or keywords that must never be folded.",
        },
      },
      required: ["content"],
    },
  },
  {
    name: "diet_fold_trajectory",
    description:
      "Fold long multi-turn Agent conversation trajectories into high-density <EpisodicMemoryFrame> summaries to prevent Context Rot, preserving files touched, pitfalls encountered, and reversible vault references.",
    inputSchema: {
      type: "object",
      properties: {
        messages: {
          type: "array",
          description: "Array of OpenAI/Anthropic-compatible conversation messages.",
          items: {
            type: "object",
            properties: {
              role: { type: "string" },
              content: { type: "string" },
            },
            required: ["role", "content"],
          },
        },
        keepRecentMessages: {
          type: "number",
          description: "Number of most recent messages to keep unfolded (default: 4).",
        },
      },
      required: ["messages"],
    },
  },
  {
    name: "diet_expand_frame",
    description:
      "Losslessly restore the original raw content of any folded block or episodic memory frame using its Reversible Vault reference ID (e.g., 'diet_ref:a1b2c3d4').",
    inputSchema: {
      type: "object",
      properties: {
        refId: {
          type: "string",
          description: "Vault reference ID (e.g. 'diet_ref:8f3a1c2b').",
        },
      },
      required: ["refId"],
    },
  },
  {
    name: "diet_audit_roi",
    description:
      "Get real-time telemetry on tokens saved, compression ratio %, USD saved across Claude/OpenAI models, and current Context Rot risk score.",
    inputSchema: {
      type: "object",
      properties: {
        currentContextTokens: {
          type: "number",
          description: "Optional current conversation token size to evaluate Context Rot risk.",
        },
      },
    },
  },
];

/**
 * Handles a single MCP JSON-RPC 2.0 request (used by both stdio MCP and HTTP /mcp endpoint)
 */
export function handleMcpJsonRpc(req: JsonRpcRequest): JsonRpcResponse | null {
  const id = req.id ?? null;

  if (req.method === "notifications/initialized" || req.method.startsWith("notifications/")) {
    return null;
  }

  if (req.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {},
          resources: {},
        },
        serverInfo: {
          name: "context-diet-mcp",
          version: "0.1.0",
        },
      },
    };
  }

  if (req.method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        tools: MCP_TOOLS_DEFINITION,
      },
    };
  }

  if (req.method === "tools/call") {
    const params = (req.params || {}) as {
      name?: string;
      arguments?: Record<string, unknown>;
    };
    const toolName = params.name;
    const args = params.arguments || {};

    try {
      if (toolName === "diet_compress_output") {
        const content = String(args.content || "");
        const aggressiveness = (args.aggressiveness as
          | "conservative"
          | "balanced"
          | "aggressive"
          | undefined) || "balanced";
        const forceType = args.forceType as DetectedContentType | undefined;
        const focusKeywords = Array.isArray(args.focusKeywords)
          ? args.focusKeywords.map(String)
          : undefined;

        const res = smartCompress(content, {
          aggressiveness,
          forceType,
          focusKeywords,
          source: "mcp-tool",
        });

        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: res.compressedText,
              },
            ],
            metadata: {
              detectedType: res.detectedType,
              originalTokens: res.originalTokens,
              compressedTokens: res.compressedTokens,
              savedTokens: res.savedTokens,
              compressionRatioPct: res.compressionRatioPct,
              latencyMs: res.latencyMs,
              refIds: res.refIds,
            },
          },
        };
      }

      if (toolName === "diet_fold_trajectory") {
        const messages = (args.messages || []) as AgentMessage[];
        const keepRecentMessages =
          typeof args.keepRecentMessages === "number" ? args.keepRecentMessages : 4;
        const res = foldAgentTrajectory(messages, {
          keepRecentMessages,
          source: "mcp-tool",
        });

        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify(res.foldedMessages, null, 2),
              },
            ],
            metadata: {
              originalTokens: res.originalTokens,
              compressedTokens: res.compressedTokens,
              savedTokens: res.savedTokens,
              compressionRatioPct: res.compressionRatioPct,
              framesCreated: res.framesCreated,
            },
          },
        };
      }

      if (toolName === "diet_expand_frame") {
        const refId = String(args.refId || "");
        const entry = globalVault.expandSlice(refId);
        if (!entry) {
          return {
            jsonrpc: "2.0",
            id,
            result: {
              isError: true,
              content: [
                {
                  type: "text",
                  text: `Vault reference '${refId}' not found. Available refs: ${globalVault
                    .listVaultEntries(10)
                    .map((e) => e.refId)
                    .join(", ")}`,
                },
              ],
            },
          };
        }

        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: entry.originalContent,
              },
            ],
            metadata: {
              refId: entry.refId,
              category: entry.category,
              label: entry.label,
              originalTokens: entry.originalTokens,
            },
          },
        };
      }

      if (toolName === "diet_audit_roi") {
        const summary = globalVault.getTelemetrySummary();
        const currentTokens =
          typeof args.currentContextTokens === "number"
            ? args.currentContextTokens
            : summary.totalCompressedTokens;
        const rotRisk = calculateContextRotRisk(currentTokens);

        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify({ telemetry: summary, contextRotRisk: rotRisk }, null, 2),
              },
            ],
          },
        };
      }

      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32601,
          message: `Unknown MCP tool: ${toolName}`,
        },
      };
    } catch (err) {
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32603,
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  if (req.method === "resources/list") {
    const entries = globalVault.listVaultEntries(25);
    return {
      jsonrpc: "2.0",
      id,
      result: {
        resources: entries.map((e) => ({
          uri: `diet://vault/${e.refId}`,
          name: `${e.refId} (${e.label})`,
          description: `Original ${e.category} slice (${e.originalTokens} tokens)`,
          mimeType: "text/plain",
        })),
      },
    };
  }

  return {
    jsonrpc: "2.0",
    id,
    error: {
      code: -32601,
      message: `Method not found: ${req.method}`,
    },
  };
}

/**
 * Starts the stdio MCP server for direct integration with Claude Code, OpenCode, and Cursor.
 */
export function startStdioMcpServer() {
  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false,
  });

  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const req = JSON.parse(trimmed) as JsonRpcRequest;
      const resp = handleMcpJsonRpc(req);
      if (resp) {
        process.stdout.write(JSON.stringify(resp) + "\n");
      }
    } catch {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error" },
        }) + "\n"
      );
    }
  });
}
