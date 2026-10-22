import type { AgentMessage } from "../memory/episodicFolder.ts";

export interface BenchmarkSample {
  id: string;
  title: string;
  category: "json" | "log" | "code" | "dom" | "episodic";
  description: string;
  rawInput: string;
  trajectoryMessages?: AgentMessage[];
  mustRetainSubstrings: string[];
}

function generateLargeApiJson(): string {
  const items = [];
  for (let i = 1; i <= 65; i++) {
    if (i === 37) {
      // Anomalous failing record buried in the middle of 65 items!
      items.push({
        id: `dep_prod_${i}`,
        service: "payment-settlement-worker",
        region: "us-east-1",
        status: 500,
        healthy: false,
        error: "FATAL: Deadlock detected on table ledger_entries (SQLSTATE 40P01)",
        latencyMs: 14820,
        replicas: 4,
        commitSha: "9f81c3a04b2e1189a7c6543210fedcba98765432",
         diagnosticDump:
          "Thread_dump_snapshot_01: waiting for exclusive lock on tuple (142,88) in relation ledger_entries; blocked by PID 49102 running batch reconciliation job.",
      });
    } else {
      items.push({
        id: `dep_prod_${i}`,
        service: `microservice-node-${(i % 6) + 1}`,
        region: i % 2 === 0 ? "us-east-1" : "eu-central-1",
        status: 200,
        healthy: true,
        latencyMs: 12 + (i % 15),
        replicas: 3,
        commitSha: "4a12b88c901d23456789abcdef0123456789abcd",
        diagnosticDump:
          "Routine health check completed OK. Memory pressure nominal (41.2%). GC pause 1.4ms. Connection pool active=4 idle=16 waiting=0. No anomalies.",
      });
    }
  }
  return JSON.stringify(
    {
      apiVersion: "v2.4",
      cluster: "prod-global-k8s",
      timestamp: "2026-10-22T09:30:00Z",
      totalNodes: 65,
      deployments: items,
    },
    null,
    2
  );
}

function generateNoisyTestLog(): string {
  const lines: string[] = [
    "$ pnpm test --run --reporter=verbose",
    "\x1B[36mINFO\x1B[0m Starting Vitest v3.1.0 test suite in workspace...",
    "\x1B[90m[DEBUG] Loading environment variables from .env.test\x1B[0m",
  ];

  for (let suite = 1; suite <= 8; suite++) {
    lines.push(`\n✓ src/modules/module-${suite}/service.spec.ts (18 tests) 142ms`);
    for (let t = 1; t <= 18; t++) {
      lines.push(
        `  ✓ Module ${suite} > should handle routine operation #${t} with valid payload (${2 + (t % 7)}ms)`
      );
      lines.push(
        `  [INFO] 2026-10-22T09:31:0${suite}Z GET /api/v1/health/check-${t} 200 OK - 3ms`
      );
    }
  }

  // Buried failure in suite 9
  lines.push(`\n❯ src/auth/tokenVerifier.spec.ts (6 tests | 1 failed) 89ms`);
  lines.push(`  ✓ AuthVerifier > should accept valid RS256 JWT token (4ms)`);
  lines.push(
    `  ✕ AuthVerifier > should reject expired refresh token with custom clock skew (19ms)`
  );
  lines.push(`    AssertionError: expectedstatus 200 to strictly equal 401`);
  lines.push(`    TypeError: Cannot read properties of undefined (reading 'expClaimSkew')`);
  lines.push(`        at verifyRefreshWindow (src/auth/tokenVerifier.ts:148:23)`);
  lines.push(`        at processTicksAndRejections (node:internal/process/task_queues:105:5)`);
  lines.push(`        at Object.<anonymous> (src/auth/tokenVerifier.spec.ts:74:11)`);

  for (let suite = 10; suite <= 14; suite++) {
    lines.push(`\n✓ src/modules/module-${suite}/controller.spec.ts (15 tests) 118ms`);
    for (let t = 1; t <= 15; t++) {
      lines.push(`  ✓ Controller ${suite} > passes validation check #${t} (3ms)`);
    }
  }

  lines.push(`\nTest Files  1 failed | 13 passed (14)`);
  lines.push(`     Tests  1 failed | 224 passed (225)`);
  lines.push(`  Duration  3.84s (transform 410ms, setup 0ms, collect 1.2s, tests 2.1s)`);
  lines.push(`ELIFECYCLE  Test run failed with exit code 1.`);
  return lines.join("\n");
}

