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
 * Episodic Memory Folding Engine
 * Compresses long multi-turn Agent tool-use trajectories into structured, high-density
 * `<EpisodicMemoryFrame>` blocks while compressing individual active tool outputs.
 */
export function foldAgentTrajectory(
  messages: AgentMessage[],
  options: {
    keepRecentMessages?: number;
    compressRecentToolOutputs?: boolean;
    source?: AuditRecord["source"];
  } = {}
): TrajectoryFoldResult {
  const start = performance.now();
  const keepRecent = options.keepRecentMessages ?? 4;
  const compressRecentTools = options.compressRecentToolOutputs ?? true;

  const originalSerialized = JSON.stringify(messages, null, 2);
  const originalTokens = countTokens(originalSerialized);

  if (messages.length <= keepRecent + 2) {
    // Still compress any large tool outputs in place
    const processed = messages.map((msg) => {
      if (msg.role === "tool" && msg.content.length > 400) {
        const res = smartCompress(msg.content, { recordAudit: false });
        return { ...msg, content: res.compressedText };
      }
      return msg;
    });
    const compressedTokens = countTokens(JSON.stringify(processed, null, 2));
    const savedTokens = Math.max(0, originalTokens - compressedTokens);
    const ratio =
      originalTokens > 0
        ? Number(((savedTokens / originalTokens) * 100).toFixed(1))
        : 0;
    return {
      originalMessages: messages,
      foldedMessages: processed,
      framesCreated: [],
      originalTokens,
      compressedTokens,
      savedTokens,
      compressionRatioPct: ratio,
      latencyMs: Number((performance.now() - start).toFixed(2)),
    };
  }

  // Separate pinned header messages (system + first user task), middle episodic zone, and active tail
  const headerMessages: AgentMessage[] = [];
  let middleStartIndex = 0;

  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === "system" || (messages[i].role === "user" && i <= 1)) {
      headerMessages.push(messages[i]);
      middleStartIndex = i + 1;
    } else {
      break;
    }
  }

  const tailStartIndex = Math.max(middleStartIndex, messages.length - keepRecent);
  const middleMessages = messages.slice(middleStartIndex, tailStartIndex);
  const tailMessages = messages.slice(tailStartIndex);

  const framesCreated: EpisodicMemoryFrame[] = [];
  const foldedMiddleMessages: AgentMessage[] = [];

  if (middleMessages.length >= 2) {
    const toolsInvoked = new Set<string>();
    const filesTouched = new Set<string>();
    const pitfallsAndErrors: string[] = [];
    const keyFindings: string[] = [];
    let sawPass = false;
    let sawError = false;

    const fileRegex =
      /(?:[a-zA-Z0-9_.-]+\/)+[a-zA-Z0-9_.-]+\.(?:ts|tsx|js|py|go|rs|json|sql|yaml|md)/g;
    const errorLineRegex =
      /(?:Error|Exception|TypeError|SyntaxError|FAIL|failed|ENOENT|status\s*[45]\d\d)[:\s][^\n]{5,120}/gi;

    for (const msg of middleMessages) {
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          toolsInvoked.add(tc.function.name);
          const fileMatches = tc.function.arguments.match(fileRegex);
          if (fileMatches) fileMatches.forEach((f) => filesTouched.add(f));
        }
      }
      if (msg.name) toolsInvoked.add(msg.name);

      const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      const fileMatches = content.match(fileRegex);
      if (fileMatches) {
        fileMatches.slice(0, 6).forEach((f) => filesTouched.add(f));
      }

      const errMatches = content.match(errorLineRegex);
      if (errMatches) {
        sawError = true;
        for (const m of errMatches.slice(0, 2)) {
          const clean = m.trim();
          if (!pitfallsAndErrors.includes(clean) && pitfallsAndErrors.length < 4) {
            pitfallsAndErrors.push(clean);
          }
        }
      }

      if (/\b(all tests passed|PASS\b|0 errors|build succeeded|fixed)\b/i.test(content)) {
        sawPass = true;
      }

      if (msg.role === "assistant" && content.trim().length > 20) {
        const firstSentence = content.trim().split(/\n|\.\s/)[0].slice(0, 140);
        if (firstSentence && keyFindings.length < 4) {
          keyFindings.push(firstSentence);
        }
      }
    }

    const verificationStatus: EpisodicMemoryFrame["verificationStatus"] = sawPass
      ? "VERIFIED_PASS"
      : sawError
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
  } else {
    foldedMiddleMessages.push(...middleMessages);
  }

  // Also compress oversized tool outputs in the active tail
  const processedTail = tailMessages.map((msg) => {
    if (compressRecentTools && msg.role === "tool" && msg.content.length > 300) {
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
    mode: `keep_recent_${keepRecent}`,
    originalTokens,
    compressedTokens,
    latencyMs,
    refIds: framesCreated.map((f) => f.vaultRef),
    summary: `Folded ${middleMessages.length} trajectory turns into EpisodicMemoryFrame (${originalTokens} → ${compressedTokens} tokens, -${compressionRatioPct}%)`,
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
