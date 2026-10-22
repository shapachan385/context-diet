import http from "node:http";
import { smartCompress } from "../compressors/index.ts";
import { foldAgentTrajectory, type AgentMessage } from "../memory/episodicFolder.ts";
import { globalVault } from "../store/vault.ts";
import { calculateContextRotRisk } from "../utils/tokenizer.ts";
import { BENCHMARK_SAMPLES } from "../benchmark/samples.ts";
import { runBenchmarkSuite } from "../benchmark/runner.ts";
import { handleMcpJsonRpc, type JsonRpcRequest } from "../mcp/server.ts";
import { getDashboardHtml } from "../web/dashboardHtml.ts";

function readRequestBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown, extraHeaders: Record<string, string> = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key, x-upstream-base-url, x-context-diet-mode",
    ...extraHeaders,
  });
  res.end(JSON.stringify(payload, null, 2));
}

export function createContextDietServer() {
  const server = http.createServer(async (req, res) => {
    const method = req.method || "GET";
    const urlObj = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = urlObj.pathname;

    if (method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "*",
      });
      res.end();
      return;
    }

    try {
      // 1. Web Dashboard UI
      if (method === "GET" && (pathname === "/" || pathname === "/dashboard")) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(getDashboardHtml());
        return;
      }

      // 2. Telemetry & Context Rot API
      if (method === "GET" && pathname === "/api/telemetry") {
        const telemetry = globalVault.getTelemetrySummary();
        const contextRotRisk = calculateContextRotRisk(telemetry.totalCompressedTokens || 2400);
        sendJson(res, 200, { telemetry, contextRotRisk });
        return;
      }

      // 3. Preset Samples API
      if (method === "GET" && pathname === "/api/samples") {
        sendJson(res, 200, { samples: BENCHMARK_SAMPLES });
        return;
      }

      // 4. Reversible Vault Expansion API
      if (method === "GET" && pathname.startsWith("/api/vault/")) {
        const refId = decodeURIComponent(pathname.replace("/api/vault/", ""));
        const entry = globalVault.expandSlice(refId);
        if (!entry) {
          sendJson(res, 404, { error: `Vault ref '${refId}' not found` });
          return;
        }
        sendJson(res, 200, entry);
        return;
      }

      // 5. Interactive Compress / Fold API
      if (method === "POST" && pathname === "/api/compress") {
        const rawBody = await readRequestBody(req);
        const body = JSON.parse(rawBody || "{}") as {
          content?: string;
          mode?: "auto" | "episodic";
          aggressiveness?: "conservative" | "balanced" | "aggressive";
          focusKeywords?: string[];
        };

        const content = body.content || "";
        if (body.mode === "episodic") {
          let parsedMsgs: AgentMessage[] = [];
          try {
            parsedMsgs = JSON.parse(content);
          } catch {
            parsedMsgs = [{ role: "user", content }];
          }
          const epRes = foldAgentTrajectory(parsedMsgs, {
            keepRecentMessages: 2,
            source: "playground",
          });
          sendJson(res, 200, {
            detectedType: "episodic",
            compressedText: JSON.stringify(epRes.foldedMessages, null, 2),
            originalTokens: epRes.originalTokens,
            compressedTokens: epRes.compressedTokens,
            savedTokens: epRes.savedTokens,
            compressionRatioPct: epRes.compressionRatioPct,
            latencyMs: epRes.latencyMs,
            refIds: epRes.framesCreated.map((f) => f.vaultRef),
            framesCreated: epRes.framesCreated,
          });
          return;
        }

        const compRes = smartCompress(content, {
          aggressiveness: body.aggressiveness || "balanced",
          focusKeywords: body.focusKeywords,
          source: "playground",
        });
        sendJson(res, 200, compRes);
        return;
      }

      // 6. Full Benchmark Suite Runner API
      if (method === "POST" && pathname === "/api/benchmark") {
        const summary = runBenchmarkSuite();
        sendJson(res, 200, summary);
        return;
      }

      // 7. MCP over HTTP JSON-RPC Endpoint
      if (method === "POST" && pathname === "/mcp") {
        const rawBody = await readRequestBody(req);
        const rpcReq = JSON.parse(rawBody) as JsonRpcRequest;
        const rpcResp = handleMcpJsonRpc(rpcReq);
        sendJson(res, 200, rpcResp || { jsonrpc: "2.0", result: "ack" });
        return;
      }

      // 8. OpenAI-Compatible Transparent Proxy (/v1/chat/completions)
      if (method === "POST" && pathname === "/v1/chat/completions") {
        const rawBody = await readRequestBody(req);
        const payload = JSON.parse(rawBody) as {
          model?: string;
          messages?: AgentMessage[];
          [key: string]: unknown;
        };

        const messages = Array.isArray(payload.messages) ? payload.messages : [];
        const foldResult = foldAgentTrajectory(messages, {
          keepRecentMessages: 4,
          compressRecentToolOutputs: true,
          source: "proxy-openai",
        });

        const upstreamBase = req.headers["x-upstream-base-url"] as string | undefined;
        const dietHeaders = {
          "x-context-diet-original-tokens": String(foldResult.originalTokens),
          "x-context-diet-compressed-tokens": String(foldResult.compressedTokens),
          "x-context-diet-saved-tokens": String(foldResult.savedTokens),
          "x-context-diet-ratio-pct": String(foldResult.compressionRatioPct),
        };

        if (upstreamBase) {
          const targetUrl = `${upstreamBase.replace(/\/$/, "")}/v1/chat/completions`;
          const upstreamResp = await fetch(targetUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}),
            },
            body: JSON.stringify({
              ...payload,
              messages: foldResult.foldedMessages,
            }),
          });
          const upstreamData = await upstreamResp.json();
          sendJson(res, upstreamResp.status, upstreamData, dietHeaders);
          return;
        }

        // Sandbox Dry-Run Response (when no upstream API key is needed)
        sendJson(
          res,
          200,
          {
            id: `chatcmpl_diet_${Date.now()}`,
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: payload.model || "claude-sonnet-4-via-context-diet",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: `[ContextDiet Transparent Proxy Verified] Compressed incoming context from ${foldResult.originalTokens} → ${foldResult.compressedTokens} tokens (-${foldResult.compressionRatioPct}%). Ready for downstream reasoning.`,
                },
                finish_reason: "stop",
              },
            ],
            usage: {
              prompt_tokens: foldResult.compressedTokens,
              completion_tokens: 28,
              total_tokens: foldResult.compressedTokens + 28,
              context_diet_telemetry: {
                originalPromptTokens: foldResult.originalTokens,
                savedPromptTokens: foldResult.savedTokens,
                compressionRatioPct: foldResult.compressionRatioPct,
                episodicFramesCreated: foldResult.framesCreated.length,
              },
            },
          },
          dietHeaders
        );
        return;
      }

      // 9. Anthropic-Compatible Transparent Proxy (/v1/messages)
      if (method === "POST" && pathname === "/v1/messages") {
        const rawBody = await readRequestBody(req);
        const payload = JSON.parse(rawBody) as {
          model?: string;
          messages?: Array<{ role: string; content: unknown }>;
          [key: string]: unknown;
        };

        let totalOriginal = 0;
        let totalCompressed = 0;

        const compressedMessages = (payload.messages || []).map((msg) => {
          if (typeof msg.content === "string" && msg.content.length > 300) {
            const comp = smartCompress(msg.content, { source: "proxy-anthropic" });
            totalOriginal += comp.originalTokens;
            totalCompressed += comp.compressedTokens;
            return { ...msg, content: comp.compressedText };
          }
          if (Array.isArray(msg.content)) {
            const newBlocks = msg.content.map((block: any) => {
              if (block && block.type === "tool_result" && typeof block.content === "string") {
                const comp = smartCompress(block.content, { source: "proxy-anthropic" });
                totalOriginal += comp.originalTokens;
                totalCompressed += comp.compressedTokens;
                return { ...block, content: comp.compressedText };
              }
              return block;
            });
            return { ...msg, content: newBlocks };
          }
          return msg;
        });

        sendJson(res, 200, {
          id: `msg_diet_${Date.now()}`,
          type: "message",
          role: "assistant",
          model: payload.model || "claude-sonnet-4-20250514",
          content: [
            {
              type: "text",
              text: `[ContextDiet Anthropic Proxy] Processed ${compressedMessages.length} messages (${totalOriginal} → ${totalCompressed} tool tokens).`,
            },
          ],
          usage: {
            input_tokens: totalCompressed,
            output_tokens: 22,
          },
        });
        return;
      }

      sendJson(res, 404, { error: `Route ${method} ${pathname} not found` });
    } catch (err) {
      sendJson(res, 500, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return server;
}