function generateLargeTypeScriptFile(): string {
  return `import crypto from "node:crypto";
import type { DatabaseConnection, TransactionContext } from "./db/types.ts";

export interface SettlementRequest {
  OrderId: string;
  merchantId: string;
  amountCents: number;
  currency: "USD" | "EUR" | "CNY";
  idempotencyKey: string;
}

export interface SettlementReceipt {
  txId: string;
  settledAt: string;
  netAmountCents: number;
  feeCents: number;
}

export function formatCurrencyDisplay(amountCents: number, currency: string): string {
  const symbolMap: Record<string, string> = {
    USD: "$",
    EUR: "€",
    CNY: "¥",
    GBP: "£",
    JPY: "¥",
  };
  const prefix = symbolMap[currency] || currency + " ";
  const major = Math.floor(amountCents / 100);
  const minor = Math.abs(amountCents % 100)
    .toString()
    .padStart(2, "0");
  const formattedMajor = major.toString().replace(/\\B(?=(\\d{3})+(?!\\d))/g, ",");
  return \`\${prefix}\${formattedMajor}.\${minor}\`;
}

export function validateMerchantConfig(config: Record<string, unknown>): boolean {
  const requiredFields = [
    "merchantId",
    "webhookUrl",
    "settlementCycleDays",
    "riskTier",
    "kycVerifiedAt",
    "dailyLimitCents",
  ];
  for (const field of requiredFields) {
    if (config[field] === undefined || config[field] === null) {
      return false;
    }
  }
  if (typeof config.dailyLimitCents !== "number" || config.dailyLimitCents <= 0) {
    return false;
  }
  if (typeof config.webhookUrl !== "string" || !config.webhookUrl.startsWith("https://")) {
    return false;
  }
  return true;
}

export async function executeAtomicSettlement(
  db: DatabaseConnection,
  req: SettlementRequest
): Promise<SettlementReceipt> {
  if (req.amountCents <= 0) {
    throw new Error("INVALID_AMOUNT: Settlement amount must be positive");
  }
  const existing = await db.queryOne(
    "SELECT tx_id, settled_at, net_cents, fee_cents FROM settlements WHERE idempotency_key = $1",
    [req.idempotencyKey]
  );
  if (existing) {
    return {
      txId: existing.tx_id,
      settledAt: existing.settled_at,
      netAmountCents: existing.net_cents,
      feeCents: existing.fee_cents,
    };
  }
  const feeCents = Math.round(req.amountCents * 0.006);
  const netAmountCents = req.amountCents - feeCents;
  const txId = "stl_" + crypto.randomUUID();
  await db.execute(
    "INSERT INTO settlements (tx_id, order_id, merchant_id, net_cents, fee_cents, idempotency_key) VALUES ($1, $2, $3, $4, $5, $6)",
    [txId, req.OrderId, req.merchantId, netAmountCents, feeCents, req.idempotencyKey]
  );
  return {
    txId,
    settledAt: new Date().toISOString(),
    netAmountCents,
    feeCents,
  };
}

export function buildAuditCsvReport(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) {
    return "txId,merchantId,amountCents,status\\n";
  }
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const row of rows) {
    const escaped = headers.map((h) => {
      const val = row[h] === undefined || row[h] === null ? "" : String(row[h]);
      if (val.includes(",") || val.includes('"') || val.includes("\\n")) {
        return \`"\${val.replace(/"/g, '""')}"\`;
      }
      return val;
    });
    lines.push(escaped.join(","));
  }
  return lines.join("\\n");
}
`;
}

