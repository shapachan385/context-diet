/**
 * Accurate Heuristic BPE Token Estimator & Multi-Model Pricing Calculator
 * Designed for sub-millisecond overhead in real-time Agent Proxy & MCP pipelines.
 */

export interface ModelPricing {
  id: string;
  name: string;
  provider: string;
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
}

export const MODEL_PRICING_TABLE: Record<string, ModelPricing> = {
  "claude-sonnet-4": {
    id: "claude-sonnet-4",
    name: "Claude Sonnet 4 / 3.7",
    provider: "Anthropic",
    inputPerMillionUsd: 3.0,
    outputPerMillionUsd: 15.0,
  },
  "claude-opus-4": {
    id: "claude-opus-4",
    name: "Claude Opus 4",
    provider: "Anthropic",
    inputPerMillionUsd: 15.0,
    outputPerMillionUsd: 75.0,
  },
  "gpt-4o": {
    id: "gpt-4o",
    name: "GPT-4o / GPT-4.1",
    provider: "OpenAI",
    inputPerMillionUsd: 2.5,
    outputPerMillionUsd: 10.0,
  },
  "o3": {
    id: "o3",
    name: "OpenAI o3 Reasoning",
    provider: "OpenAI",
    inputPerMillionUsd: 10.0,
    outputPerMillionUsd: 40.0,
  },
  "deepseek-v3": {
    id: "deepseek-v3",
    name: "DeepSeek V3 / R1",
    provider: "DeepSeek",
    inputPerMillionUsd: 0.27,
    outputPerMillionUsd: 1.1,
  },
  "gemini-2.5-pro": {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    provider: "Google",
    inputPerMillionUsd: 1.25,
    outputPerMillionUsd: 10.0,
  },
};

/**
 * Estimates BPE token count (cl100k_base / o200k_base approximation)
 * Handles code symbols, JSON punctuation, CJK characters, and English words accurately.
 */
export function countTokens(text: string): number {
  if (!text || text.length === 0) return 0;

  let cjkCount = 0;
  let punctuationAndSymbols = 0;
  let whitespaceRuns = 0;
  let asciiAlphaNumChars = 0;

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // CJK Unified Ideographs and common full-width ranges
    if (code >= 0x2e80 && code <= 0x9fff) {
      cjkCount++;
    } else if (code <= 32) {
      if (i === 0 || text.charCodeAt(i - 1) > 32) {
        whitespaceRuns++;
      }
    } else if (
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122)
    ) {
      asciiAlphaNumChars++;
    } else {
      punctuationAndSymbols++;
    }
  }

  // BPE averages: ~3.8 ASCII alphanumeric chars per token, ~0.65 symbols per token (many merge with spaces), ~1.5 tokens per CJK char
  const estimated =
    Math.ceil(asciiAlphaNumChars / 3.8) +
    Math.ceil(punctuationAndSymbols * 0.68) +
    Math.ceil(cjkCount * 1.45) +
    Math.ceil(whitespaceRuns * 0.18);

  return Math.max(1, estimated);
}

export function estimateCostSavingsUsd(
  savedTokens: number,
  modelId: string = "claude-sonnet-4"
): number {
  const pricing =
    MODEL_PRICING_TABLE[modelId] || MODEL_PRICING_TABLE["claude-sonnet-4"];
  return Number(((savedTokens / 1_000_000) * pricing.inputPerMillionUsd).toFixed(6));
}

export function calculateContextRotRisk(totalTokens: number): {
  score: number; // 0 - 100
  level: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  description: string;
} {
  // Empirical studies show LLM needle-in-a-haystack & multi-hop reasoning degrade sharply past 32k-64k noisy tokens
  if (totalTokens < 4000) {
    return {
      score: Math.min(20, Math.round((totalTokens / 4000) * 20)),
      level: "LOW",
      description: "Optimal attention density. High reasoning precision.",
    };
  }
  if (totalTokens < 16000) {
    return {
      score: 20 + Math.round(((totalTokens - 4000) / 12000) * 35),
      level: "MODERATE",
      description: "Growing tool noise; minor attention dilution in middle turns.",
    };
  }
  if (totalTokens < 48000) {
    return {
      score: 55 + Math.round(((totalTokens - 16000) / 32000) * 30),
      level: "HIGH",
      description: "Significant Context Rot risk. Lost-in-the-middle hallucination likely.",
    };
  }
  return {
    score: Math.min(99, 85 + Math.round((totalTokens - 48000) / 10000)),
    level: "CRITICAL",
    description: "Severe Context Rot! Immediate episodic memory folding & pruning required.",
  };
}
