import { countTokens } from "../utils/tokenizer.ts";
import { globalVault, type AuditRecord } from "../store/vault.ts";
import { smartCompress } from "../compressors/index.ts";

export interface AgentMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type?: string;
    function: { name: string; arguments: string };
  }>;
}

export interface EpisodicMemoryFrame {
  frameId: string;
  vaultRef: string;
  turnsFolded: number;
  toolsInvoked: string[];
  filesTouched: string[];
  pitfallsAndErrors: string[];
  keyFindings: string[];
  verificationStatus: "VERIFIED_PASS" | "IN_PROGRESS" | "HAD_ERRORS";
}

export interface TrajectoryFoldResult {
  originalMessages: AgentMessage[];
  foldedMessages: AgentMessage[];
  framesCreated: EpisodicMemoryFrame[];
  originalTokens: number;
  compressedTokens: number;
  savedTokens: number;
  compressionRatioPct: number;
  latencyMs: number;
  auditRecord?: AuditRecord;
}

/**
 * Evaluates verification outcome from structured terminal/test summary indicators
 * rather than naive single-word substring checks.
 */
export function evaluateVerificationOutcome(texts: string[]): {
  hasExplicitFailure: boolean;
  hasVerifiedSuitePass: boolean;
} {
  let lastOutcome: "pass" | "fail" | "unknown" = "unknown";
  let sawAnyFailure = false;

  const suiteFailRegex =
    /(\bexit code [1-9]\d*\b|\b[1-9]\d*\s+failed\b|\bFAIL\s+\S+\.\w+|\bAssertionError\b|\bSQLSTATE\s+[0-9A-Z]{5}\b|\bELIFECYCLE\b)/i;
  const suitePassRegex =
    /(\bexit code 0\b|\ball tests passed\b|\bPASS\s+\d+\/\d+\b|\b0 failed\b|\bbuild succeeded\b)/i;

  for (const text of texts) {
    if (suiteFailRegex.test(text)) {
      sawAnyFailure = true;
      lastOutcome = "fail";
    } else if (suitePassRegex.test(text)) {
      lastOutcome = "pass";
    }
  }

  return {
    hasExplicitFailure: sawAnyFailure && lastOutcome !== "pass",
    hasVerifiedSuitePass: lastOutcome === "pass",
  };
}

/**
 * Episodic Memory Folding Engine
 * Supports two modes:
 * 1. `preserveToolPairing: true` (used by live OpenAI/Anthropic proxies):
 *    Never breaks `assistant.tool_calls` <-> `tool.tool_call_id` message schema constraints;
 *    folds older tool outputs in-place into compact `<EpisodicToolDigest>` blocks.
 * 2. `preserveToolPairing: false` (default for MCP `diet_fold_trajectory` & analysis):
 *    Condenses closed intermediate turns into a unified `<EpisodicMemoryFrame>` while ensuring
 *    no orphan `tool` or `tool_calls` message is left dangling at the boundary.
 */