function generateHeavyDomHtml(): string {
  const repeatedCards = Array.from({ length: 12 }, (_, idx) => {
    return `<div class="flex flex-col items-start justify-between rounded-2xl border border-slate-800/80 bg-gradient-to-br from-slate-900/90 via-slate-900/60 to-slate-950 p-6 shadow-xl transition-all duration-300 hover:border-indigo-500/50" data-card-index="${idx}">
      <svg class="w-10 h-10 text-indigo-400" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><path d="M512 64C264.6 64 64 264.6 64 512s200.6 448 448 448 448-200.6 448-448S759.4 64 512 64zm0 820c-205.4 0-372-166.6-372-372s166.6-372 372-372 372 166.6 372 372-166.6 372-372 372zm128-400H544V352c0-17.7-14.3-32-32-32s-32 14.3-32 32v132H384c-17.7 0-32 14.3-32 32s14.3 32 32 32h96v132c0 17.7 14.3 32 32 32s32-14.3 32-32V548h96c17.7 0 32-14.3 32-32s-14.3-32-32-32z"/></svg>
      <img src="data:image/png;base64,${"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==".repeat(6)}" alt="Preview ${idx}" />
      <h3 class="text-lg font-semibold text-white">Plan Tier #${idx + 1}</h3>
    </div>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html>
<head>
  <style>
    body { margin: 0; font-family: sans-serif; background: #090d16; color: #f8fafc; }
    .grid-layout { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; }
  </style>
  <script>
    window.__ANALYTICS_BLOB__ = ${JSON.stringify(Array.from({ length: 30 }, (_, i) => `metric_tracker_${i}_payload_token_noise`))};
    function initTelemetry() { console.log("Telemetry initialized", window.__ANALYTICS_BLOB__); }
  </script>
</head>
<body>
  <main id="checkout-container" role="main">
    <h1>Enterprise Checkout Portal</h1>
    <form id="payment-form" action="/api/v2/checkout" method="POST">
      <input id="card-holder-input" name="cardHolder" placeholder="Full Name on Card" required />
      <button id="submit-payment-btn" data-testid="confirm-pay-button" type="submit">Confirm & Pay $299.00</button>
    </form>
    <section class="grid-layout">
      ${repeatedCards}
    </section>
  </main>
</body>
</html>`;
}

function generateMultiTurnTrajectory(): AgentMessage[] {
  return [
    {
      role: "system",
      content: "You are an autonomous software engineering agent.",
    },
    {
      role: "user",
      content: "Fix the 500 deadlock error in payment settlement and ensure all tests pass.",
    },
    {
      role: "assistant",
      content: "I will search the codebase for ledger_entries and settlement lock handling.",
      tool_calls: [
        {
          id: "call_1",
          function: {
            name: "grep",
            arguments: JSON.stringify({ pattern: "ledger_entries", path: "src/payments" }),
          },
        },
      ],
    },
    {
      role: "tool",
      name: "grep",
      tool_call_id: "call_1",
      content: [
        "src/payments/ledgerRepo.ts:42: UPDATE ledger_entries SET balance = balance + $1 WHERE account_id = $2",
        "src/payments/reconcileJob.ts:89: LOCK TABLE ledger_entries IN ACCESS EXCLUSIVE MODE",
        ...Array.from(
          { length: 35 },
          (_, i) => `src/payments/archive/mock_${i}.ts:12: // historical comment on ledger_entries_${i}`
        ),
      ].join("\n"),
    },
    {
      role: "assistant",
      content: "Found suspicious ACCESS EXCLUSIVE MODE lock in src/payments/reconcileJob.ts. Let me read the file.",
      tool_calls: [
        {
          id: "call_2",
          function: {
            name: "read",
            arguments: JSON.stringify({ path: "src/payments/reconcileJob.ts" }),
          },
        },
      ],
    },
    {
      role: "tool",
      name: "read",
      tool_call_id: "call_2",
      content: `// src/payments/reconcileJob.ts\nexport async function runReconcile(db: any) {\n  // ERROR PITFALL: Using ACCESS EXCLUSIVE blocks concurrent row updates!\n  await db.exec("LOCK TABLE ledger_entries IN ACCESS EXCLUSIVE MODE");\n  return true;\n}\n` + "// padding line\n".repeat(40),
    },
    {
      role: "assistant",
      content: "First attempt: changing lock mode to SHARE UPDATE EXCLUSIVE and running tests.",
      tool_calls: [
        {
          id: "call_3",
          function: {
            name: "shell",
            arguments: JSON.stringify({ command: "pnpm test src/payments/reconcile.spec.ts" }),
          },
        },
      ],
    },
    {
      role: "tool",
      name: "shell",
      tool_call_id: "call_3",
      content:
        "FAIL src/payments/reconcile.spec.ts\nError: deadlock still occurs when batch accounts are unsorted (SQLSTATE 40P01)\n" +
        "  ✓ routine check passed\n".repeat(30),
    },
    {
      role: "assistant",
      content:
        "Root cause identified: accounts must be sorted deterministically by account_id before acquiring row-level FOR UPDATE locks. Applying fix to src/payments/ledgerRepo.ts.",
      tool_calls: [
        {
          id: "call_4",
          function: {
            name: "edit",
            arguments: JSON.stringify({ path: "src/payments/ledgerRepo.ts" }),
          },
        },
      ],
    },
    {
      role: "tool",
      name: "edit",
      tool_call_id: "call_4",
      content: "Updated src/payments/ledgerRepo.ts successfully. All tests passed (PASS 42/42).",
    },
    {
      role: "assistant",
      content: "Now verifying final settlement integration test suite.",
    },
    {
      role: "user",
      content: "Great, now summarize the fix and check if any other files touch ledger_entries.",
    },
  ];
}

export const BENCHMARK_SAMPLES: BenchmarkSample[] = [
  {
    id: "json-k8s-api",
    title: "K8s Cluster 65-Node JSON Telemetry (Anomalous 500 Deadlock)",
    category: "json",
    description:
      "65 microservice health objects where 64 are healthy 200 OK and node #37 has a critical SQLSTATE 40P01 deadlock.",
    rawInput: generateLargeApiJson(),
    mustRetainSubstrings: [
      "dep_prod_37",
      "payment-settlement-worker",
      "SQLSTATE 40P01",
      "_inferredSchema",
      "diet_ref:",
    ],
  },
  {
    id: "log-vitest-crash",
    title: "Vitest 225-Test Verbose CI Log (1 Buried Assertion Failure)",
    category: "log",
    description:
      "Hundreds of passing test lines and ANSI codes wrapping a single TypeError in src/auth/tokenVerifier.ts:148.",
    rawInput: generateNoisyTestLog(),
    mustRetainSubstrings: [
      "src/auth/tokenVerifier.ts:148:23",
      "expClaimSkew",
      "AssertionError",
      "exit code 1",
      "diet_ref:",
    ],
  },
  {
    id: "code-ts-skeleton",
    title: "TypeScript Settlement Service (AST Skeleton + Focus Preservation)",
    category: "code",
    description:
      "Folds utility & CSV formatting functions while preserving all exported interfaces/signatures and the focal executeAtomicSettlement implementation.",
    rawInput: generateLargeTypeScriptFile(),
    mustRetainSubstrings: [
      "export interface SettlementRequest",
      "export interface SettlementReceipt",
      "export function formatCurrencyDisplay",
      "export async function executeAtomicSettlement",
      "INVALID_AMOUNT",
      "diet_ref:",
    ],
  },
  {
    id: "dom-enterprise-checkout",
    title: "Browser Agent DOM Snapshot (SVG + Base64 + Tailwind Pruning)",
    category: "dom",
    description:
      "Heavy HTML page with inline SVGs, base64 images, and analytics scripts. Preserves form inputs and data-testid selectors.",
    rawInput: generateHeavyDomHtml(),
    mustRetainSubstrings: [
      "id=\"payment-form\"",
      "id=\"card-holder-input\"",
      "data-testid=\"confirm-pay-button\"",
      "Confirm & Pay $299.00",
      "diet_ref:",
    ],
  },
  {
    id: "episodic-agent-trajectory",
    title: "12-Turn Debugging Trajectory (Episodic Memory Folding)",
    category: "episodic",
    description:
      "Folds intermediate grep/read/failed-test turns into an <EpisodicMemoryFrame> with Pitfalls & FilesTouched.",
    rawInput: JSON.stringify(generateMultiTurnTrajectory(), null, 2),
    trajectoryMessages: generateMultiTurnTrajectory(),
    mustRetainSubstrings: [
      "<EpisodicMemoryFrame",
      "src/payments/ledgerRepo.ts",
      "src/payments/reconcileJob.ts",
      "SQLSTATE 40P01",
      "diet_ref:",
    ],
  },
];
