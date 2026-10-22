export function getDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ContextDiet — AI Agent Context Engineering Gateway & Persistent SQLite Vault</title>
  <style>
    :root {
      --bg-base: #070a12;
      --bg-panel: #0e1422;
      --bg-card: #131b2e;
      --bg-code: #090d16;
      --border: #1e293b;
      --border-glow: #38bdf844;
      --text-main: #f1f5f9;
      --text-muted: #94a3b8;
      --accent-cyan: #38bdf8;
      --accent-emerald: #10b981;
      --accent-violet: #8b5cf6;
      --accent-amber: #f59e0b;
      --accent-rose: #f43f5e;
      --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      --font-mono: 'JetBrains Mono', 'Fira Code', Consolas, monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: radial-gradient(circle at 15% 0%, #111c35 0%, var(--bg-base) 55%);
      color: var(--text-main);
      font-family: var(--font-sans);
      min-height: 100vh;
      line-height: 1.5;
    }
    .container {
      max-width: 1420px;
      margin: 0 auto;
      padding: 20px 28px 48px;
    }
    .navbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 22px;
      background: rgba(14, 20, 34, 0.85);
      backdrop-filter: blur(12px);
      border: 1px solid var(--border);
      border-radius: 14px;
      margin-bottom: 22px;
      box-shadow: 0 10px 30px -10px rgba(0,0,0,0.5);
    }
    .brand { display: flex; align-items: center; gap: 14px; }
    .logo-badge {
      width: 40px; height: 40px; border-radius: 10px;
      background: linear-gradient(135deg, #0ea5e9, #10b981);
      display: flex; align-items: center; justify-content: center;
      font-weight: 800; font-size: 18px; color: #041019;
      box-shadow: 0 0 20px rgba(16, 185, 129, 0.35);
    }
    .brand-title { font-size: 19px; font-weight: 700; letter-spacing: -0.02em; display: flex; align-items: center; gap: 10px; }
    .tag-pill {
      font-size: 11px; font-weight: 600; padding: 2px 9px; border-radius: 999px;
      background: rgba(56, 189, 248, 0.14); color: var(--accent-cyan);
      border: 1px solid rgba(56, 189, 248, 0.3);
    }
    .brand-sub { font-size: 12px; color: var(--text-muted); }
    .nav-actions { display: flex; align-items: center; gap: 10px; }
    .status-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: var(--accent-emerald); box-shadow: 0 0 10px var(--accent-emerald);
      display: inline-block; margin-right: 6px;
    }
    .endpoint-chip {
      font-family: var(--font-mono); font-size: 12px; padding: 6px 12px;
      border-radius: 8px; background: var(--bg-code); border: 1px solid var(--border); color: #cbd5e1;
    }
    .btn {
      cursor: pointer; border: none; border-radius: 9px; padding: 8px 16px;
      font-size: 13px; font-weight: 600; transition: all 0.18s ease;
      display: inline-flex; align-items: center; gap: 7px;
    }
    .btn-primary {
      background: linear-gradient(135deg, #0ea5e9, #10b981); color: #04131a;
      box-shadow: 0 4px 15px rgba(16, 185, 129, 0.28);
    }
    .btn-primary:hover { transform: translateY(-1px); filter: brightness(1.08); }
    .btn-secondary { background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border); }
    .btn-secondary:hover { border-color: var(--accent-cyan); background: #19233b; }

    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 22px; }
    .kpi-card {
      background: var(--bg-panel); border: 1px solid var(--border);
      border-radius: 14px; padding: 18px 20px; position: relative; overflow: hidden;
    }
    .kpi-card::after {
      content: ""; position: absolute; top: 0; left: 0; right: 0; height: 2px;
      background: linear-gradient(90deg, var(--accent-cyan), var(--accent-emerald)); opacity: 0.7;
    }
    .kpi-label {
      font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em;
      color: var(--text-muted); margin-bottom: 8px; display: flex; justify-content: space-between;
    }
    .kpi-value { font-size: 28px; font-weight: 800; font-family: var(--font-mono); letter-spacing: -0.03em; }
    .kpi-sub { font-size: 12px; color: var(--text-muted); margin-top: 6px; }
    .text-emerald { color: var(--accent-emerald); }
    .text-cyan { color: var(--accent-cyan); }
    .text-violet { color: var(--accent-violet); }
    .text-amber { color: var(--accent-amber); }

    .tabs-bar { display: flex; gap: 8px; margin-bottom: 16px; border-bottom: 1px solid var(--border); padding-bottom: 12px; }
    .tab-btn {
      padding: 9px 18px; border-radius: 9px; font-size: 13px; font-weight: 600;
      background: transparent; color: var(--text-muted); border: 1px solid transparent; cursor: pointer;
    }
    .tab-btn.active {
      background: rgba(56, 189, 248, 0.13); color: var(--accent-cyan); border-color: rgba(56, 189, 248, 0.35);
    }
    .tab-pane { display: none; }
    .tab-pane.active { display: block; }

    .control-strip {
      display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
      gap: 12px; background: var(--bg-panel); border: 1px solid var(--border);
      border-radius: 12px; padding: 14px 18px; margin-bottom: 16px;
    }
    .preset-group { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .preset-btn {
      font-size: 12px; padding: 6px 12px; border-radius: 8px;
      background: var(--bg-card); color: #cbd5e1; border: 1px solid var(--border); cursor: pointer;
    }
    .preset-btn:hover, .preset-btn.active {
      border-color: var(--accent-emerald); color: #fff; background: rgba(16, 185, 129, 0.15);
    }
    .options-group { display: flex; align-items: center; gap: 10px; }
    select, input[type="text"] {
      background: var(--bg-code); color: var(--text-main); border: 1px solid var(--border);
      border-radius: 8px; padding: 7px 11px; font-size: 12px;
    }
    .workbench-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; }
    .editor-panel {
      background: var(--bg-panel); border: 1px solid var(--border);
      border-radius: 14px; display: flex; flex-direction: column; overflow: hidden;
    }
    .panel-header {
      padding: 12px 16px; background: rgba(19, 27, 46, 0.9); border-bottom: 1px solid var(--border);
      display: flex; align-items: center; justify-content: space-between; font-size: 13px; font-weight: 600;
    }
    .badge-metric {
      font-family: var(--font-mono); font-size: 11px; padding: 3px 9px;
      border-radius: 6px; background: var(--bg-code); border: 1px solid var(--border);
    }
    textarea.code-area {
      width: 100%; height: 430px; background: var(--bg-code); color: #e2e8f0;
      border: none; padding: 14px 16px; font-family: var(--font-mono); font-size: 12.5px;
      line-height: 1.55; resize: vertical; outline: none;
    }
    .vault-bar {
      padding: 10px 16px; background: rgba(9, 13, 22, 0.85); border-top: 1px solid var(--border);
      display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-height: 44px;
    }
    .ref-pill {
      font-family: var(--font-mono); font-size: 11px; padding: 3px 9px; border-radius: 6px;
      background: rgba(139, 92, 246, 0.16); color: #c4b5fd; border: 1px solid rgba(139, 92, 246, 0.4); cursor: pointer;
    }
    .ref-pill:hover { background: rgba(139, 92, 246, 0.32); color: #fff; }
    .data-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .data-table th, .data-table td { padding: 12px 14px; text-align: left; border-bottom: 1px solid var(--border); }
    .data-table th {
      color: var(--text-muted); font-weight: 600; font-size: 11.5px;
      text-transform: uppercase; background: rgba(19, 27, 46, 0.6);
    }
    .mono { font-family: var(--font-mono); }
    .modal-backdrop {
      position: fixed; inset: 0; background: rgba(3, 6, 12, 0.78); backdrop-filter: blur(6px);
      display: none; align-items: center; justify-content: center; z-index: 999; padding: 24px;
    }
    .modal-backdrop.open { display: flex; }
    .modal-box {
      background: var(--bg-panel); border: 1px solid var(--accent-violet);
      border-radius: 14px; width: 100%; max-width: 820px; overflow: hidden;
    }
    .modal-header {
      padding: 14px 20px; background: var(--bg-card); border-bottom: 1px solid var(--border);
      display: flex; justify-content: space-between; align-items: center;
    }
    .modal-body {
      padding: 18px 20px; max-height: 65vh; overflow-y: auto; font-family: var(--font-mono);
      font-size: 12.5px; white-space: pre-wrap; background: var(--bg-code); color: #a7f3d0;
    }
  </style>
</head>
<body>
  <div class="container">
    <header class="navbar">
      <div class="brand">
        <div class="logo-badge">CD</div>
        <div>
          <div class="brand-title">
            ContextDiet
            <span class="tag-pill">v0.2.0 · Streaming Proxy + SQLite WAL Vault + MCP</span>
          </div>
          <div class="brand-sub">
            Streaming OpenAI (/v1/chat/completions, /v1/responses) & Anthropic (/v1/messages) Proxy · Persistent SQLite Vault
          </div>
        </div>
      </div>
      <div class="nav-actions">
        <span class="endpoint-chip"><span class="status-dot"></span>SSE Streaming Ready</span>
        <span class="endpoint-chip">SQLite Vault: .context-diet/vault.sqlite</span>
        <button class="btn btn-secondary" onclick="runFullBenchmark()">⚡ Run Benchmark Suite</button>
      </div>
    </header>

    <section class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">
          <span>Net Tokens Saved</span>
          <span>After Expansion Overhead</span>
        </div>
        <div class="kpi-value text-emerald" id="kpi-saved-tokens">0</div>
        <div class="kpi-sub" id="kpi-token-breakdown">Gross Saved: 0 | Expand Overhead: 0</div>
      </div>

      <div class="kpi-card">
        <div class="kpi-label">
          <span>Net Compression Ratio</span>
          <span>Gross vs. Net</span>
        </div>
        <div class="kpi-value text-cyan" id="kpi-ratio">0.0%</div>
        <div class="kpi-sub" id="kpi-latency">Avg pipeline latency: 0.0 ms</div>
      </div>

      <div class="kpi-card">
        <div class="kpi-label">
          <span>SQLite Vault Slices</span>
          <span>Cross-Process WAL</span>
        </div>
        <div class="kpi-value text-violet" id="kpi-vault-count">0</div>
        <div class="kpi-sub" id="kpi-vault-expansions">Restored 0 times via diet_expand_frame</div>
      </div>

      <div class="kpi-card">
        <div class="kpi-label">
          <span>Context Rot Risk & Net ROI</span>
          <span>Heuristic BPE Est.</span>
        </div>
        <div class="kpi-value text-amber" id="kpi-rot-level">LOW (12/100)</div>
        <div class="kpi-sub" id="kpi-usd-saved">Est. Saved/1k runs: $0.00 (Sonnet)</div>
      </div>
    </section>

    <div class="tabs-bar">
      <button class="tab-btn active" onclick="switchTab('playground', this)">🔬 Interactive Context Compressor & Memory Folder</button>
      <button class="tab-btn" onclick="switchTab('benchmark', this)">📊 Gross vs. Net Savings Benchmark</button>
      <button class="tab-btn" onclick="switchTab('audit', this)">🛰️ Live Proxy & MCP Telemetry Log</button>
      <button class="tab-btn" onclick="switchTab('integration', this)">🔌 Codex CLI / Claude Code / OpenCode Setup</button>
    </div>

    <div id="tab-playground" class="tab-pane active">
      <div class="control-strip">
        <div class="preset-group">
          <span style="font-size:12px;color:var(--text-muted);font-weight:600;">Sample Scenario:</span>
          <button class="preset-btn active" onclick="loadSample('json-k8s-api', this)">1. K8s 65-Node JSON (500 Deadlock)</button>
          <button class="preset-btn" onclick="loadSample('log-vitest-crash', this)">2. Vitest 225-Test Log (Buried Failure)</button>
          <button class="preset-btn" onclick="loadSample('code-ts-skeleton', this)">3. TypeScript AST Skeleton</button>
          <button class="preset-btn" onclick="loadSample('dom-enterprise-checkout', this)">4. Browser DOM Pruning</button>
          <button class="preset-btn" onclick="loadSample('episodic-agent-trajectory', this)">5. 12-Turn Episodic Trajectory Folding</button>
        </div>

        <div class="options-group">
          <select id="select-aggressiveness" title="Aggressiveness Mode">
            <option value="balanced" selected>Mode: Balanced (Recommended)</option>
            <option value="conservative">Mode: Conservative</option>
            <option value="aggressive">Mode: Aggressive</option>
          </select>
          <input type="text" id="input-focus-kw" placeholder="Focus symbol (e.g. executeAtomicSettlement)" style="width:230px;" />
          <button class="btn btn-primary" onclick="executePlaygroundCompression()">🚀 Compress / Fold Context</button>
        </div>
      </div>

      <div class="workbench-grid">
        <div class="editor-panel">
          <div class="panel-header">
            <span>📥 Raw Agent Tool Output / Trajectory</span>
            <span class="badge-metric" id="raw-metrics-badge">0 tokens · 0 chars</span>
          </div>
          <textarea id="raw-input-area" class="code-area" spellcheck="false"></textarea>
          <div class="vault-bar">
            <span style="font-size:12px;color:var(--text-muted);" id="sample-desc-text">Select a preset above or paste any noisy JSON, terminal log, code, or agent trajectory.</span>
          </div>
        </div>

        <div class="editor-panel">
          <div class="panel-header">
            <span>✨ ContextDiet Output (Sent to LLM)</span>
            <span class="badge-metric text-emerald" id="diet-metrics-badge">0 tokens (-0%) · 0 ms</span>
          </div>
          <textarea id="diet-output-area" class="code-area" spellcheck="false" readonly></textarea>
          <div class="vault-bar" id="vault-refs-container">
            <span style="font-size:12px;color:var(--text-muted);">SQLite Vault Refs (<code class="mono">diet_expand_frame</code>): none</span>
          </div>
        </div>
      </div>
    </div>

    <div id="tab-benchmark" class="tab-pane">
      <div class="editor-panel" style="padding: 20px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <div>
            <h3 style="font-size:16px;">Multi-Modality Compression: Gross vs. Net Savings (with 20% Vault Expansion Overhead)</h3>
            <p style="font-size:12.5px;color:var(--text-muted);">Evaluates single-turn payload reduction alongside net token savings when an agent expands 20% of folded blocks via <code class="mono">diet_expand_frame</code>.</p>
          </div>
          <button class="btn btn-primary" onclick="runFullBenchmark()">🔄 Re-Run Benchmark Suite</button>
        </div>
        <table class="data-table">
          <thead>
            <tr>
              <th>Benchmark Scenario</th>
              <th>Modality</th>
              <th>Raw Tokens (Est.)</th>
              <th>Diet Tokens</th>
              <th>Gross Reduction</th>
              <th>Net Savings (w/ 20% Expand)</th>
              <th>Target String Recall</th>
              <th>Latency</th>
            </tr>
          </thead>
          <tbody id="benchmark-tbody">
            <tr><td colspan="8" style="color:var(--text-muted);">Loading benchmark results...</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div id="tab-audit" class="tab-pane">
      <div class="editor-panel" style="padding: 20px;">
        <h3 style="font-size:16px;margin-bottom:12px;">Live SQLite Audit Stream (Proxy & MCP Server)</h3>
        <table class="data-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Source</th>
              <th>Modality</th>
              <th>Raw → Diet Tokens</th>
              <th>Reduction</th>
              <th>Latency</th>
              <th>SQLite Vault Refs</th>
              <th>Summary</th>
            </tr>
          </thead>
          <tbody id="audit-tbody"></tbody>
        </table>
      </div>
    </div>

    <div id="tab-integration" class="tab-pane">
      <div class="workbench-grid">
        <div class="editor-panel" style="padding: 20px;">
          <h3 style="font-size:15px;margin-bottom:10px;color:var(--accent-cyan);">1. Connect via MCP Server (Codex CLI / Claude Code / OpenCode)</h3>
          <p style="font-size:12.5px;color:var(--text-muted);margin-bottom:12px;">Shares the same SQLite WAL database (<code class="mono">.context-diet/vault.sqlite</code>) across processes:</p>
          <pre class="code-area" style="height:260px;border-radius:10px;">{
  "mcpServers": {
    "context-diet": {
      "command": "node",
      "args": [
        "--experimental-strip-types",
        "src/cli.ts",
        "mcp"
      ]
    }
  }
}</pre>
        </div>
        <div class="editor-panel" style="padding: 20px;">
          <h3 style="font-size:15px;margin-bottom:10px;color:var(--accent-emerald);">2. Connect via Streaming Proxy (OpenAI & Anthropic)</h3>
          <p style="font-size:12.5px;color:var(--text-muted);margin-bottom:12px;">Supports full SSE streaming (<code class="mono">stream: true</code>) on <code class="mono">/v1/chat/completions</code>, <code class="mono">/v1/responses</code>, and <code class="mono">/v1/messages</code>:</p>
          <pre class="code-area" style="height:260px;border-radius:10px;"># For OpenAI Codex CLI / OpenAI SDK:
export OPENAI_BASE_URL="http://127.0.0.1:4310/v1"
export OPENAI_API_KEY="sk-..."

# For Claude Code / Anthropic SDK:
export ANTHROPIC_BASE_URL="http://127.0.0.1:4310"
export ANTHROPIC_API_KEY="sk-ant-..."</pre>
        </div>
      </div>
    </div>
  </div>

  <div id="vault-modal" class="modal-backdrop" onclick="if(event.target===this) closeVaultModal()">
    <div class="modal-box">
      <div class="modal-header">
        <div>
          <strong id="modal-ref-title" class="mono text-cyan">diet_ref:...</strong>
          <span id="modal-ref-meta" style="font-size:12px;color:var(--text-muted);margin-left:10px;"></span>
        </div>
        <button class="btn btn-secondary" onclick="closeVaultModal()">✕ Close</button>
      </div>
      <div class="modal-body" id="modal-ref-content"></div>
    </div>
  </div>

  <script>
    let samplesCache = [];
    let currentSampleId = 'json-k8s-api';

    function switchTab(tabId, btnEl) {
      document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
      document.getElementById('tab-' + tabId).classList.add('active');
      if (btnEl) btnEl.classList.add('active');
    }

    async function fetchTelemetry() {
      const res = await fetch('/api/telemetry');
      const data = await res.json();
      const t = data.telemetry;
      const rot = data.contextRotRisk;

      document.getElementById('kpi-saved-tokens').textContent = t.netSavedTokens.toLocaleString();
      document.getElementById('kpi-token-breakdown').textContent =
        'Gross: ' + t.grossSavedTokens.toLocaleString() + ' | Expand Overhead: ' + t.expansionOverheadTokens.toLocaleString();
      document.getElementById('kpi-ratio').textContent = '-' + t.netCompressionRatioPct + '% (Net)';
      document.getElementById('kpi-latency').textContent =
        'Gross: -' + t.avgCompressionRatioPct + '% · Avg latency: ' + t.avgLatencyMs + ' ms';
      document.getElementById('kpi-vault-count').textContent = t.vaultEntriesCount.toLocaleString();
      document.getElementById('kpi-vault-expansions').textContent =
        'Expanded ' + t.totalExpansionsCount + ' times (persisted in SQLite)';
      document.getElementById('kpi-rot-level').textContent = rot.level + ' (' + rot.score + '/100)';
      document.getElementById('kpi-usd-saved').textContent =
        'Net Est./1k runs: $' + (t.totalSavedUsdSonnet * 1000).toFixed(2) + ' (Sonnet)';

      const tbody = document.getElementById('audit-tbody');
      tbody.innerHTML = t.recentAudits.map(a => \`
        <tr>
          <td class="mono" style="font-size:11.5px;color:var(--text-muted);">\${new Date(a.timestamp).toLocaleTimeString()}</td>
          <td><span class="tag-pill">\${a.source}</span></td>
          <td class="mono">\${a.contentType.toUpperCase()}</td>
          <td class="mono">\${a.originalTokens.toLocaleString()} → <strong>\${a.compressedTokens.toLocaleString()}</strong></td>
          <td class="mono text-emerald"><strong>-\${a.compressionRatioPct}%</strong></td>
          <td class="mono">\${a.latencyMs} ms</td>
          <td>\${(a.refIds || []).map(r => \`<span class="ref-pill" onclick="inspectVaultRef('\${r}')">\${r}</span>\`).join(' ')}</td>
          <td style="font-size:12px;color:#cbd5e1;">\${a.summary}</td>
        </tr>
      \`).join('');
    }

    async function loadSamplesList() {
      const res = await fetch('/api/samples');
      const data = await res.json();
      samplesCache = data.samples || [];
      loadSample('json-k8s-api', document.querySelector('.preset-btn'));
    }

    function loadSample(sampleId, btnEl) {
      currentSampleId = sampleId;
      if (btnEl) {
        document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
        btnEl.classList.add('active');
      }
      const found = samplesCache.find(s => s.id === sampleId);
      if (!found) return;

      document.getElementById('raw-input-area').value = found.rawInput;
      document.getElementById('sample-desc-text').textContent = found.description;
      if (sampleId === 'code-ts-skeleton') {
        document.getElementById('input-focus-kw').value = 'executeAtomicSettlement';
      } else {
        document.getElementById('input-focus-kw').value = '';
      }
      executePlaygroundCompression();
    }

    async function executePlaygroundCompression() {
      const rawText = document.getElementById('raw-input-area').value;
      const aggressiveness = document.getElementById('select-aggressiveness').value;
      const focusKw = document.getElementById('input-focus-kw').value.trim();
      const isTrajectory = currentSampleId === 'episodic-agent-trajectory';

      const res = await fetch('/api/compress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: rawText,
          aggressiveness,
          mode: isTrajectory ? 'episodic' : 'auto',
          focusKeywords: focusKw ? [focusKw] : []
        })
      });
      const result = await res.json();

      document.getElementById('raw-metrics-badge').textContent =
        result.originalTokens.toLocaleString() + ' tokens · ' + rawText.length.toLocaleString() + ' chars';
      document.getElementById('diet-metrics-badge').textContent =
        result.compressedTokens.toLocaleString() + ' tokens (-' + result.compressionRatioPct + '%) · ' + result.latencyMs + ' ms';
      document.getElementById('diet-output-area').value = result.compressedText;

      const refsContainer = document.getElementById('vault-refs-container');
      const refs = result.refIds || [];
      if (refs.length > 0) {
        refsContainer.innerHTML = '<span style="font-size:12px;color:var(--text-muted);">SQLite Vault Refs (click to restore):</span> ' +
          refs.map(r => \`<span class="ref-pill" onclick="inspectVaultRef('\${r}')">🔓 \${r}</span>\`).join(' ');
      } else {
        refsContainer.innerHTML = '<span style="font-size:12px;color:var(--text-muted);">No folded slices needed.</span>';
      }

      fetchTelemetry();
    }

    async function inspectVaultRef(refId) {
      const res = await fetch('/api/vault/' + encodeURIComponent(refId));
      if (!res.ok) return;
      const entry = await res.json();
      document.getElementById('modal-ref-title').textContent = entry.refId;
      document.getElementById('modal-ref-meta').textContent =
        entry.label + ' · Original: ' + entry.originalTokens + ' tokens · Expanded ' + entry.expandCount + 'x';
      document.getElementById('modal-ref-content').textContent = entry.originalContent;
      document.getElementById('vault-modal').classList.add('open');
    }

    function closeVaultModal() {
      document.getElementById('vault-modal').classList.remove('open');
    }

    async function runFullBenchmark() {
      const res = await fetch('/api/benchmark', { method: 'POST' });
      const bench = await res.json();
      const tbody = document.getElementById('benchmark-tbody');
      tbody.innerHTML = bench.results.map(r => \`
        <tr>
          <td><strong>\${r.title}</strong></td>
          <td><span class="tag-pill mono">\${r.category}</span></td>
          <td class="mono">\${r.originalTokens.toLocaleString()}</td>
          <td class="mono"><strong>\${r.compressedTokens.toLocaleString()}</strong></td>
          <td class="mono">-\${r.grossCompressionPct}%</td>
          <td class="mono text-emerald"><strong>-\${r.netCompressionPct}%</strong></td>
          <td class="mono text-cyan"><strong>\${r.retentionRecallPct}% (\${r.retainedCount}/\${r.totalMustRetain})</strong></td>
          <td class="mono">\${r.latencyMs} ms</td>
        </tr>
      \`).join('') + \`
        <tr style="background:rgba(16,185,129,0.08);font-weight:700;">
          <td>TOTAL / AVERAGE</td>
          <td>ALL 5 MODALITIES</td>
          <td class="mono">\${bench.totalOriginalTokens.toLocaleString()}</td>
          <td class="mono">\${bench.totalCompressedTokens.toLocaleString()}</td>
          <td class="mono">-\${bench.overallCompressionPct}%</td>
          <td class="mono text-emerald">-\${bench.overallNetCompressionPct}%</td>
          <td class="mono text-cyan">\${bench.overallRetentionRecallPct}%</td>
          <td class="mono">\${bench.averageLatencyMs} ms</td>
        </tr>
      \`;
      fetchTelemetry();
    }

    window.addEventListener('DOMContentLoaded', async () => {
      await loadSamplesList();
      await runFullBenchmark();
    });
  </script>
</body>
</html>`;
}
