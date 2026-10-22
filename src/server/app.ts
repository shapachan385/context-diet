import http from "node:http";
import { Readable } from "node:stream";
import { smartCompress } from "../compressors/index.ts";
import { foldAgentTrajectory, type AgentMessage } from "../memory/episodicFolder.ts";
import { globalVault } from "../store/vault.ts";
import { calculateContextRotRisk, countTokens } from "../utils/tokenizer.ts";
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

function sendJson(
  res: http.ServerResponse,
  status: number,
  payload: unknown,
  extraHeaders: Record<string, string> = {}
) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, x-api-key, anthropic-version, anthropic-beta, x-upstream-base-url, x-context-diet-mode, x-context-diet-dry-run",
    ...extraHeaders,
  });
  res.end(JSON.stringify(payload, null, 2));
}

/**
 * Streams or sends a fetch() Response back to Node's http.ServerResponse,
 * preserving SSE (`text/event-stream`) chunks in real time.
 */
async function forwardUpstreamResponse(
  upstreamResp: Response,
  res: http.ServerResponse,
  dietHeaders: Record<string, string>
) {
  const contentType =
    upstreamResp.headers.get("content-type") || "application/json; charset=utf-8";
  const isEventStream = contentType.includes("text/event-stream");

  const responseHeaders: Record<string, string> = {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*",
    ...dietHeaders,
  };

  if (isEventStream) {
    responseHeaders["Cache-Control"] = "no-cache, no-transform";
    responseHeaders["Connection"] = "keep-alive";
  }

  res.writeHead(upstreamResp.status, responseHeaders);

  if (!upstreamResp.body) {
    res.end();
    return;
  }

  const nodeStream = Readable.fromWeb(upstreamResp.body as any);
  for await (const chunk of nodeStream) {
    res.write(chunk);
  }
  res.end();
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
        const contextRotRisk = calculateContextRotRisk(
          telemetry.totalCompressedTokens || 2400
        );
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
        const trackExpansion = urlObj.searchParams.get("track") === "1";
        const entry = globalVault.expandSlice(refId, {
          recordExpansionOverhead: trackExpansion,
        });
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
            preserveToolPairing: false,
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

      // 8. OpenAI Chat Completions Proxy (/v1/chat/completions) — Supports JSON & SSE Streaming
      if (method === "POST" && pathname === "/v1/chat/completions") {
        const rawBody = await readRequestBody(req);
        const payload = JSON.parse(rawBody) as {
          model?: string;
          stream?: boolean;
          messages?: AgentMessage[];
          [key: string]: unknown;
        };

        const messages = Array.isArray(payload.messages) ? payload.messages : [];
        // Use preserveToolPairing: true so OpenAI never rejects tool_calls <-> tool pairing
        const foldResult = foldAgentTrajectory(messages, {
          keepRecentMessages: 4,
          compressRecentToolOutputs: true,
          preserveToolPairing: true,
          source: "proxy-openai",
        });

        const dietHeaders: Record<string, string> = {
          "x-context-diet-original-tokens": String(foldResult.originalTokens),
          "x-context-diet-compressed-tokens": String(foldResult.compressedTokens),
          "x-context-diet-saved-tokens": String(foldResult.savedTokens),
          "x-context-diet-ratio-pct": String(foldResult.compressionRatioPct),
        };

        const isDryRun = req.headers["x-context-diet-dry-run"] === "true";
        const authHeader =
          (req.headers.authorization as string | undefined) ||
          (process.env.OPENAI_API_KEY ? `Bearer ${process.env.OPENAI_API_KEY}` : undefined);
        const explicitUpstream = req.headers["x-upstream-base-url"] as string | undefined;
        const upstreamBase =
          explicitUpstream ||
          process.env.OPENAI_BASE_URL ||
          (authHeader && !isDryRun ? "https://api.openai.com" : undefined);

        if (upstreamBase && !isDryRun) {
          const normalizedBase = upstreamBase.replace(/\/$/, "");
          const targetUrl = normalizedBase.endsWith("/v1")
            ? `${normalizedBase}/chat/completions`
            : `${normalizedBase}/v1/chat/completions`;

          const upstreamResp = await fetch(targetUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(authHeader ? { Authorization: authHeader } : {}),
            },
            body: JSON.stringify({
              ...payload,
              messages: foldResult.foldedMessages,
            }),
          });

          await forwardUpstreamResponse(upstreamResp, res, dietHeaders);
          return;
        }

        // Local Dry-Run Mode (Supports both stream: true SSE and JSON!)
        if (payload.stream) {
          res.writeHead(200, {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            ...dietHeaders,
          });
          const chunkPayload = {
            id: `chatcmpl_diet_${Date.now()}`,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: payload.model || "gpt-4o",
            choices: [
              {
                index: 0,
                delta: {
                  role: "assistant",
                  content: `[ContextDiet Streaming Proxy] Compressed ${foldResult.originalTokens} → ${foldResult.compressedTokens} tokens (-${foldResult.compressionRatioPct}%).`,
                },
                finish_reason: "stop",
              },
            ],
          };
          res.write(`data: ${JSON.stringify(chunkPayload)}\n\n`);
          res.write(`data: [DONE]\n\n`);
          res.end();
          return;
        }

        sendJson(
          res,
          200,
          {
            id: `chatcmpl_diet_${Date.now()}`,
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: payload.model || "gpt-4o",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: `[ContextDiet Proxy Dry-Run] Compressed incoming context from ${foldResult.originalTokens} → ${foldResult.compressedTokens} tokens (-${foldResult.compressionRatioPct}%). Pass an Authorization header or OPENAI_API_KEY to forward to upstream.`,
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

      // 9. OpenAI Responses API Proxy (/v1/responses) — Used by OpenAI Codex CLI
      if (method === "POST" && pathname === "/v1/responses") {
        const start = performance.now();
        const rawBody = await readRequestBody(req);
        const payload = JSON.parse(rawBody) as {
          model?: string;
          stream?: boolean;
          input?: unknown;
          [key: string]: unknown;
        };

        const originalTokens = countTokens(rawBody);
        const refIds: string[] = [];

        let compressedInput = payload.input;
        if (Array.isArray(payload.input)) {
          compressedInput = payload.input.map((item: any) => {
            if (
              item &&
              item.type === "function_call_output" &&
              typeof item.output === "string" &&
              item.output.length > 260
            ) {
              const comp = smartCompress(item.output, { recordAudit: false });
              refIds.push(...comp.refIds);
              return { ...item, output: comp.compressedText };
            }
            return item;
          });
        }

        const updatedPayload = { ...payload, input: compressedInput };
        const compressedBodyStr = JSON.stringify(updatedPayload);
        const compressedTokens = countTokens(compressedBodyStr);
        const savedTokens = Math.max(0, originalTokens - compressedTokens);
        const latencyMs = Number((performance.now() - start).toFixed(2));

        const isDryRun = req.headers["x-context-diet-dry-run"] === "true";
        const authHeader =
          (req.headers.authorization as string | undefined) ||
          (process.env.OPENAI_API_KEY ? `Bearer ${process.env.OPENAI_API_KEY}` : undefined);
        const explicitUpstream = req.headers["x-upstream-base-url"] as string | undefined;
        const upstreamBase =
          explicitUpstream ||
          process.env.OPENAI_BASE_URL ||
          (authHeader && !isDryRun ? "https://api.openai.com" : undefined);

        globalVault.recordAudit({
          source: "proxy-openai-responses",
          contentType: "mixed",
          mode: "responses_api",
          originalTokens,
          compressedTokens,
          latencyMs,
          refIds,
          summary: `OpenAI /v1/responses compressed (${originalTokens} → ${compressedTokens} tokens)`,
          upstreamForwarded: Boolean(upstreamBase && !isDryRun),
        });

        const dietHeaders: Record<string, string> = {
          "x-context-diet-original-tokens": String(originalTokens),
          "x-context-diet-compressed-tokens": String(compressedTokens),
          "x-context-diet-saved-tokens": String(savedTokens),
        };

        if (upstreamBase && !isDryRun) {
          const normalizedBase = upstreamBase.replace(/\/$/, "");
          const targetUrl = normalizedBase.endsWith("/v1")
            ? `${normalizedBase}/responses`
            : `${normalizedBase}/v1/responses`;

          const upstreamResp = await fetch(targetUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(authHeader ? { Authorization: authHeader } : {}),
            },
            body: compressedBodyStr,
          });
          await forwardUpstreamResponse(upstreamResp, res, dietHeaders);
          return;
        }

        sendJson(
          res,
          200,
          {
            id: `resp_diet_${Date.now()}`,
            object: "response",
            model: payload.model || "codex-mini-latest",
            output: [
              {
                type: "message",
                role: "assistant",
                content: [
                  {
                    type: "output_text",
                    text: `[ContextDiet /v1/responses Proxy] Compressed ${originalTokens} → ${compressedTokens} tokens (saved ${savedTokens}).`,
                  },
                ],
              },
            ],
            usage: {
              input_tokens: compressedTokens,
              output_tokens: 20,
              total_tokens: compressedTokens + 20,
            },
          },
          dietHeaders
        );
        return;
      }

      // 10. Anthropic Messages Proxy (/v1/messages) — Supports Upstream Forwarding & SSE Streaming
      if (method === "POST" && pathname === "/v1/messages") {
        const start = performance.now();
        const rawBody = await readRequestBody(req);
        const payload = JSON.parse(rawBody) as {
          model?: string;
          stream?: boolean;
          messages?: Array<{ role: string; content: unknown }>;
          [key: string]: unknown;
        };

        const originalTokens = countTokens(rawBody);
        const refIds: string[] = [];

        const compressedMessages = (payload.messages || []).map((msg) => {
          if (typeof msg.content === "string" && msg.content.length > 300) {
            const comp = smartCompress(msg.content, { recordAudit: false });
            refIds.push(...comp.refIds);
            return { ...msg, content: comp.compressedText };
          }
          if (Array.isArray(msg.content)) {
            const newBlocks = msg.content.map((block: any) => {
              if (!block || block.type !== "tool_result") return block;
              if (typeof block.content === "string" && block.content.length > 260) {
                const comp = smartCompress(block.content, { recordAudit: false });
                refIds.push(...comp.refIds);
                return { ...block, content: comp.compressedText };
              }
              if (Array.isArray(block.content)) {
                const innerBlocks = block.content.map((sub: any) => {
                  if (
                    sub &&
                    sub.type === "text" &&
                    typeof sub.text === "string" &&
                    sub.text.length > 260
                  ) {
                    const comp = smartCompress(sub.text, { recordAudit: false });
                    refIds.push(...comp.refIds);
                    return { ...sub, text: comp.compressedText };
                  }
                  return sub;
                });
                return { ...block, content: innerBlocks };
              }
              return block;
            });
            return { ...msg, content: newBlocks };
          }
          return msg;
        });

        const updatedPayload = { ...payload, messages: compressedMessages };
        const compressedBodyStr = JSON.stringify(updatedPayload);
        const compressedTokens = countTokens(compressedBodyStr);
        const savedTokens = Math.max(0, originalTokens - compressedTokens);
        const ratioPct =
          originalTokens > 0
            ? Number(((savedTokens / originalTokens) * 100).toFixed(1))
            : 0;
        const latencyMs = Number((performance.now() - start).toFixed(2));

        const isDryRun = req.headers["x-context-diet-dry-run"] === "true";
        const apiKey =
          (req.headers["x-api-key"] as string | undefined) ||
          process.env.ANTHROPIC_API_KEY;
        const authHeader = req.headers.authorization as string | undefined;
        const explicitUpstream = req.headers["x-upstream-base-url"] as string | undefined;
        const upstreamBase =
          explicitUpstream ||
          process.env.ANTHROPIC_BASE_URL ||
          ((apiKey || authHeader) && !isDryRun ? "https://api.anthropic.com" : undefined);

        globalVault.recordAudit({
          source: "proxy-anthropic",
          contentType: "mixed",
          mode: "anthropic_messages",
          originalTokens,
          compressedTokens,
          latencyMs,
          refIds,
          summary: `Anthropic /v1/messages compressed (${originalTokens} → ${compressedTokens} tokens, -${ratioPct}%)`,
          upstreamForwarded: Boolean(upstreamBase && !isDryRun),
        });

        const dietHeaders: Record<string, string> = {
          "x-context-diet-original-tokens": String(originalTokens),
          "x-context-diet-compressed-tokens": String(compressedTokens),
          "x-context-diet-saved-tokens": String(savedTokens),
          "x-context-diet-ratio-pct": String(ratioPct),
        };

        if (upstreamBase && !isDryRun) {
          const normalizedBase = upstreamBase.replace(/\/$/, "");
          const targetUrl = normalizedBase.endsWith("/v1")
            ? `${normalizedBase}/messages`
            : `${normalizedBase}/v1/messages`;

          const upstreamHeaders: Record<string, string> = {
            "Content-Type": "application/json",
            "anthropic-version":
              (req.headers["anthropic-version"] as string) || "2023-06-01",
          };
          if (apiKey) upstreamHeaders["x-api-key"] = apiKey;
          if (authHeader) upstreamHeaders["Authorization"] = authHeader;
          if (req.headers["anthropic-beta"]) {
            upstreamHeaders["anthropic-beta"] = String(req.headers["anthropic-beta"]);
          }

          const upstreamResp = await fetch(targetUrl, {
            method: "POST",
            headers: upstreamHeaders,
            body: compressedBodyStr,
          });

          await forwardUpstreamResponse(upstreamResp, res, dietHeaders);
          return;
        }

        // Local Dry-Run Mode for Anthropic (Supports both SSE stream: true & JSON)
        if (payload.stream) {
          res.writeHead(200, {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            ...dietHeaders,
          });
          res.write(
            `event: message_start\ndata: ${JSON.stringify({
              type: "message_start",
              message: {
                id: `msg_diet_${Date.now()}`,
                type: "message",
                role: "assistant",
                model: payload.model || "claude-sonnet-4-20250514",
                content: [],
                usage: { input_tokens: compressedTokens, output_tokens: 1 },
              },
            })}\n\n`
          );
          res.write(
            `event: content_block_delta\ndata: ${JSON.stringify({
              type: "content_block_delta",
              index: 0,
              delta: {
                type: "text_delta",
                text: `[ContextDiet Anthropic Streaming Proxy] Compressed ${originalTokens} → ${compressedTokens} tokens (-${ratioPct}%).`,
              },
            })}\n\n`
          );
          res.write(`event: message_stop\ndata: {"type":"message_stop"}\n\n`);
          res.end();
          return;
        }

        sendJson(
          res,
          200,
          {
            id: `msg_diet_${Date.now()}`,
            type: "message",
            role: "assistant",
            model: payload.model || "claude-sonnet-4-20250514",
            content: [
              {
                type: "text",
                text: `[ContextDiet Anthropic Proxy Dry-Run] Processed ${(payload.messages || []).length} messages (${originalTokens} → ${compressedTokens} tokens, -${ratioPct}%). Provide x-api-key or ANTHROPIC_API_KEY to forward to Anthropic.`,
              },
            ],
            usage: {
              input_tokens: compressedTokens,
              output_tokens: 22,
            },
          },
          dietHeaders
        );
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