export function foldAgentTrajectory(
  messages: AgentMessage[],
  options: {
    keepRecentMessages?: number;
    compressRecentToolOutputs?: boolean;
    preserveToolPairing?: boolean;
    source?: AuditRecord["source"];
  } = {}
): TrajectoryFoldResult {
  const start = performance.now();
  const keepRecent = options.keepRecentMessages ?? 4;
  const compressRecentTools = options.compressRecentToolOutputs ?? true;
  const preservePairing = options.preserveToolPairing ?? false;

  const originalSerialized = JSON.stringify(messages, null, 2);
  const originalTokens = countTokens(originalSerialized);

  // Separate pinned header messages (system + initial user prompt)
  let middleStartIndex = 0;
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === "system" || (messages[i].role === "user" && i <= 1)) {
      middleStartIndex = i + 1;
    } else {
      break;
    }
  }

  let tailStartIndex = Math.max(middleStartIndex, messages.length - keepRecent);
  // Ensure tailStartIndex does NOT land on a `role: "tool"` message (which would orphan it from its assistant.tool_calls parent)
  while (tailStartIndex > middleStartIndex && messages[tailStartIndex]?.role === "tool") {
    tailStartIndex--;
  }

  const headerMessages = messages.slice(0, middleStartIndex);
  const middleMessages = messages.slice(middleStartIndex, tailStartIndex);
  const tailMessages = messages.slice(tailStartIndex);

  const framesCreated: EpisodicMemoryFrame[] = [];
  let foldedMiddleMessages: AgentMessage[] = [];

  if (middleMessages.length >= 2) {
    const toolsInvoked = new Set<string>();
    const filesTouched = new Set<string>();
    const pitfallsAndErrors: string[] = [];
    const keyFindings: string[] = [];
    const rawTextsForEval: string[] = [];

    const fileRegex =
      /(?:[a-zA-Z0-9_.-]+\/)+[a-zA-Z0-9_.-]+\.(?:ts|tsx|js|py|go|rs|json|sql|yaml|md)/g;
    const errorLineRegex =
      /(?:Error|Exception|TypeError|SyntaxError|FAIL|failed|ENOENT|SQLSTATE\s+\w+|status\s*[45]\d\d)[:\s][^\n]{5,120}/gi;

    for (const msg of middleMessages) {
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          toolsInvoked.add(tc.function.name);
          const fileMatches = tc.function.arguments.match(fileRegex);
          if (fileMatches) fileMatches.forEach((f) => filesTouched.add(f));
        }
      }
      if (msg.name) toolsInvoked.add(msg.name);

      const content =
        typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      rawTextsForEval.push(content);

      const fileMatches = content.match(fileRegex);
      if (fileMatches) {
        fileMatches.slice(0, 6).forEach((f) => filesTouched.add(f));
      }

      const errMatches = content.match(errorLineRegex);
      if (errMatches) {
        for (const m of errMatches.slice(0, 2)) {
          const clean = m.trim();
          if (!pitfallsAndErrors.includes(clean) && pitfallsAndErrors.length < 4) {
            pitfallsAndErrors.push(clean);
          }
        }
      }

      if (msg.role === "assistant" && content.trim().length > 20) {
        const firstSentence = content.trim().split(/\n|\.\s/)[0].slice(0, 140);
        if (firstSentence && keyFindings.length < 4) {
          keyFindings.push(firstSentence);
        }
      }
    }

    const evalOutcome = evaluateVerificationOutcome(rawTextsForEval);
    const verificationStatus: EpisodicMemoryFrame["verificationStatus"] =
      evalOutcome.hasVerifiedSuitePass
        ? "VERIFIED_PASS"
        : evalOutcome.hasExplicitFailure || pitfallsAndErrors.length > 0
          ? "HAD_ERRORS"
          : "IN_PROGRESS";

    const vaultEntry = globalVault.storeFoldedSlice({
      category: "episodic",
      label: `Episodic Trajectory (${middleMessages.length} turns folded)`,
      originalContent: JSON.stringify(middleMessages, null, 2),
      compressedPreview: `<EpisodicMemoryFrame turns="${middleMessages.length}" status="${verificationStatus}" />`,
    });

    const frame: EpisodicMemoryFrame = {
      frameId: `ep_${vaultEntry.refId.replace("diet_ref:", "")}`,
      vaultRef: vaultEntry.refId,
      turnsFolded: middleMessages.length,
      toolsInvoked: Array.from(toolsInvoked),
      filesTouched: Array.from(filesTouched).slice(0, 10),
      pitfallsAndErrors,
      keyFindings,
      verificationStatus,
    };
    framesCreated.push(frame);

    if (preservePairing) {
      // Protocol-Safe Mode: keep message roles & tool_call_ids valid for strict OpenAI/Anthropic schemas
      foldedMiddleMessages = middleMessages.map((msg) => {
        if (msg.role === "tool" && typeof msg.content === "string" && msg.content.length > 180) {
          const singleVault = globalVault.storeFoldedSlice({
            category: "episodic",
            label: `Historical tool output (${msg.name || msg.tool_call_id || "tool"})`,
            originalContent: msg.content,
            compressedPreview: `[Folded historical tool output]`,
          });
          const filesInMsg = (msg.content.match(fileRegex) || []).slice(0, 4).join(", ");
          const errsInMsg = (msg.content.match(errorLineRegex) || [])
            .slice(0, 2)
            .map((e) => e.trim())
            .join(" | ");
          return {
            ...msg,
            content: `<EpisodicToolDigest ref="${singleVault.refId}" parent_frame="${frame.vaultRef}" files="${filesInMsg || "none"}" errors="${errsInMsg || "none"}">Historical tool output folded (${countTokens(msg.content)} tokens). Call MCP tool diet_expand_frame(refId="${singleVault.refId}") to restore.</EpisodicToolDigest>`,
          };
        }
        return msg;
      });
    } else {
      const xmlSummary = [
        `<EpisodicMemoryFrame id="${frame.frameId}" turns_folded="${frame.turnsFolded}" status="${frame.verificationStatus}" expand_ref="${frame.vaultRef}">`,
        `  <ToolsInvoked>${frame.toolsInvoked.join(", ") || "general_reasoning"}</ToolsInvoked>`,
        `  <FilesTouched>${frame.filesTouched.join(", ") || "none"}</FilesTouched>`,
        frame.pitfallsAndErrors.length > 0
          ? `  <PitfallsEncountered>\n${frame.pitfallsAndErrors.map((p) => `    - [AVOID] ${p}`).join("\n")}\n  </PitfallsEncountered>`
          : `  <PitfallsEncountered>None</PitfallsEncountered>`,
        frame.keyFindings.length > 0
          ? `  <KeyReasoningSteps>\n${frame.keyFindings.map((k) => `    - ${k}`).join("\n")}\n  </KeyReasoningSteps>`
          : "",
        `  <RecoveryHint>Call MCP tool 'diet_expand_frame' with refId="${frame.vaultRef}" if raw intermediate logs are needed.</RecoveryHint>`,
        `</EpisodicMemoryFrame>`,
      ]
        .filter(Boolean)
        .join("\n");

      foldedMiddleMessages.push({
        role: "assistant",
        content: xmlSummary,
      });
    }
  } else {
    foldedMiddleMessages.push(...middleMessages);
  }

  // Compress oversized tool outputs in the active tail using structure-aware compressors
  const processedTail = tailMessages.map((msg) => {
    if (compressRecentTools && msg.role === "tool" && typeof msg.content === "string" && msg.content.length > 260) {
      const res = smartCompress(msg.content, { recordAudit: false });
      return { ...msg, content: res.compressedText };
    }
    return msg;
  });

  const foldedMessages = [...headerMessages, ...foldedMiddleMessages, ...processedTail];
  const compressedSerialized = JSON.stringify(foldedMessages, null, 2);
  const compressedTokens = countTokens(compressedSerialized);
  const savedTokens = Math.max(0, originalTokens - compressedTokens);
  const compressionRatioPct =
    originalTokens > 0
      ? Number(((savedTokens / originalTokens) * 100).toFixed(1))
      : 0;
  const latencyMs = Number((performance.now() - start).toFixed(2));

  const auditRecord = globalVault.recordAudit({
    source: options.source || "playground",
    contentType: "episodic",
    mode: preservePairing ? `schema_safe_keep_${keepRecent}` : `keep_recent_${keepRecent}`,
    originalTokens,
    compressedTokens,
    latencyMs,
    refIds: framesCreated.map((f) => f.vaultRef),
    summary: `Folded ${middleMessages.length} trajectory turns (${originalTokens} → ${compressedTokens} tokens, -${compressionRatioPct}%)`,
  });

  return {
    originalMessages: messages,
    foldedMessages,
    framesCreated,
    originalTokens,
    compressedTokens,
    savedTokens,
    compressionRatioPct,
    latencyMs,
    auditRecord,
  };
}
