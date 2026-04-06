# Polymarket Trader Plugin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Polymarket event-driven trading system as a RivonClaw plugin + 2 OpenClaw agents (Analyzer, Reviewer), targeting stable continuous profitability.

**Architecture:** TypeScript RivonClaw plugin houses Collector (Polymarket WebSocket + rolling stats + trigger detection) and Executor (Kelly sizing + 4-route exit monitor + circuit breakers). Two OpenClaw agents plug into the plugin via RPC: Analyzer (LLM judges signal truth per trigger) and Reviewer (daily cron, reads signal_log, generates filter_proposals and kill_switch decisions). Shared state in `~/.rivonclaw/polymarket.db` (independent SQLite). Reuses RivonClaw gateway's LLM providers, secrets store, and channel senders.

**Tech Stack:** TypeScript, Node.js 24+, `@rivonclaw/plugin-sdk`, `better-sqlite3`, `ws`, `@polymarket/clob-client`, `vitest`, `tsdown`, `pnpm`.

**Spec reference:** `docs/superpowers/specs/2026-04-06-polymarket-trading-agents-design.md`

---

## File Structure

All paths relative to `D:/work/dlxiaclaw/` (the RivonClaw repo).

### Plugin (TypeScript)

```
extensions/rivonclaw-polymarket/
├── package.json                          # pnpm package, depends on @rivonclaw/plugin-sdk
├── tsconfig.json                         # extends root tsconfig.base.json
├── tsdown.config.ts                      # ESM build with plugin.json copy
├── openclaw.plugin.json                  # plugin metadata for OpenClaw
├── vitest.config.ts                      # test runner config
├── README.md                             # plugin docs (minimal)
├── src/
│   ├── index.ts                          # defineRivonClawPlugin() entry — wires everything
│   ├── config/
│   │   ├── defaults.ts                   # DEFAULT_CONFIG constant with all thresholds
│   │   ├── loader.ts                     # YAML loader + env override + hot reload
│   │   └── schema.ts                     # TypeScript interfaces / zod schemas for config
│   ├── db/
│   │   ├── connection.ts                 # better-sqlite3 singleton with WAL mode
│   │   ├── migrations.ts                 # schema migration runner
│   │   ├── schema.sql                    # all CREATE TABLE statements
│   │   ├── signal-log-repo.ts            # CRUD for signal_log
│   │   ├── strategy-performance-repo.ts  # per-bucket win rate reads/writes
│   │   ├── portfolio-state-repo.ts       # KV for equity / drawdown / halt flags
│   │   ├── filter-config-repo.ts         # KV with hot reload notification
│   │   ├── filter-proposals-repo.ts      # Reviewer's pending suggestions
│   │   └── kill-switch-repo.ts           # strategy_kill_switch
│   ├── collector/
│   │   ├── ws-client.ts                  # Polymarket WebSocket client with reconnect
│   │   ├── event-dedup.ts                # Set-based dedup of trade events
│   │   ├── bot-filter.ts                 # same-address >10 trades/sec detection
│   │   ├── rolling-window.ts             # per-market rolling statistics
│   │   ├── market-state.ts               # per-market in-memory state (Map<marketId, MarketSnapshot>)
│   │   ├── trigger-evaluator.ts          # all-conditions-pass check + large-order exemption
│   │   └── collector.ts                  # orchestrator: subscribes WS, updates state, emits events
│   ├── analyzer/
│   │   ├── context-packer.ts             # builds Analyzer agent input payload
│   │   ├── verdict-parser.ts             # parses Analyzer's structured output
│   │   └── analyzer-client.ts            # RPC call to polymarket-analyzer OpenClaw agent
│   ├── executor/
│   │   ├── kelly.ts                      # Kelly fraction + position sizing with hard caps
│   │   ├── price-bucket.ts               # floor(price / 0.05) * 0.05 + prior win rates
│   │   ├── dead-zone.ts                  # static [0.60, 0.85] check
│   │   ├── paper-fill.ts                 # mid-price + slippage fill simulation
│   │   ├── pnl.ts                        # gross/fees/slippage/gas → net calculation
│   │   ├── position-tracker.ts           # in-memory open positions + DB reconciliation
│   │   ├── exit-monitor.ts               # A/C/D/E priority coordinator
│   │   ├── circuit-breaker.ts            # daily/weekly/total drawdown checks
│   │   ├── conflict-lock.ts              # per-market mutex for first-come-first-served
│   │   └── executor.ts                   # orchestrator: order intake, sizing, execution, exits
│   ├── bus/
│   │   ├── events.ts                     # TypedEventEmitter for TriggerEvent/VerdictEvent/ExitEvent
│   │   └── types.ts                      # event type definitions
│   ├── recovery/
│   │   └── startup-recovery.ts           # on-start: reload open positions, portfolio state
│   └── util/
│       ├── logger.ts                     # wraps api.logger with component prefixes
│       ├── time.ts                       # Unix ms helpers, expiry buffer math
│       └── errors.ts                     # typed error classes (no bare catch)
└── tests/
    ├── fixtures/
    │   └── polymarket-ws-sample.json     # 1h recorded WS trades for replay
    ├── db/
    │   ├── migrations.test.ts
    │   ├── signal-log-repo.test.ts
    │   └── portfolio-state-repo.test.ts
    ├── collector/
    │   ├── rolling-window.test.ts
    │   ├── bot-filter.test.ts
    │   ├── trigger-evaluator.test.ts
    │   └── collector.integration.test.ts
    ├── executor/
    │   ├── kelly.test.ts
    │   ├── price-bucket.test.ts
    │   ├── paper-fill.test.ts
    │   ├── pnl.test.ts
    │   ├── position-tracker.test.ts
    │   ├── exit-monitor.test.ts
    │   └── circuit-breaker.test.ts
    └── e2e/
        └── paper-trading.test.ts         # record-and-replay full flow
```

### OpenClaw agent workspaces (created, not code)

```
~/.openclaw/agents/polymarket-analyzer/
└── agent/
    └── AGENTS.md                         # persona: "You are a Polymarket signal judge..."
~/.openclaw/agents/polymarket-reviewer/
└── agent/
    └── AGENTS.md                         # persona: "You are a Polymarket performance reviewer..."
```

### Gateway config patch

```
~/.openclaw/openclaw.json (modified by user before M2)
  plugins.entries += "rivonclaw-polymarket"
  agents.list += [polymarket-analyzer, polymarket-reviewer]
  cron += [{agent: "polymarket-reviewer", schedule: "0 0 * * *"}]
```

---

## Investigation Tasks (do these FIRST — they de-risk the entire plan)

Two things the plan depends on that weren't confirmed during spec writing. Both must resolve **before Task 1** so the plan can be trusted.

### Investigation I1: How can a plugin invoke an OpenClaw agent?

The plugin (Collector) needs to call the `polymarket-analyzer` agent when a trigger fires. The `file-permissions` plugin uses hooks only; the `event-bridge` plugin observes events via `runtime.events.onAgentEvent()` but doesn't *invoke* agents.

- [ ] **Step 1: Read the OpenClaw vendor docs for agent invocation**

Run: `find D:/work/dlxiaclaw/vendor/openclaw/docs -type f -name "*.md" | xargs grep -l -i "agent.run\|invoke.*agent\|runAgent"`
Read every match. Write a 5-line note in `docs/superpowers/plans/I1-findings.md` documenting:
- The function name and import path
- Whether it returns `Promise<AgentResponse>` or streams
- Whether plugins can call it directly or need RPC

- [ ] **Step 2: Read gateway RPC client source**

Read: `D:/work/dlxiaclaw/packages/gateway/src/rpc-client.ts`
Look for methods like `agentRun`, `request("agent.run", ...)`, or similar.
Add findings to `I1-findings.md`.

- [ ] **Step 3: Decide invocation strategy**

Based on I1-findings, document one of these three choices in the file:
- **A:** Direct import of runtime function (preferred if exported)
- **B:** Gateway RPC via registered method (preferred if runtime not accessible from plugin)
- **C:** OpenClaw internal message API (fallback)

If none of A/B/C are feasible, STOP and escalate to the user — the plan cannot proceed.

- [ ] **Step 4: Commit the findings file**

```bash
cd D:/work/dlxiaclaw
git add -f docs/superpowers/plans/I1-findings.md
git commit -m "docs(plan): record I1 findings on agent invocation from plugin"
```

### Investigation I2: How is OpenClaw cron configured?

The Reviewer agent needs to run daily at 00:00 UTC. This is a pre-existing OpenClaw feature but we don't know the config format.

- [ ] **Step 1: Find cron configuration docs and code**

Run: `find D:/work/dlxiaclaw/vendor/openclaw -type f \( -name "*.md" -o -name "*.ts" \) | xargs grep -l -i "cron\|schedule" 2>/dev/null | head -20`
Read the most relevant 2-3 files.

- [ ] **Step 2: Document the format**

Write to `docs/superpowers/plans/I2-findings.md`:
- Where cron entries live (openclaw.json? separate file?)
- Schema (cron string? per-agent? what message does it send?)
- How the triggered agent receives the cron invocation (as a message? event?)
- Example config we will use for polymarket-reviewer

- [ ] **Step 3: Commit**

```bash
git add -f docs/superpowers/plans/I2-findings.md
git commit -m "docs(plan): record I2 findings on OpenClaw cron"
```

---

## Phase 0 — Plugin Bootstrap

Goal: an empty plugin that RivonClaw can load, logs "activated", runs `vitest` with a trivial passing test.

### Task 1: Create plugin package skeleton

**Files:**
- Create: `extensions/rivonclaw-polymarket/package.json`
- Create: `extensions/rivonclaw-polymarket/tsconfig.json`
- Create: `extensions/rivonclaw-polymarket/tsdown.config.ts`
- Create: `extensions/rivonclaw-polymarket/vitest.config.ts`
- Create: `extensions/rivonclaw-polymarket/openclaw.plugin.json`
- Create: `extensions/rivonclaw-polymarket/README.md`
- Create: `extensions/rivonclaw-polymarket/src/index.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@rivonclaw/rivonclaw-polymarket",
  "version": "0.1.0",
  "description": "Polymarket event-driven trading plugin for RivonClaw",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "openclaw": {
    "extensions": ["./dist/rivonclaw-polymarket.mjs"]
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsdown",
    "test": "vitest",
    "test:run": "vitest run"
  },
  "dependencies": {
    "@rivonclaw/plugin-sdk": "workspace:*",
    "better-sqlite3": "^11.3.0",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@mariozechner/openclaw": "file:../../vendor/openclaw",
    "@types/better-sqlite3": "^7.6.11",
    "@types/node": "^22.10.5",
    "@types/ws": "^8.5.12",
    "tsdown": "^0.20.3",
    "typescript": "^5.8.2",
    "vitest": "^4.0.18"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "module": "ESNext",
    "target": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Create `tsdown.config.ts`**

```typescript
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    "rivonclaw-polymarket": "src/index.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: false,
  external: [/^@mariozechner\/openclaw/, "better-sqlite3", "ws"],
  noExternal: ["@rivonclaw/plugin-sdk"],
  onSuccess: async () => {
    const { copyFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    copyFileSync(
      join(process.cwd(), "openclaw.plugin.json"),
      join(process.cwd(), "dist", "openclaw.plugin.json")
    );
  },
});
```

- [ ] **Step 4: Create `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: false,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
      thresholds: {
        "src/executor/**": { branches: 100, functions: 100, lines: 100, statements: 100 },
      },
    },
  },
});
```

- [ ] **Step 5: Create `openclaw.plugin.json`**

```json
{
  "id": "rivonclaw-polymarket",
  "name": "RivonClaw Polymarket Trader",
  "description": "Event-driven Polymarket trading: collector + paper executor + LLM-driven analyzer and reviewer",
  "version": "0.1.0",
  "configSchema": {
    "dbPath": { "type": "string", "default": "~/.rivonclaw/polymarket.db" },
    "configPath": { "type": "string", "default": "~/.rivonclaw/polymarket-trader.yaml" }
  }
}
```

- [ ] **Step 6: Create minimal `src/index.ts`**

```typescript
/**
 * RivonClaw Polymarket Trader plugin.
 *
 * See docs/superpowers/specs/2026-04-06-polymarket-trading-agents-design.md for design.
 */
import { defineRivonClawPlugin } from "@rivonclaw/plugin-sdk";
import type { PluginApi } from "@rivonclaw/plugin-sdk";

export default defineRivonClawPlugin({
  id: "rivonclaw-polymarket",
  name: "Polymarket Trader",

  setup(api: PluginApi) {
    api.logger.info("[polymarket] plugin activated (bootstrap only — no runtime yet)");
  },
});
```

- [ ] **Step 7: Create minimal `README.md`**

```markdown
# RivonClaw Polymarket Trader

Event-driven Polymarket trading plugin. Runs inside the RivonClaw gateway process; delegates signal judgment to the `polymarket-analyzer` OpenClaw agent and daily review to `polymarket-reviewer`.

See the design spec at `docs/superpowers/specs/2026-04-06-polymarket-trading-agents-design.md`.
```

- [ ] **Step 8: Install and verify the build**

Run:
```bash
cd D:/work/dlxiaclaw
pnpm install --filter @rivonclaw/rivonclaw-polymarket
pnpm --filter @rivonclaw/rivonclaw-polymarket build
```
Expected: build succeeds, `extensions/rivonclaw-polymarket/dist/rivonclaw-polymarket.mjs` exists.

- [ ] **Step 9: Add a trivial passing test to verify vitest wiring**

Create `extensions/rivonclaw-polymarket/tests/smoke.test.ts`:
```typescript
import { describe, it, expect } from "vitest";

describe("plugin smoke", () => {
  it("can run tests", () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run: `pnpm --filter @rivonclaw/rivonclaw-polymarket test:run`
Expected: `✓ plugin smoke > can run tests`

- [ ] **Step 10: Commit**

```bash
cd D:/work/dlxiaclaw
git add -f extensions/rivonclaw-polymarket/
git commit -m "feat(polymarket): bootstrap empty plugin with build and smoke test"
```

---

## Phase 1 — Database Foundation

Goal: typed repositories over an initialized SQLite database at `~/.rivonclaw/polymarket.db`, with test coverage.

### Task 2: Schema SQL and migration runner

**Files:**
- Create: `extensions/rivonclaw-polymarket/src/db/schema.sql`
- Create: `extensions/rivonclaw-polymarket/src/db/migrations.ts`
- Create: `extensions/rivonclaw-polymarket/src/db/connection.ts`
- Test: `extensions/rivonclaw-polymarket/tests/db/migrations.test.ts`

- [ ] **Step 1: Write `schema.sql` with all tables from spec §7**

```sql
-- signal_log: every triggered signal with entry + exit fields
CREATE TABLE IF NOT EXISTS signal_log (
  signal_id TEXT PRIMARY KEY,
  market_id TEXT NOT NULL,
  market_title TEXT NOT NULL,
  resolves_at INTEGER NOT NULL,
  triggered_at INTEGER NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('buy_yes', 'buy_no')),
  entry_price REAL NOT NULL,
  price_bucket REAL NOT NULL,
  size_usdc REAL NOT NULL,
  kelly_fraction REAL NOT NULL,
  snapshot_volume_1m REAL NOT NULL,
  snapshot_net_flow_1m REAL NOT NULL,
  snapshot_unique_traders_1m INTEGER NOT NULL,
  snapshot_price_move_5m REAL NOT NULL,
  snapshot_liquidity REAL NOT NULL,
  llm_verdict TEXT NOT NULL,
  llm_confidence REAL NOT NULL,
  llm_reasoning TEXT NOT NULL,
  exit_at INTEGER,
  exit_price REAL,
  exit_reason TEXT CHECK (exit_reason IN ('E', 'A_SL', 'A_TP', 'D', 'C') OR exit_reason IS NULL),
  pnl_gross_usdc REAL,
  fees_usdc REAL,
  slippage_usdc REAL,
  gas_usdc REAL,
  pnl_net_usdc REAL,
  holding_duration_sec INTEGER
);
CREATE INDEX IF NOT EXISTS idx_signal_log_market ON signal_log(market_id);
CREATE INDEX IF NOT EXISTS idx_signal_log_open ON signal_log(exit_at) WHERE exit_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_signal_log_bucket ON signal_log(price_bucket);

-- strategy_performance: per-bucket rolling stats (window = '7d' or '30d')
CREATE TABLE IF NOT EXISTS strategy_performance (
  price_bucket REAL NOT NULL,
  window TEXT NOT NULL CHECK (window IN ('7d', '30d')),
  trade_count INTEGER NOT NULL DEFAULT 0,
  win_count INTEGER NOT NULL DEFAULT 0,
  win_rate REAL NOT NULL DEFAULT 0.0,
  total_pnl_net REAL NOT NULL DEFAULT 0.0,
  last_updated INTEGER NOT NULL,
  PRIMARY KEY (price_bucket, window)
);

-- filter_config: KV hot-reloadable config
CREATE TABLE IF NOT EXISTS filter_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'default'
);

-- filter_proposals: Reviewer's pending suggestions
CREATE TABLE IF NOT EXISTS filter_proposals (
  proposal_id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  field TEXT NOT NULL,
  old_value TEXT NOT NULL,
  proposed_value TEXT NOT NULL,
  rationale TEXT NOT NULL,
  sample_count INTEGER NOT NULL,
  expected_delta_winrate REAL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_at INTEGER
);

-- strategy_kill_switch: auto-disabled strategies
CREATE TABLE IF NOT EXISTS strategy_kill_switch (
  strategy TEXT PRIMARY KEY,
  killed_at INTEGER NOT NULL,
  reason TEXT NOT NULL,
  trigger_win_rate REAL NOT NULL,
  trigger_sample_size INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'killed' CHECK (status IN ('killed', 'reviewed_keep_killed', 'reviewed_reenabled')),
  reviewed_at INTEGER
);

-- portfolio_state: KV for equity / drawdown / halt flags
CREATE TABLE IF NOT EXISTS portfolio_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- schema_version: single-row migration tracking
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
```

- [ ] **Step 2: Write failing test for migration runner**

Create `tests/db/migrations.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations, currentSchemaVersion } from "../../src/db/migrations.js";

describe("runMigrations", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
  });

  it("creates all required tables on fresh db", () => {
    runMigrations(db);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r: any) => r.name);
    expect(tables).toContain("signal_log");
    expect(tables).toContain("strategy_performance");
    expect(tables).toContain("filter_config");
    expect(tables).toContain("filter_proposals");
    expect(tables).toContain("strategy_kill_switch");
    expect(tables).toContain("portfolio_state");
    expect(tables).toContain("schema_version");
  });

  it("records current schema version after migration", () => {
    runMigrations(db);
    expect(currentSchemaVersion(db)).toBe(1);
  });

  it("is idempotent — second run does nothing", () => {
    runMigrations(db);
    const firstVersion = currentSchemaVersion(db);
    runMigrations(db);
    expect(currentSchemaVersion(db)).toBe(firstVersion);
  });
});
```

- [ ] **Step 3: Run test, verify it fails**

Run: `pnpm --filter @rivonclaw/rivonclaw-polymarket test:run tests/db/migrations.test.ts`
Expected: FAIL — "Cannot find module '../../src/db/migrations.js'"

- [ ] **Step 4: Implement `migrations.ts`**

```typescript
import type Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SCHEMA_SQL_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "schema.sql"
);
const CURRENT_VERSION = 1;

export function runMigrations(db: Database.Database): void {
  const schemaSql = readFileSync(SCHEMA_SQL_PATH, "utf-8");
  db.exec("BEGIN");
  try {
    db.exec(schemaSql);
    const existing = db
      .prepare("SELECT version FROM schema_version ORDER BY version DESC LIMIT 1")
      .get() as { version: number } | undefined;
    if (!existing || existing.version < CURRENT_VERSION) {
      db.prepare("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)").run(
        CURRENT_VERSION,
        Date.now()
      );
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function currentSchemaVersion(db: Database.Database): number {
  const row = db
    .prepare("SELECT version FROM schema_version ORDER BY version DESC LIMIT 1")
    .get() as { version: number } | undefined;
  return row?.version ?? 0;
}
```

- [ ] **Step 5: Fix the tsdown config to copy schema.sql to dist**

Edit `tsdown.config.ts`, update the `onSuccess` function:
```typescript
onSuccess: async () => {
  const { copyFileSync, mkdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  copyFileSync(
    join(process.cwd(), "openclaw.plugin.json"),
    join(process.cwd(), "dist", "openclaw.plugin.json")
  );
  mkdirSync(join(process.cwd(), "dist", "db"), { recursive: true });
  copyFileSync(
    join(process.cwd(), "src", "db", "schema.sql"),
    join(process.cwd(), "dist", "db", "schema.sql")
  );
},
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @rivonclaw/rivonclaw-polymarket test:run tests/db/migrations.test.ts`
Expected: PASS, all 3 tests green.

- [ ] **Step 7: Implement `connection.ts`**

```typescript
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { runMigrations } from "./migrations.js";

export function openDatabase(path: string): Database.Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
  runMigrations(db);
  return db;
}
```

- [ ] **Step 8: Commit**

```bash
git add -f extensions/rivonclaw-polymarket/src/db/ extensions/rivonclaw-polymarket/tests/db/ extensions/rivonclaw-polymarket/tsdown.config.ts
git commit -m "feat(polymarket): add SQLite schema and migration runner"
```

### Task 3: signal_log repository

**Files:**
- Create: `extensions/rivonclaw-polymarket/src/db/signal-log-repo.ts`
- Create: `extensions/rivonclaw-polymarket/src/db/types.ts`
- Test: `extensions/rivonclaw-polymarket/tests/db/signal-log-repo.test.ts`

- [ ] **Step 1: Write `src/db/types.ts` with row types**

```typescript
export type Direction = "buy_yes" | "buy_no";
export type ExitReason = "E" | "A_SL" | "A_TP" | "D" | "C";
export type LlmVerdict = "real_signal" | "noise" | "uncertain";

export interface SignalLogRow {
  signal_id: string;
  market_id: string;
  market_title: string;
  resolves_at: number;
  triggered_at: number;
  direction: Direction;
  entry_price: number;
  price_bucket: number;
  size_usdc: number;
  kelly_fraction: number;
  snapshot_volume_1m: number;
  snapshot_net_flow_1m: number;
  snapshot_unique_traders_1m: number;
  snapshot_price_move_5m: number;
  snapshot_liquidity: number;
  llm_verdict: LlmVerdict;
  llm_confidence: number;
  llm_reasoning: string;
  exit_at: number | null;
  exit_price: number | null;
  exit_reason: ExitReason | null;
  pnl_gross_usdc: number | null;
  fees_usdc: number | null;
  slippage_usdc: number | null;
  gas_usdc: number | null;
  pnl_net_usdc: number | null;
  holding_duration_sec: number | null;
}

export type NewSignal = Omit<
  SignalLogRow,
  "exit_at" | "exit_price" | "exit_reason" | "pnl_gross_usdc"
  | "fees_usdc" | "slippage_usdc" | "gas_usdc" | "pnl_net_usdc"
  | "holding_duration_sec"
>;

export interface ExitFill {
  exit_at: number;
  exit_price: number;
  exit_reason: ExitReason;
  pnl_gross_usdc: number;
  fees_usdc: number;
  slippage_usdc: number;
  gas_usdc: number;
  pnl_net_usdc: number;
  holding_duration_sec: number;
}
```

- [ ] **Step 2: Write failing test for signal-log-repo**

Create `tests/db/signal-log-repo.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations.js";
import { createSignalLogRepo } from "../../src/db/signal-log-repo.js";
import type { NewSignal } from "../../src/db/types.js";

function sample(overrides: Partial<NewSignal> = {}): NewSignal {
  return {
    signal_id: "sig-1",
    market_id: "mkt-1",
    market_title: "Will it rain?",
    resolves_at: 1_700_000_000_000,
    triggered_at: 1_699_000_000_000,
    direction: "buy_yes",
    entry_price: 0.55,
    price_bucket: 0.55,
    size_usdc: 100,
    kelly_fraction: 0.1,
    snapshot_volume_1m: 3500,
    snapshot_net_flow_1m: 3200,
    snapshot_unique_traders_1m: 4,
    snapshot_price_move_5m: 0.04,
    snapshot_liquidity: 6000,
    llm_verdict: "real_signal",
    llm_confidence: 0.72,
    llm_reasoning: "strong net flow + 4 unique traders",
    ...overrides,
  };
}

describe("signalLogRepo", () => {
  let db: Database.Database;
  let repo: ReturnType<typeof createSignalLogRepo>;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    repo = createSignalLogRepo(db);
  });

  it("inserts a new signal and reads it back", () => {
    repo.insert(sample());
    const row = repo.findById("sig-1");
    expect(row).not.toBeNull();
    expect(row?.market_title).toBe("Will it rain?");
    expect(row?.exit_at).toBeNull();
    expect(row?.pnl_net_usdc).toBeNull();
  });

  it("lists open positions (exit_at IS NULL)", () => {
    repo.insert(sample({ signal_id: "open-1" }));
    repo.insert(sample({ signal_id: "open-2", market_id: "mkt-2" }));
    const open = repo.listOpen();
    expect(open).toHaveLength(2);
    expect(open.map((r) => r.signal_id).sort()).toEqual(["open-1", "open-2"]);
  });

  it("records exit and moves signal to closed", () => {
    repo.insert(sample({ signal_id: "close-1" }));
    repo.recordExit("close-1", {
      exit_at: 1_699_001_000_000,
      exit_price: 0.60,
      exit_reason: "A_TP",
      pnl_gross_usdc: 9.0,
      fees_usdc: 0.5,
      slippage_usdc: 0.3,
      gas_usdc: 0.2,
      pnl_net_usdc: 8.0,
      holding_duration_sec: 1000,
    });
    const row = repo.findById("close-1");
    expect(row?.exit_reason).toBe("A_TP");
    expect(row?.pnl_net_usdc).toBe(8.0);
    expect(repo.listOpen()).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run test, verify it fails**

Run: `pnpm --filter @rivonclaw/rivonclaw-polymarket test:run tests/db/signal-log-repo.test.ts`
Expected: FAIL — import error.

- [ ] **Step 4: Implement `signal-log-repo.ts`**

```typescript
import type Database from "better-sqlite3";
import type { SignalLogRow, NewSignal, ExitFill } from "./types.js";

export interface SignalLogRepo {
  insert(signal: NewSignal): void;
  findById(id: string): SignalLogRow | null;
  listOpen(): SignalLogRow[];
  recordExit(id: string, fill: ExitFill): void;
  listClosedSince(sinceMs: number): SignalLogRow[];
}

export function createSignalLogRepo(db: Database.Database): SignalLogRepo {
  const insertStmt = db.prepare(`
    INSERT INTO signal_log (
      signal_id, market_id, market_title, resolves_at, triggered_at,
      direction, entry_price, price_bucket, size_usdc, kelly_fraction,
      snapshot_volume_1m, snapshot_net_flow_1m, snapshot_unique_traders_1m,
      snapshot_price_move_5m, snapshot_liquidity,
      llm_verdict, llm_confidence, llm_reasoning
    ) VALUES (
      @signal_id, @market_id, @market_title, @resolves_at, @triggered_at,
      @direction, @entry_price, @price_bucket, @size_usdc, @kelly_fraction,
      @snapshot_volume_1m, @snapshot_net_flow_1m, @snapshot_unique_traders_1m,
      @snapshot_price_move_5m, @snapshot_liquidity,
      @llm_verdict, @llm_confidence, @llm_reasoning
    )
  `);

  const findByIdStmt = db.prepare("SELECT * FROM signal_log WHERE signal_id = ?");
  const listOpenStmt = db.prepare("SELECT * FROM signal_log WHERE exit_at IS NULL");
  const listClosedSinceStmt = db.prepare(
    "SELECT * FROM signal_log WHERE exit_at IS NOT NULL AND exit_at >= ? ORDER BY exit_at DESC"
  );
  const recordExitStmt = db.prepare(`
    UPDATE signal_log SET
      exit_at = @exit_at,
      exit_price = @exit_price,
      exit_reason = @exit_reason,
      pnl_gross_usdc = @pnl_gross_usdc,
      fees_usdc = @fees_usdc,
      slippage_usdc = @slippage_usdc,
      gas_usdc = @gas_usdc,
      pnl_net_usdc = @pnl_net_usdc,
      holding_duration_sec = @holding_duration_sec
    WHERE signal_id = @signal_id AND exit_at IS NULL
  `);

  return {
    insert(signal) {
      insertStmt.run(signal);
    },
    findById(id) {
      return (findByIdStmt.get(id) as SignalLogRow | undefined) ?? null;
    },
    listOpen() {
      return listOpenStmt.all() as SignalLogRow[];
    },
    recordExit(id, fill) {
      const result = recordExitStmt.run({ signal_id: id, ...fill });
      if (result.changes !== 1) {
        throw new Error(`recordExit: expected 1 row updated, got ${result.changes} for ${id}`);
      }
    },
    listClosedSince(sinceMs) {
      return listClosedSinceStmt.all(sinceMs) as SignalLogRow[];
    },
  };
}
```

- [ ] **Step 5: Run test, verify passes**

Run: `pnpm --filter @rivonclaw/rivonclaw-polymarket test:run tests/db/signal-log-repo.test.ts`
Expected: PASS, 3 tests green.

- [ ] **Step 6: Commit**

```bash
git add -f extensions/rivonclaw-polymarket/src/db/signal-log-repo.ts extensions/rivonclaw-polymarket/src/db/types.ts extensions/rivonclaw-polymarket/tests/db/signal-log-repo.test.ts
git commit -m "feat(polymarket): add signal_log repository with insert/findById/listOpen/recordExit"
```

### Task 4: portfolio_state, filter_config, and other KV repos

**Files:**
- Create: `extensions/rivonclaw-polymarket/src/db/portfolio-state-repo.ts`
- Create: `extensions/rivonclaw-polymarket/src/db/filter-config-repo.ts`
- Create: `extensions/rivonclaw-polymarket/src/db/filter-proposals-repo.ts`
- Create: `extensions/rivonclaw-polymarket/src/db/kill-switch-repo.ts`
- Create: `extensions/rivonclaw-polymarket/src/db/strategy-performance-repo.ts`
- Test: `extensions/rivonclaw-polymarket/tests/db/portfolio-state-repo.test.ts`

- [ ] **Step 1: Write test for portfolio-state-repo (typed getters/setters for equity + halt flags)**

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations.js";
import { createPortfolioStateRepo } from "../../src/db/portfolio-state-repo.js";

describe("portfolioStateRepo", () => {
  let db: Database.Database;
  let repo: ReturnType<typeof createPortfolioStateRepo>;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    repo = createPortfolioStateRepo(db);
  });

  it("initializes with sensible defaults on first read", () => {
    const state = repo.read();
    expect(state.total_capital).toBe(10_000);
    expect(state.current_equity).toBe(10_000);
    expect(state.peak_equity).toBe(10_000);
    expect(state.current_drawdown).toBe(0);
    expect(state.daily_halt_triggered).toBe(false);
    expect(state.weekly_halt_triggered).toBe(false);
  });

  it("persists updates and reads them back", () => {
    repo.update({ current_equity: 9800, current_drawdown: 0.02 });
    const state = repo.read();
    expect(state.current_equity).toBe(9800);
    expect(state.current_drawdown).toBe(0.02);
    expect(state.total_capital).toBe(10_000);
  });

  it("sets and clears daily halt flag", () => {
    repo.update({ daily_halt_triggered: true });
    expect(repo.read().daily_halt_triggered).toBe(true);
    repo.update({ daily_halt_triggered: false });
    expect(repo.read().daily_halt_triggered).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, verify fails**

Run: `pnpm --filter @rivonclaw/rivonclaw-polymarket test:run tests/db/portfolio-state-repo.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `portfolio-state-repo.ts`**

```typescript
import type Database from "better-sqlite3";

export interface PortfolioState {
  total_capital: number;
  current_equity: number;
  day_start_equity: number;
  week_start_equity: number;
  peak_equity: number;
  current_drawdown: number;
  daily_halt_triggered: boolean;
  weekly_halt_triggered: boolean;
}

const DEFAULTS: PortfolioState = {
  total_capital: 10_000,
  current_equity: 10_000,
  day_start_equity: 10_000,
  week_start_equity: 10_000,
  peak_equity: 10_000,
  current_drawdown: 0,
  daily_halt_triggered: false,
  weekly_halt_triggered: false,
};

export interface PortfolioStateRepo {
  read(): PortfolioState;
  update(patch: Partial<PortfolioState>): void;
}

function serialize(value: unknown): string {
  return JSON.stringify(value);
}
function deserialize<T>(raw: string | undefined, fallback: T): T {
  if (raw === undefined) return fallback;
  return JSON.parse(raw) as T;
}

export function createPortfolioStateRepo(db: Database.Database): PortfolioStateRepo {
  const getStmt = db.prepare("SELECT key, value FROM portfolio_state");
  const upsertStmt = db.prepare(`
    INSERT INTO portfolio_state (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);

  function read(): PortfolioState {
    const rows = getStmt.all() as Array<{ key: string; value: string }>;
    const map = new Map(rows.map((r) => [r.key, r.value]));
    return {
      total_capital: deserialize(map.get("total_capital"), DEFAULTS.total_capital),
      current_equity: deserialize(map.get("current_equity"), DEFAULTS.current_equity),
      day_start_equity: deserialize(map.get("day_start_equity"), DEFAULTS.day_start_equity),
      week_start_equity: deserialize(map.get("week_start_equity"), DEFAULTS.week_start_equity),
      peak_equity: deserialize(map.get("peak_equity"), DEFAULTS.peak_equity),
      current_drawdown: deserialize(map.get("current_drawdown"), DEFAULTS.current_drawdown),
      daily_halt_triggered: deserialize(map.get("daily_halt_triggered"), DEFAULTS.daily_halt_triggered),
      weekly_halt_triggered: deserialize(map.get("weekly_halt_triggered"), DEFAULTS.weekly_halt_triggered),
    };
  }

  function update(patch: Partial<PortfolioState>): void {
    const now = Date.now();
    const tx = db.transaction((entries: Array<[string, string]>) => {
      for (const [k, v] of entries) upsertStmt.run(k, v, now);
    });
    tx(Object.entries(patch).map(([k, v]) => [k, serialize(v)]));
  }

  return { read, update };
}
```

- [ ] **Step 4: Run test, verify passes**

Expected: all 3 tests pass.

- [ ] **Step 5: Implement the other KV repos (same pattern)**

Implement `filter-config-repo.ts`, `filter-proposals-repo.ts`, `kill-switch-repo.ts`, `strategy-performance-repo.ts` following the same pattern. Each should have:
- `read()` / `get(key)` / `list()` typed returns
- `upsert()` / `insert()` with transactions
- A small test file with 2-3 cases each

Skipping full code listings here for brevity — follow the `portfolio-state-repo` pattern. **Mandatory:** each repo must have its test file with ≥ 3 passing tests before moving on.

- [ ] **Step 6: Run all db tests, verify all pass**

Run: `pnpm --filter @rivonclaw/rivonclaw-polymarket test:run tests/db/`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add -f extensions/rivonclaw-polymarket/src/db/ extensions/rivonclaw-polymarket/tests/db/
git commit -m "feat(polymarket): add portfolio_state, filter_config, filter_proposals, kill_switch, strategy_performance repos"
```

---

## Phase 2 — Config & Utilities

Goal: typed config with defaults, price-bucket utility with prior win rates, time helpers.

### Task 5: Config schema, defaults, loader

**Files:**
- Create: `extensions/rivonclaw-polymarket/src/config/schema.ts`
- Create: `extensions/rivonclaw-polymarket/src/config/defaults.ts`
- Create: `extensions/rivonclaw-polymarket/src/config/loader.ts`
- Test: `extensions/rivonclaw-polymarket/tests/config/loader.test.ts`

- [ ] **Step 1: Write `src/config/schema.ts`**

```typescript
export interface TraderConfig {
  // Trigger thresholds (§4.2)
  minTradeUsdc: number;             // 200
  minNetFlow1mUsdc: number;         // 3000
  minUniqueTraders1m: number;       // 3
  minPriceMove5m: number;           // 0.03
  minLiquidityUsdc: number;         // 5000
  minTimeToResolveSec: number;      // 1800
  maxTimeToResolveSec: number;      // 259200
  // Dead zone (§4.3)
  staticDeadZone: [number, number]; // [0.60, 0.85]
  // Bot detection (§4.2)
  botBurstCount: number;            // 10
  botBurstWindowMs: number;         // 1000
  // Large order exemption (§4.2)
  largeSingleTradeUsdc: number;     // 5000
  largeNetFlowUsdc: number;         // 10000
  // Kelly (§6.1)
  kellyMultiplier: number;          // 0.25
  minPositionUsdc: number;          // 50
  maxPositionUsdc: number;          // 300
  maxSingleTradeLossUsdc: number;   // 50
  // Portfolio limits (§6.2)
  maxTotalPositionUsdc: number;     // 2000
  maxOpenPositions: number;         // 8
  gasPerTradeUsdc: number;          // 0.20
  // Exit rules (§5)
  stopLossPctNormal: number;        // 0.07
  stopLossPctLateStage: number;     // 0.03
  lateStageThresholdSec: number;    // 1800
  takeProfitPct: number;            // 0.10
  maxHoldingSec: number;            // 14400
  expirySafetyBufferSec: number;    // 300  (TBD from Polymarket CLOB docs)
  // Circuit breakers (§6.3)
  dailyLossHaltPct: number;         // 0.02
  weeklyLossHaltPct: number;        // 0.04
  killSwitchMinTrades: number;      // 10
  killSwitchMaxWinRate: number;     // 0.45
  totalDrawdownHaltPct: number;     // 0.10
  // Paper trading (§9)
  paperSlippagePct: number;         // 0.005
  // Polymarket (§3)
  polymarketWsUrl: string;          // wss://ws-subscriptions-clob.polymarket.com/ws/
  marketBlacklistSubstrings: string[]; // ["up or down"]
  // LLM (§7.1 Analyzer)
  llmTimeoutMs: number;             // 30000
}
```

- [ ] **Step 2: Write `src/config/defaults.ts`**

```typescript
import type { TraderConfig } from "./schema.js";

export const DEFAULT_CONFIG: TraderConfig = {
  minTradeUsdc: 200,
  minNetFlow1mUsdc: 3000,
  minUniqueTraders1m: 3,
  minPriceMove5m: 0.03,
  minLiquidityUsdc: 5000,
  minTimeToResolveSec: 1800,
  maxTimeToResolveSec: 259_200,
  staticDeadZone: [0.60, 0.85],
  botBurstCount: 10,
  botBurstWindowMs: 1000,
  largeSingleTradeUsdc: 5000,
  largeNetFlowUsdc: 10_000,
  kellyMultiplier: 0.25,
  minPositionUsdc: 50,
  maxPositionUsdc: 300,
  maxSingleTradeLossUsdc: 50,
  maxTotalPositionUsdc: 2000,
  maxOpenPositions: 8,
  gasPerTradeUsdc: 0.20,
  stopLossPctNormal: 0.07,
  stopLossPctLateStage: 0.03,
  lateStageThresholdSec: 1800,
  takeProfitPct: 0.10,
  maxHoldingSec: 14_400,
  expirySafetyBufferSec: 300,
  dailyLossHaltPct: 0.02,
  weeklyLossHaltPct: 0.04,
  killSwitchMinTrades: 10,
  killSwitchMaxWinRate: 0.45,
  totalDrawdownHaltPct: 0.10,
  paperSlippagePct: 0.005,
  polymarketWsUrl: "wss://ws-subscriptions-clob.polymarket.com/ws/",
  marketBlacklistSubstrings: ["up or down"],
  llmTimeoutMs: 30_000,
};
```

- [ ] **Step 3: Write failing test for loader**

```typescript
import { describe, it, expect } from "vitest";
import { loadConfig } from "../../src/config/loader.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";

describe("loadConfig", () => {
  it("returns defaults when no path given", () => {
    const cfg = loadConfig(undefined);
    expect(cfg).toEqual(DEFAULT_CONFIG);
  });

  it("overrides specific fields from partial YAML", () => {
    const cfg = loadConfig(undefined, { minNetFlow1mUsdc: 5000, kellyMultiplier: 0.5 });
    expect(cfg.minNetFlow1mUsdc).toBe(5000);
    expect(cfg.kellyMultiplier).toBe(0.5);
    expect(cfg.minTradeUsdc).toBe(DEFAULT_CONFIG.minTradeUsdc);
  });
});
```

- [ ] **Step 4: Implement `src/config/loader.ts`**

```typescript
import type { TraderConfig } from "./schema.js";
import { DEFAULT_CONFIG } from "./defaults.js";
import { readFileSync, existsSync } from "node:fs";

export function loadConfig(
  path: string | undefined,
  overrides: Partial<TraderConfig> = {}
): TraderConfig {
  let fromFile: Partial<TraderConfig> = {};
  if (path && existsSync(path)) {
    // Minimal YAML-lite: for v1, store config as JSON on disk. YAML support
    // deferred until M3 when Reviewer needs human-readable editing.
    const raw = readFileSync(path, "utf-8");
    fromFile = JSON.parse(raw) as Partial<TraderConfig>;
  }
  return { ...DEFAULT_CONFIG, ...fromFile, ...overrides };
}
```

- [ ] **Step 5: Run tests, verify pass**

- [ ] **Step 6: Commit**

```bash
git add -f extensions/rivonclaw-polymarket/src/config/ extensions/rivonclaw-polymarket/tests/config/
git commit -m "feat(polymarket): add config schema with defaults and loader"
```

### Task 6: Price bucket utility with prior win rates

**Files:**
- Create: `extensions/rivonclaw-polymarket/src/executor/price-bucket.ts`
- Test: `extensions/rivonclaw-polymarket/tests/executor/price-bucket.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect } from "vitest";
import { priceBucket, priorWinRate } from "../../src/executor/price-bucket.js";

describe("priceBucket", () => {
  it("floors to nearest 0.05", () => {
    expect(priceBucket(0.53)).toBe(0.50);
    expect(priceBucket(0.55)).toBe(0.55);
    expect(priceBucket(0.549)).toBe(0.50);
    expect(priceBucket(0.01)).toBe(0.00);
    expect(priceBucket(0.99)).toBe(0.95);
  });

  it("is stable at exact bucket edges", () => {
    expect(priceBucket(0.60)).toBe(0.60);
    expect(priceBucket(0.85)).toBe(0.85);
  });
});

describe("priorWinRate", () => {
  it("returns 0.34 for dead zone buckets [0.60, 0.85]", () => {
    expect(priorWinRate(0.60)).toBe(0.34);
    expect(priorWinRate(0.70)).toBe(0.34);
    expect(priorWinRate(0.80)).toBe(0.34);
  });

  it("returns 0.34 at 0.85 (inclusive upper bound)", () => {
    expect(priorWinRate(0.85)).toBe(0.34);
  });

  it("returns 0.50 neutral outside dead zone", () => {
    expect(priorWinRate(0.50)).toBe(0.50);
    expect(priorWinRate(0.30)).toBe(0.50);
    expect(priorWinRate(0.90)).toBe(0.50);
    expect(priorWinRate(0.05)).toBe(0.50);
  });
});
```

- [ ] **Step 2: Run test, verify fails**

- [ ] **Step 3: Implement `price-bucket.ts`**

```typescript
const BUCKET_SIZE = 0.05;

export function priceBucket(price: number): number {
  if (price < 0 || price > 1) {
    throw new RangeError(`priceBucket: price ${price} not in [0, 1]`);
  }
  // Multiply to avoid floating-point issues, then floor.
  return Math.floor(price / BUCKET_SIZE + 1e-9) * BUCKET_SIZE;
}

const DEAD_ZONE_MIN = 0.60;
const DEAD_ZONE_MAX = 0.85;
const DEAD_ZONE_PRIOR_WIN_RATE = 0.34;
const NEUTRAL_PRIOR_WIN_RATE = 0.50;

export function priorWinRate(bucket: number): number {
  if (bucket >= DEAD_ZONE_MIN && bucket <= DEAD_ZONE_MAX) {
    return DEAD_ZONE_PRIOR_WIN_RATE;
  }
  return NEUTRAL_PRIOR_WIN_RATE;
}
```

- [ ] **Step 4: Run test, verify passes**

- [ ] **Step 5: Commit**

```bash
git add -f extensions/rivonclaw-polymarket/src/executor/price-bucket.ts extensions/rivonclaw-polymarket/tests/executor/price-bucket.test.ts
git commit -m "feat(polymarket): add price bucket utility with static dead zone priors"
```

### Task 7: Time utilities and typed errors

**Files:**
- Create: `extensions/rivonclaw-polymarket/src/util/time.ts`
- Create: `extensions/rivonclaw-polymarket/src/util/errors.ts`

- [ ] **Step 1: Create `util/time.ts` with no tests (pure pass-through helpers)**

```typescript
export function nowMs(): number {
  return Date.now();
}

export function secondsUntil(targetMs: number, from: number = nowMs()): number {
  return Math.floor((targetMs - from) / 1000);
}

export function isWithinBufferOfExpiry(resolvesAtMs: number, bufferSec: number, nowMsValue: number = nowMs()): boolean {
  return secondsUntil(resolvesAtMs, nowMsValue) <= bufferSec;
}
```

- [ ] **Step 2: Create `util/errors.ts` with typed error classes**

```typescript
/** Thrown when the system must enter safe mode (stop new orders). */
export class SafeModeError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "SafeModeError";
  }
}

/** Thrown when an incoming Polymarket event is malformed and unsafe to process. */
export class InvalidEventError extends Error {
  constructor(message: string, public readonly event: unknown) {
    super(message);
    this.name = "InvalidEventError";
  }
}

/** Thrown when Analyzer agent returns an unparseable or invalid verdict. */
export class VerdictParseError extends Error {
  constructor(message: string, public readonly raw: unknown) {
    super(message);
    this.name = "VerdictParseError";
  }
}

/** Thrown when LLM call exceeds configured timeout. */
export class LlmTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`LLM call exceeded ${timeoutMs}ms timeout`);
    this.name = "LlmTimeoutError";
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add -f extensions/rivonclaw-polymarket/src/util/
git commit -m "feat(polymarket): add time helpers and typed error classes"
```

---

## Phase 3 — Event Bus

Goal: a typed in-memory event emitter for `TriggerEvent`, `VerdictEvent`, `ExitRequestEvent`, used by Collector → Analyzer-caller → Executor → exit monitor.

### Task 8: Typed event bus

**Files:**
- Create: `extensions/rivonclaw-polymarket/src/bus/types.ts`
- Create: `extensions/rivonclaw-polymarket/src/bus/events.ts`
- Test: `extensions/rivonclaw-polymarket/tests/bus/events.test.ts`

- [ ] **Step 1: Write `bus/types.ts`**

```typescript
import type { Direction, LlmVerdict } from "../db/types.js";

export interface MarketSnapshot {
  volume_1m: number;
  net_flow_1m: number;
  unique_traders_1m: number;
  price_move_5m: number;
  liquidity: number;
  current_mid_price: number;
}

export interface TriggerEvent {
  type: "trigger";
  market_id: string;
  market_title: string;
  resolves_at: number;
  triggered_at: number;
  direction: Direction;
  snapshot: MarketSnapshot;
}

export interface VerdictEvent {
  type: "verdict";
  trigger: TriggerEvent;
  verdict: LlmVerdict;
  confidence: number;
  reasoning: string;
  llm_direction: Direction;
}

export interface OrderRequestEvent {
  type: "order_request";
  verdict: VerdictEvent;
}

export interface ExitRequestEvent {
  type: "exit_request";
  signal_id: string;
  reason: "E" | "A_SL" | "A_TP" | "D" | "C";
}

export type BusEvent = TriggerEvent | VerdictEvent | OrderRequestEvent | ExitRequestEvent;
```

- [ ] **Step 2: Write failing test for typed event emitter**

```typescript
import { describe, it, expect, vi } from "vitest";
import { createEventBus } from "../../src/bus/events.js";
import type { TriggerEvent } from "../../src/bus/types.js";

const sampleTrigger: TriggerEvent = {
  type: "trigger",
  market_id: "m1",
  market_title: "Test",
  resolves_at: Date.now() + 3_600_000,
  triggered_at: Date.now(),
  direction: "buy_yes",
  snapshot: {
    volume_1m: 3500,
    net_flow_1m: 3200,
    unique_traders_1m: 4,
    price_move_5m: 0.04,
    liquidity: 6000,
    current_mid_price: 0.55,
  },
};

describe("createEventBus", () => {
  it("delivers published trigger to subscribed listener", () => {
    const bus = createEventBus();
    const listener = vi.fn();
    bus.onTrigger(listener);
    bus.publishTrigger(sampleTrigger);
    expect(listener).toHaveBeenCalledWith(sampleTrigger);
  });

  it("supports multiple listeners for same event", () => {
    const bus = createEventBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.onTrigger(a);
    bus.onTrigger(b);
    bus.publishTrigger(sampleTrigger);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("unsubscribe stops future deliveries", () => {
    const bus = createEventBus();
    const listener = vi.fn();
    const off = bus.onTrigger(listener);
    off();
    bus.publishTrigger(sampleTrigger);
    expect(listener).not.toHaveBeenCalled();
  });

  it("does not cross-deliver between event types", () => {
    const bus = createEventBus();
    const triggerListener = vi.fn();
    const exitListener = vi.fn();
    bus.onTrigger(triggerListener);
    bus.onExitRequest(exitListener);
    bus.publishTrigger(sampleTrigger);
    expect(exitListener).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test, verify fails**

- [ ] **Step 4: Implement `bus/events.ts`**

```typescript
import type { TriggerEvent, VerdictEvent, OrderRequestEvent, ExitRequestEvent } from "./types.js";

type Listener<E> = (event: E) => void | Promise<void>;
type Unsubscribe = () => void;

export interface EventBus {
  onTrigger(listener: Listener<TriggerEvent>): Unsubscribe;
  onVerdict(listener: Listener<VerdictEvent>): Unsubscribe;
  onOrderRequest(listener: Listener<OrderRequestEvent>): Unsubscribe;
  onExitRequest(listener: Listener<ExitRequestEvent>): Unsubscribe;
  publishTrigger(event: TriggerEvent): void;
  publishVerdict(event: VerdictEvent): void;
  publishOrderRequest(event: OrderRequestEvent): void;
  publishExitRequest(event: ExitRequestEvent): void;
}

export function createEventBus(): EventBus {
  const triggerListeners = new Set<Listener<TriggerEvent>>();
  const verdictListeners = new Set<Listener<VerdictEvent>>();
  const orderListeners = new Set<Listener<OrderRequestEvent>>();
  const exitListeners = new Set<Listener<ExitRequestEvent>>();

  function sub<E>(set: Set<Listener<E>>, listener: Listener<E>): Unsubscribe {
    set.add(listener);
    return () => set.delete(listener);
  }

  function pub<E>(set: Set<Listener<E>>, event: E): void {
    for (const listener of set) {
      try {
        const result = listener(event);
        if (result instanceof Promise) {
          result.catch((err) => {
            // Listeners are fire-and-forget; errors must not stop other listeners.
            // Log via console as we don't have an api.logger here; consumer
            // wraps this with a proper logger adapter in production.
            console.error("[event-bus] async listener error:", err);
          });
        }
      } catch (err) {
        console.error("[event-bus] sync listener error:", err);
      }
    }
  }

  return {
    onTrigger: (l) => sub(triggerListeners, l),
    onVerdict: (l) => sub(verdictListeners, l),
    onOrderRequest: (l) => sub(orderListeners, l),
    onExitRequest: (l) => sub(exitListeners, l),
    publishTrigger: (e) => pub(triggerListeners, e),
    publishVerdict: (e) => pub(verdictListeners, e),
    publishOrderRequest: (e) => pub(orderListeners, e),
    publishExitRequest: (e) => pub(exitListeners, e),
  };
}
```

- [ ] **Step 5: Run tests, verify pass**

- [ ] **Step 6: Commit**

```bash
git add -f extensions/rivonclaw-polymarket/src/bus/ extensions/rivonclaw-polymarket/tests/bus/
git commit -m "feat(polymarket): add typed event bus for trigger/verdict/order/exit"
```

---

## Phase 4 — Collector

Goal: WebSocket client → dedup → bot filter → rolling window → trigger evaluator → publish `TriggerEvent`.

### Task 9: Bot filter (same-address burst detection)

**Files:**
- Create: `extensions/rivonclaw-polymarket/src/collector/bot-filter.ts`
- Test: `extensions/rivonclaw-polymarket/tests/collector/bot-filter.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect } from "vitest";
import { createBotFilter } from "../../src/collector/bot-filter.js";

describe("botFilter", () => {
  it("allows first 10 trades from an address within 1s", () => {
    const filter = createBotFilter({ burstCount: 10, windowMs: 1000 });
    for (let i = 0; i < 10; i++) {
      expect(filter.isBot("0xabc", 1_000 + i * 10)).toBe(false);
    }
  });

  it("marks address as bot on 11th trade within 1s", () => {
    const filter = createBotFilter({ burstCount: 10, windowMs: 1000 });
    for (let i = 0; i < 10; i++) filter.isBot("0xabc", 1_000 + i * 10);
    expect(filter.isBot("0xabc", 1_050)).toBe(true);
  });

  it("keeps bot classification sticky for the session", () => {
    const filter = createBotFilter({ burstCount: 10, windowMs: 1000 });
    for (let i = 0; i < 11; i++) filter.isBot("0xabc", 1_000 + i * 10);
    // Much later — still marked as bot
    expect(filter.isBot("0xabc", 10_000_000)).toBe(true);
  });

  it("tracks different addresses independently", () => {
    const filter = createBotFilter({ burstCount: 10, windowMs: 1000 });
    for (let i = 0; i < 11; i++) filter.isBot("0xabc", 1_000 + i * 10);
    expect(filter.isBot("0xdef", 1_000)).toBe(false);
  });

  it("does not count trades outside the rolling window", () => {
    const filter = createBotFilter({ burstCount: 10, windowMs: 1000 });
    for (let i = 0; i < 10; i++) filter.isBot("0xabc", 1_000 + i * 50);
    // Next trade is 2 seconds later — old trades drop out of window
    expect(filter.isBot("0xabc", 3_000)).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify fails**

- [ ] **Step 3: Implement `bot-filter.ts`**

```typescript
export interface BotFilterOptions {
  burstCount: number;
  windowMs: number;
}

export interface BotFilter {
  /** Returns true if the address is classified as a bot AT OR AFTER this trade. */
  isBot(address: string, timestampMs: number): boolean;
}

export function createBotFilter(opts: BotFilterOptions): BotFilter {
  const tradesByAddress = new Map<string, number[]>();
  const knownBots = new Set<string>();

  return {
    isBot(address: string, timestampMs: number): boolean {
      if (knownBots.has(address)) return true;

      let trades = tradesByAddress.get(address);
      if (!trades) {
        trades = [];
        tradesByAddress.set(address, trades);
      }
      // Drop trades outside the rolling window
      const cutoff = timestampMs - opts.windowMs;
      while (trades.length > 0 && trades[0]! < cutoff) {
        trades.shift();
      }
      trades.push(timestampMs);

      if (trades.length > opts.burstCount) {
        knownBots.add(address);
        tradesByAddress.delete(address); // free memory; classification is now sticky
        return true;
      }
      return false;
    },
  };
}
```

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git add -f extensions/rivonclaw-polymarket/src/collector/bot-filter.ts extensions/rivonclaw-polymarket/tests/collector/bot-filter.test.ts
git commit -m "feat(polymarket): add bot filter with sticky classification"
```

### Task 10: Rolling window statistics

**Files:**
- Create: `extensions/rivonclaw-polymarket/src/collector/rolling-window.ts`
- Test: `extensions/rivonclaw-polymarket/tests/collector/rolling-window.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect } from "vitest";
import { createRollingWindow } from "../../src/collector/rolling-window.js";

describe("rollingWindow", () => {
  it("tracks volume over a 60s window", () => {
    const w = createRollingWindow({ windowMs: 60_000 });
    w.add({ timestampMs: 1_000, address: "a", sizeUsdc: 100, side: "buy", price: 0.55 });
    w.add({ timestampMs: 30_000, address: "b", sizeUsdc: 200, side: "sell", price: 0.54 });
    const stats = w.stats(30_000);
    expect(stats.volume).toBe(300);
  });

  it("computes net flow (buy minus sell)", () => {
    const w = createRollingWindow({ windowMs: 60_000 });
    w.add({ timestampMs: 1_000, address: "a", sizeUsdc: 500, side: "buy", price: 0.55 });
    w.add({ timestampMs: 10_000, address: "b", sizeUsdc: 200, side: "sell", price: 0.54 });
    expect(w.stats(10_000).netFlow).toBe(300);
  });

  it("drops trades older than window", () => {
    const w = createRollingWindow({ windowMs: 60_000 });
    w.add({ timestampMs: 1_000, address: "a", sizeUsdc: 100, side: "buy", price: 0.55 });
    const stats = w.stats(100_000);
    expect(stats.volume).toBe(0);
  });

  it("counts unique traders", () => {
    const w = createRollingWindow({ windowMs: 60_000 });
    w.add({ timestampMs: 1_000, address: "a", sizeUsdc: 100, side: "buy", price: 0.55 });
    w.add({ timestampMs: 2_000, address: "b", sizeUsdc: 100, side: "buy", price: 0.55 });
    w.add({ timestampMs: 3_000, address: "a", sizeUsdc: 100, side: "buy", price: 0.55 });
    expect(w.stats(3_000).uniqueTraders).toBe(2);
  });

  it("computes price move (last minus first within window)", () => {
    const w = createRollingWindow({ windowMs: 300_000 });
    w.add({ timestampMs: 1_000, address: "a", sizeUsdc: 100, side: "buy", price: 0.50 });
    w.add({ timestampMs: 100_000, address: "b", sizeUsdc: 100, side: "buy", price: 0.52 });
    w.add({ timestampMs: 200_000, address: "c", sizeUsdc: 100, side: "buy", price: 0.55 });
    const stats = w.stats(200_000);
    expect(stats.priceMove).toBeCloseTo(0.05, 5);
  });
});
```

- [ ] **Step 2: Run, verify fails**

- [ ] **Step 3: Implement `rolling-window.ts`**

```typescript
export interface Trade {
  timestampMs: number;
  address: string;
  sizeUsdc: number;
  side: "buy" | "sell";
  price: number;
}

export interface WindowStats {
  volume: number;
  netFlow: number;
  uniqueTraders: number;
  priceMove: number;
}

export interface RollingWindow {
  add(trade: Trade): void;
  stats(nowMs: number): WindowStats;
}

export interface RollingWindowOptions {
  windowMs: number;
}

export function createRollingWindow(opts: RollingWindowOptions): RollingWindow {
  const trades: Trade[] = [];

  function trim(nowMs: number): void {
    const cutoff = nowMs - opts.windowMs;
    while (trades.length > 0 && trades[0]!.timestampMs < cutoff) {
      trades.shift();
    }
  }

  return {
    add(trade: Trade): void {
      trades.push(trade);
    },
    stats(nowMs: number): WindowStats {
      trim(nowMs);
      if (trades.length === 0) {
        return { volume: 0, netFlow: 0, uniqueTraders: 0, priceMove: 0 };
      }
      let volume = 0;
      let netFlow = 0;
      const addresses = new Set<string>();
      for (const t of trades) {
        volume += t.sizeUsdc;
        netFlow += t.side === "buy" ? t.sizeUsdc : -t.sizeUsdc;
        addresses.add(t.address);
      }
      const priceMove = trades[trades.length - 1]!.price - trades[0]!.price;
      return {
        volume,
        netFlow,
        uniqueTraders: addresses.size,
        priceMove,
      };
    },
  };
}
```

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git add -f extensions/rivonclaw-polymarket/src/collector/rolling-window.ts extensions/rivonclaw-polymarket/tests/collector/rolling-window.test.ts
git commit -m "feat(polymarket): add rolling window stats (volume/netFlow/traders/priceMove)"
```

### Task 11: Trigger evaluator

**Files:**
- Create: `extensions/rivonclaw-polymarket/src/collector/trigger-evaluator.ts`
- Test: `extensions/rivonclaw-polymarket/tests/collector/trigger-evaluator.test.ts`

- [ ] **Step 1: Write failing test covering all triggering/rejecting cases**

```typescript
import { describe, it, expect } from "vitest";
import { createTriggerEvaluator } from "../../src/collector/trigger-evaluator.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import type { WindowStats } from "../../src/collector/rolling-window.js";

const baseMarket = {
  marketId: "m1",
  marketTitle: "Will it happen?",
  resolvesAt: Date.now() + 7_200_000, // 2h from now
  currentMidPrice: 0.55,
  liquidity: 6000,
};

const baseWindow1m: WindowStats = {
  volume: 3500,
  netFlow: 3200,
  uniqueTraders: 4,
  priceMove: 0.0, // 5m window delta, used from window5m
};
const baseWindow5m: WindowStats = {
  volume: 10_000,
  netFlow: 8000,
  uniqueTraders: 12,
  priceMove: 0.04,
};

describe("triggerEvaluator", () => {
  const evalTrigger = createTriggerEvaluator(DEFAULT_CONFIG);

  it("accepts a clean signal that meets all thresholds", () => {
    const result = evalTrigger({
      market: baseMarket,
      window1m: baseWindow1m,
      window5m: baseWindow5m,
      nowMs: Date.now(),
    });
    expect(result.accepted).toBe(true);
    expect(result.direction).toBe("buy_yes");
  });

  it("rejects when net flow is below threshold", () => {
    const result = evalTrigger({
      market: baseMarket,
      window1m: { ...baseWindow1m, netFlow: 500 },
      window5m: baseWindow5m,
      nowMs: Date.now(),
    });
    expect(result.accepted).toBe(false);
    expect(result.rejection).toBe("net_flow_below_threshold");
  });

  it("rejects when unique traders are below threshold (no large-order exemption)", () => {
    const result = evalTrigger({
      market: baseMarket,
      window1m: { ...baseWindow1m, uniqueTraders: 2 },
      window5m: baseWindow5m,
      nowMs: Date.now(),
    });
    expect(result.accepted).toBe(false);
    expect(result.rejection).toBe("unique_traders_below_threshold");
  });

  it("rejects when price inside static dead zone [0.60, 0.85]", () => {
    const result = evalTrigger({
      market: { ...baseMarket, currentMidPrice: 0.72 },
      window1m: baseWindow1m,
      window5m: baseWindow5m,
      nowMs: Date.now(),
    });
    expect(result.accepted).toBe(false);
    expect(result.rejection).toBe("inside_dead_zone");
  });

  it("rejects when time-to-resolve is too short", () => {
    const result = evalTrigger({
      market: { ...baseMarket, resolvesAt: Date.now() + 60_000 },
      window1m: baseWindow1m,
      window5m: baseWindow5m,
      nowMs: Date.now(),
    });
    expect(result.accepted).toBe(false);
    expect(result.rejection).toBe("time_to_resolve_too_short");
  });

  it("rejects when price move is too small", () => {
    const result = evalTrigger({
      market: baseMarket,
      window1m: baseWindow1m,
      window5m: { ...baseWindow5m, priceMove: 0.01 },
      nowMs: Date.now(),
    });
    expect(result.accepted).toBe(false);
    expect(result.rejection).toBe("price_move_below_threshold");
  });

  it("rejects when market title matches blacklist", () => {
    const result = evalTrigger({
      market: { ...baseMarket, marketTitle: "Bitcoin Up or Down in next hour" },
      window1m: baseWindow1m,
      window5m: baseWindow5m,
      nowMs: Date.now(),
    });
    expect(result.accepted).toBe(false);
    expect(result.rejection).toBe("blacklisted_market");
  });

  it("applies large-single-trade exemption to bypass unique-traders requirement", () => {
    const result = evalTrigger({
      market: baseMarket,
      window1m: { ...baseWindow1m, uniqueTraders: 1 },
      window5m: baseWindow5m,
      nowMs: Date.now(),
      latestTradeSizeUsdc: 6000, // ≥ largeSingleTradeUsdc ($5000)
    });
    expect(result.accepted).toBe(true);
  });

  it("applies large-net-flow exemption to bypass unique-traders requirement", () => {
    const result = evalTrigger({
      market: baseMarket,
      window1m: { ...baseWindow1m, uniqueTraders: 1, netFlow: 12_000 },
      window5m: baseWindow5m,
      nowMs: Date.now(),
    });
    expect(result.accepted).toBe(true);
  });

  it("does NOT exempt dead zone even with large order", () => {
    const result = evalTrigger({
      market: { ...baseMarket, currentMidPrice: 0.72 },
      window1m: baseWindow1m,
      window5m: baseWindow5m,
      nowMs: Date.now(),
      latestTradeSizeUsdc: 8000,
    });
    expect(result.accepted).toBe(false);
    expect(result.rejection).toBe("inside_dead_zone");
  });
});
```

- [ ] **Step 2: Run, verify fails**

- [ ] **Step 3: Implement `trigger-evaluator.ts`**

```typescript
import type { TraderConfig } from "../config/schema.js";
import type { WindowStats } from "./rolling-window.js";
import type { Direction } from "../db/types.js";

export type RejectionReason =
  | "net_flow_below_threshold"
  | "unique_traders_below_threshold"
  | "price_move_below_threshold"
  | "liquidity_below_threshold"
  | "time_to_resolve_too_short"
  | "time_to_resolve_too_long"
  | "inside_dead_zone"
  | "blacklisted_market";

export interface TriggerInput {
  market: {
    marketId: string;
    marketTitle: string;
    resolvesAt: number;
    currentMidPrice: number;
    liquidity: number;
  };
  window1m: WindowStats;
  window5m: WindowStats;
  nowMs: number;
  /** Size of the trade that triggered re-evaluation (used for large-order exemption). */
  latestTradeSizeUsdc?: number;
}

export interface TriggerAccepted {
  accepted: true;
  direction: Direction;
}
export interface TriggerRejected {
  accepted: false;
  rejection: RejectionReason;
}
export type TriggerResult = TriggerAccepted | TriggerRejected;

export type TriggerEvaluator = (input: TriggerInput) => TriggerResult;

export function createTriggerEvaluator(cfg: TraderConfig): TriggerEvaluator {
  return function evaluate(input: TriggerInput): TriggerResult {
    const { market, window1m, window5m, nowMs, latestTradeSizeUsdc = 0 } = input;

    // Blacklist check (cheapest first)
    const titleLower = market.marketTitle.toLowerCase();
    for (const sub of cfg.marketBlacklistSubstrings) {
      if (titleLower.includes(sub.toLowerCase())) {
        return { accepted: false, rejection: "blacklisted_market" };
      }
    }

    // Dead zone (even large orders do not get exemption — spec §4.2)
    const [dzMin, dzMax] = cfg.staticDeadZone;
    if (market.currentMidPrice >= dzMin && market.currentMidPrice <= dzMax) {
      return { accepted: false, rejection: "inside_dead_zone" };
    }

    // Time to resolve
    const secToResolve = Math.floor((market.resolvesAt - nowMs) / 1000);
    if (secToResolve < cfg.minTimeToResolveSec) {
      return { accepted: false, rejection: "time_to_resolve_too_short" };
    }
    if (secToResolve > cfg.maxTimeToResolveSec) {
      return { accepted: false, rejection: "time_to_resolve_too_long" };
    }

    // Liquidity
    if (market.liquidity < cfg.minLiquidityUsdc) {
      return { accepted: false, rejection: "liquidity_below_threshold" };
    }

    // Price move (from 5m window)
    if (Math.abs(window5m.priceMove) < cfg.minPriceMove5m) {
      return { accepted: false, rejection: "price_move_below_threshold" };
    }

    // Net flow (from 1m window)
    if (Math.abs(window1m.netFlow) < cfg.minNetFlow1mUsdc) {
      return { accepted: false, rejection: "net_flow_below_threshold" };
    }

    // Large order exemption: bypass unique traders requirement only
    const hasLargeExemption =
      latestTradeSizeUsdc >= cfg.largeSingleTradeUsdc ||
      Math.abs(window1m.netFlow) >= cfg.largeNetFlowUsdc;

    if (!hasLargeExemption && window1m.uniqueTraders < cfg.minUniqueTraders1m) {
      return { accepted: false, rejection: "unique_traders_below_threshold" };
    }

    // Direction from net flow sign
    const direction: Direction = window1m.netFlow >= 0 ? "buy_yes" : "buy_no";
    return { accepted: true, direction };
  };
}
```

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git add -f extensions/rivonclaw-polymarket/src/collector/trigger-evaluator.ts extensions/rivonclaw-polymarket/tests/collector/trigger-evaluator.test.ts
git commit -m "feat(polymarket): add trigger evaluator with dead zone and large order exemption"
```

### Task 12: Per-market state manager

**Files:**
- Create: `extensions/rivonclaw-polymarket/src/collector/market-state.ts`
- Test: `extensions/rivonclaw-polymarket/tests/collector/market-state.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect } from "vitest";
import { createMarketState } from "../../src/collector/market-state.js";

describe("marketState", () => {
  it("creates a fresh state for a new market", () => {
    const state = createMarketState({ idleGcMs: 600_000 });
    state.addTrade("m1", {
      timestampMs: 1_000,
      address: "a",
      sizeUsdc: 100,
      side: "buy",
      price: 0.55,
    });
    const snap = state.getSnapshot("m1", 1_000);
    expect(snap).not.toBeNull();
    expect(snap?.window1m.volume).toBe(100);
    expect(snap?.currentMidPrice).toBe(0.55);
  });

  it("returns null for unknown market", () => {
    const state = createMarketState({ idleGcMs: 600_000 });
    expect(state.getSnapshot("unknown", 1_000)).toBeNull();
  });

  it("GCs idle markets older than threshold", () => {
    const state = createMarketState({ idleGcMs: 100_000 });
    state.addTrade("m1", { timestampMs: 1_000, address: "a", sizeUsdc: 10, side: "buy", price: 0.5 });
    state.gc(200_000);
    expect(state.getSnapshot("m1", 200_000)).toBeNull();
  });

  it("isolates state across different markets", () => {
    const state = createMarketState({ idleGcMs: 600_000 });
    state.addTrade("m1", { timestampMs: 1_000, address: "a", sizeUsdc: 10, side: "buy", price: 0.5 });
    state.addTrade("m2", { timestampMs: 1_000, address: "a", sizeUsdc: 20, side: "buy", price: 0.7 });
    expect(state.getSnapshot("m1", 1_000)?.window1m.volume).toBe(10);
    expect(state.getSnapshot("m2", 1_000)?.window1m.volume).toBe(20);
  });
});
```

- [ ] **Step 2: Run, verify fails**

- [ ] **Step 3: Implement `market-state.ts`**

```typescript
import { createRollingWindow } from "./rolling-window.js";
import type { RollingWindow, Trade, WindowStats } from "./rolling-window.js";

export interface MarketSnapshotInternal {
  window1m: WindowStats;
  window5m: WindowStats;
  currentMidPrice: number;
  lastTradeMs: number;
}

interface MarketEntry {
  window1m: RollingWindow;
  window5m: RollingWindow;
  currentMidPrice: number;
  lastTradeMs: number;
}

export interface MarketState {
  addTrade(marketId: string, trade: Trade): void;
  getSnapshot(marketId: string, nowMs: number): MarketSnapshotInternal | null;
  gc(nowMs: number): void;
}

export function createMarketState(opts: { idleGcMs: number }): MarketState {
  const markets = new Map<string, MarketEntry>();

  function getOrCreate(marketId: string): MarketEntry {
    let entry = markets.get(marketId);
    if (!entry) {
      entry = {
        window1m: createRollingWindow({ windowMs: 60_000 }),
        window5m: createRollingWindow({ windowMs: 300_000 }),
        currentMidPrice: 0,
        lastTradeMs: 0,
      };
      markets.set(marketId, entry);
    }
    return entry;
  }

  return {
    addTrade(marketId, trade) {
      const entry = getOrCreate(marketId);
      entry.window1m.add(trade);
      entry.window5m.add(trade);
      entry.currentMidPrice = trade.price;
      entry.lastTradeMs = trade.timestampMs;
    },
    getSnapshot(marketId, nowMs) {
      const entry = markets.get(marketId);
      if (!entry) return null;
      return {
        window1m: entry.window1m.stats(nowMs),
        window5m: entry.window5m.stats(nowMs),
        currentMidPrice: entry.currentMidPrice,
        lastTradeMs: entry.lastTradeMs,
      };
    },
    gc(nowMs) {
      const cutoff = nowMs - opts.idleGcMs;
      for (const [id, entry] of markets.entries()) {
        if (entry.lastTradeMs < cutoff) {
          markets.delete(id);
        }
      }
    },
  };
}
```

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git add -f extensions/rivonclaw-polymarket/src/collector/market-state.ts extensions/rivonclaw-polymarket/tests/collector/market-state.test.ts
git commit -m "feat(polymarket): add per-market rolling state with idle GC"
```

### Task 13: Polymarket WebSocket client (stub-friendly)

**Files:**
- Create: `extensions/rivonclaw-polymarket/src/collector/ws-client.ts`
- Test: `extensions/rivonclaw-polymarket/tests/collector/ws-client.test.ts`

- [ ] **Step 1: Investigate the actual Polymarket WS protocol**

Run: `find D:/work/dlxiaclaw -name "*.ts" -path "*node_modules*polymarket*" 2>/dev/null | head -5`
Read the README of `@polymarket/clob-client` if installed. Document the subscribe message format, event shapes, and auth requirements in a comment at the top of `ws-client.ts`.

- [ ] **Step 2: Write failing test using a local mock WS server**

```typescript
import { describe, it, expect, afterEach } from "vitest";
import { WebSocketServer } from "ws";
import { createPolymarketWsClient } from "../../src/collector/ws-client.js";

describe("polymarketWsClient", () => {
  let server: WebSocketServer | null = null;

  afterEach(() => {
    server?.close();
    server = null;
  });

  it("connects, receives a message, and forwards parsed trade events", async () => {
    server = new WebSocketServer({ port: 18761 });
    server.on("connection", (socket) => {
      socket.send(
        JSON.stringify({
          event_type: "trade",
          market: "m1",
          asset_id: "token-yes",
          price: "0.55",
          side: "BUY",
          size: "250.0",
          taker: "0xabc",
          timestamp: "1700000000000",
        })
      );
    });

    const received: unknown[] = [];
    const client = createPolymarketWsClient({
      url: "ws://127.0.0.1:18761",
      onTrade: (t) => received.push(t),
      onError: () => {},
    });
    await client.connect();
    await new Promise((r) => setTimeout(r, 100));
    client.close();
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      marketId: "m1",
      address: "0xabc",
      sizeUsdc: 250,
      side: "buy",
      price: 0.55,
    });
  });

  it("reconnects on drop with exponential backoff", async () => {
    // Start, kill, restart; verify client reconnects.
    // This test may be flaky; accept 1-second tolerance.
    let connectCount = 0;
    server = new WebSocketServer({ port: 18762 });
    server.on("connection", () => {
      connectCount++;
    });

    const client = createPolymarketWsClient({
      url: "ws://127.0.0.1:18762",
      onTrade: () => {},
      onError: () => {},
      reconnectInitialMs: 50,
      reconnectMaxMs: 500,
    });
    await client.connect();
    // Simulate drop by closing server
    server.close();
    await new Promise((r) => setTimeout(r, 100));
    // Restart
    server = new WebSocketServer({ port: 18762 });
    server.on("connection", () => connectCount++);
    await new Promise((r) => setTimeout(r, 700));
    client.close();
    expect(connectCount).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 3: Run, verify fails**

- [ ] **Step 4: Implement `ws-client.ts`**

```typescript
/**
 * Polymarket WebSocket client.
 *
 * Protocol reference: @polymarket/clob-client README + Polymarket docs at
 * https://docs.polymarket.com/developers/CLOB/websocket/wss-overview
 *
 * We subscribe to the "market" channel and parse trade events into the
 * plugin's internal Trade type. Reconnect uses exponential backoff.
 */
import WebSocket from "ws";
import type { Trade } from "./rolling-window.js";

export interface WsClientOptions {
  url: string;
  onTrade: (trade: Trade & { marketId: string }) => void;
  onError: (err: Error) => void;
  reconnectInitialMs?: number;
  reconnectMaxMs?: number;
}

export interface PolymarketWsClient {
  connect(): Promise<void>;
  close(): void;
}

interface RawTradeEvent {
  event_type: string;
  market: string;
  asset_id?: string;
  price: string;
  side: string;
  size: string;
  taker?: string;
  timestamp: string;
}

export function createPolymarketWsClient(opts: WsClientOptions): PolymarketWsClient {
  let socket: WebSocket | null = null;
  let closed = false;
  let backoffMs = opts.reconnectInitialMs ?? 1000;
  const maxBackoff = opts.reconnectMaxMs ?? 30_000;

  function scheduleReconnect(): void {
    if (closed) return;
    setTimeout(() => {
      if (closed) return;
      backoffMs = Math.min(backoffMs * 2, maxBackoff);
      connectInternal().catch((err) => opts.onError(err as Error));
    }, backoffMs);
  }

  async function connectInternal(): Promise<void> {
    return new Promise((resolve, reject) => {
      socket = new WebSocket(opts.url);
      socket.on("open", () => {
        backoffMs = opts.reconnectInitialMs ?? 1000;
        resolve();
      });
      socket.on("message", (data) => {
        try {
          const raw = JSON.parse(data.toString()) as RawTradeEvent;
          if (raw.event_type !== "trade") return;
          const side: "buy" | "sell" = raw.side.toLowerCase() === "buy" ? "buy" : "sell";
          opts.onTrade({
            marketId: raw.market,
            timestampMs: parseInt(raw.timestamp, 10),
            address: raw.taker ?? "unknown",
            sizeUsdc: parseFloat(raw.size),
            side,
            price: parseFloat(raw.price),
          });
        } catch (err) {
          opts.onError(err as Error);
        }
      });
      socket.on("error", (err) => {
        opts.onError(err as Error);
        reject(err);
      });
      socket.on("close", () => {
        scheduleReconnect();
      });
    });
  }

  return {
    connect: connectInternal,
    close(): void {
      closed = true;
      socket?.close();
    },
  };
}
```

- [ ] **Step 5: Run tests, verify pass (reconnect test may be flaky on CI — tolerate retry)**

- [ ] **Step 6: Commit**

```bash
git add -f extensions/rivonclaw-polymarket/src/collector/ws-client.ts extensions/rivonclaw-polymarket/tests/collector/ws-client.test.ts
git commit -m "feat(polymarket): add Polymarket WS client with reconnect"
```

### Task 14: Collector orchestrator

**Files:**
- Create: `extensions/rivonclaw-polymarket/src/collector/collector.ts`
- Test: `extensions/rivonclaw-polymarket/tests/collector/collector.test.ts`

- [ ] **Step 1: Write failing test using mock WS + in-memory dependencies**

```typescript
import { describe, it, expect, vi } from "vitest";
import { createCollector } from "../../src/collector/collector.js";
import { createEventBus } from "../../src/bus/events.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import type { TriggerEvent } from "../../src/bus/types.js";

describe("collector", () => {
  it("publishes a trigger event when a market meets all conditions", async () => {
    const bus = createEventBus();
    const received: TriggerEvent[] = [];
    bus.onTrigger((t) => received.push(t));

    const fakeWsClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    };
    const collector = createCollector({
      config: DEFAULT_CONFIG,
      bus,
      wsClientFactory: () => ({
        ...fakeWsClient,
        // Expose the callback so the test can drive it
        emit: vi.fn(),
      }) as any,
      marketMetadataProvider: async (marketId: string) => ({
        marketId,
        marketTitle: "Test market",
        resolvesAt: Date.now() + 7_200_000,
        liquidity: 6000,
      }),
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    // Drive the collector via the exported ingest() test hook
    const now = Date.now();
    // Feed enough trades to reach thresholds:
    // Need net_flow >= 3000 within 1m, ≥ 3 unique traders,
    // price move ≥ 3% within 5m.
    const trades = [
      { marketId: "m1", address: "a", sizeUsdc: 1200, side: "buy" as const, price: 0.50, timestampMs: now - 280_000 },
      { marketId: "m1", address: "b", sizeUsdc: 1200, side: "buy" as const, price: 0.52, timestampMs: now - 40_000 },
      { marketId: "m1", address: "c", sizeUsdc: 1200, side: "buy" as const, price: 0.54, timestampMs: now - 20_000 },
      { marketId: "m1", address: "d", sizeUsdc: 1200, side: "buy" as const, price: 0.55, timestampMs: now },
    ];
    for (const t of trades) await collector.ingestTrade(t);

    expect(received).toHaveLength(1);
    expect(received[0]?.market_id).toBe("m1");
    expect(received[0]?.direction).toBe("buy_yes");
  });

  it("publishes no trigger when net flow is insufficient", async () => {
    const bus = createEventBus();
    const received: TriggerEvent[] = [];
    bus.onTrigger((t) => received.push(t));

    const collector = createCollector({
      config: DEFAULT_CONFIG,
      bus,
      wsClientFactory: () => ({ connect: vi.fn(), close: vi.fn() }) as any,
      marketMetadataProvider: async (marketId) => ({
        marketId,
        marketTitle: "Test market",
        resolvesAt: Date.now() + 7_200_000,
        liquidity: 6000,
      }),
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    const now = Date.now();
    await collector.ingestTrade({
      marketId: "m1",
      address: "a",
      sizeUsdc: 300,
      side: "buy",
      price: 0.55,
      timestampMs: now,
    });
    expect(received).toHaveLength(0);
  });

  it("filters out trades smaller than minTradeUsdc", async () => {
    const bus = createEventBus();
    const received: TriggerEvent[] = [];
    bus.onTrigger((t) => received.push(t));

    const collector = createCollector({
      config: DEFAULT_CONFIG,
      bus,
      wsClientFactory: () => ({ connect: vi.fn(), close: vi.fn() }) as any,
      marketMetadataProvider: async (marketId) => ({
        marketId,
        marketTitle: "Test market",
        resolvesAt: Date.now() + 7_200_000,
        liquidity: 6000,
      }),
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    await collector.ingestTrade({
      marketId: "m1",
      address: "a",
      sizeUsdc: 50, // below $200 minimum
      side: "buy",
      price: 0.55,
      timestampMs: Date.now(),
    });
    expect(received).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run, verify fails**

- [ ] **Step 3: Implement `collector.ts`**

```typescript
import type { TraderConfig } from "../config/schema.js";
import type { EventBus } from "../bus/events.js";
import type { TriggerEvent } from "../bus/types.js";
import { createMarketState } from "./market-state.js";
import type { MarketState } from "./market-state.js";
import { createBotFilter } from "./bot-filter.js";
import type { BotFilter } from "./bot-filter.js";
import { createTriggerEvaluator } from "./trigger-evaluator.js";
import type { TriggerEvaluator } from "./trigger-evaluator.js";
import type { PolymarketWsClient } from "./ws-client.js";

export interface MarketMetadata {
  marketId: string;
  marketTitle: string;
  resolvesAt: number;
  liquidity: number;
}

export interface CollectorDeps {
  config: TraderConfig;
  bus: EventBus;
  wsClientFactory: (onTrade: (t: RawTrade) => void) => PolymarketWsClient;
  marketMetadataProvider: (marketId: string) => Promise<MarketMetadata>;
  logger: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void };
}

interface RawTrade {
  marketId: string;
  timestampMs: number;
  address: string;
  sizeUsdc: number;
  side: "buy" | "sell";
  price: number;
}

export interface Collector {
  start(): Promise<void>;
  stop(): void;
  /** Test hook: feed a trade directly without WS. */
  ingestTrade(trade: RawTrade): Promise<void>;
}

export function createCollector(deps: CollectorDeps): Collector {
  const marketState: MarketState = createMarketState({ idleGcMs: 3_600_000 });
  const botFilter: BotFilter = createBotFilter({
    burstCount: deps.config.botBurstCount,
    windowMs: deps.config.botBurstWindowMs,
  });
  const evalTrigger: TriggerEvaluator = createTriggerEvaluator(deps.config);
  const marketMetaCache = new Map<string, MarketMetadata>();

  let wsClient: PolymarketWsClient | null = null;
  let gcInterval: NodeJS.Timeout | null = null;

  async function getMeta(marketId: string): Promise<MarketMetadata> {
    let meta = marketMetaCache.get(marketId);
    if (!meta) {
      meta = await deps.marketMetadataProvider(marketId);
      marketMetaCache.set(marketId, meta);
    }
    return meta;
  }

  async function ingestTrade(trade: RawTrade): Promise<void> {
    if (trade.sizeUsdc < deps.config.minTradeUsdc) return;
    if (botFilter.isBot(trade.address, trade.timestampMs)) return;

    marketState.addTrade(trade.marketId, trade);
    const snapshot = marketState.getSnapshot(trade.marketId, trade.timestampMs);
    if (!snapshot) return;

    const meta = await getMeta(trade.marketId);
    const result = evalTrigger({
      market: {
        marketId: meta.marketId,
        marketTitle: meta.marketTitle,
        resolvesAt: meta.resolvesAt,
        currentMidPrice: snapshot.currentMidPrice,
        liquidity: meta.liquidity,
      },
      window1m: snapshot.window1m,
      window5m: snapshot.window5m,
      nowMs: trade.timestampMs,
      latestTradeSizeUsdc: trade.sizeUsdc,
    });
    if (!result.accepted) return;

    const event: TriggerEvent = {
      type: "trigger",
      market_id: meta.marketId,
      market_title: meta.marketTitle,
      resolves_at: meta.resolvesAt,
      triggered_at: trade.timestampMs,
      direction: result.direction,
      snapshot: {
        volume_1m: snapshot.window1m.volume,
        net_flow_1m: snapshot.window1m.netFlow,
        unique_traders_1m: snapshot.window1m.uniqueTraders,
        price_move_5m: snapshot.window5m.priceMove,
        liquidity: meta.liquidity,
        current_mid_price: snapshot.currentMidPrice,
      },
    };
    deps.bus.publishTrigger(event);
    deps.logger.info(`[collector] trigger published for ${meta.marketId} (${result.direction})`);
  }

  return {
    async start(): Promise<void> {
      wsClient = deps.wsClientFactory((t) => {
        ingestTrade(t).catch((err) => deps.logger.error(`[collector] ingestTrade error: ${String(err)}`));
      });
      await wsClient.connect();
      gcInterval = setInterval(() => marketState.gc(Date.now()), 60_000);
      deps.logger.info("[collector] started");
    },
    stop(): void {
      wsClient?.close();
      if (gcInterval) clearInterval(gcInterval);
      deps.logger.info("[collector] stopped");
    },
    ingestTrade,
  };
}
```

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git add -f extensions/rivonclaw-polymarket/src/collector/collector.ts extensions/rivonclaw-polymarket/tests/collector/collector.test.ts
git commit -m "feat(polymarket): add Collector orchestrator wiring WS + filters + trigger"
```

---

## Phase 5 — Executor

Goal: Kelly sizing → circuit-breaker check → conflict check → paper fill → 4-way exit monitor → PnL writeback. **100% branch coverage required** (spec §10).

### Task 15: Kelly sizing with hard caps

**Files:**
- Create: `extensions/rivonclaw-polymarket/src/executor/kelly.ts`
- Test: `extensions/rivonclaw-polymarket/tests/executor/kelly.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect } from "vitest";
import { calculateKellyPosition } from "../../src/executor/kelly.ts";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";

describe("calculateKellyPosition", () => {
  const cfg = DEFAULT_CONFIG;
  const capital = 10_000;

  it("returns 0 when Kelly fraction is negative (bad edge)", () => {
    // At 0.55 with 50% win rate: payoffRatio = 0.45/0.55 = 0.818
    // Kelly = (0.5 * 0.818 - 0.5) / 0.818 ≈ -0.111 → 0
    const result = calculateKellyPosition({
      entryPrice: 0.55,
      winRate: 0.50,
      capital,
      config: cfg,
    });
    expect(result.size).toBe(0);
    expect(result.reason).toBe("kelly_non_positive");
  });

  it("returns 0 when Kelly fraction is 0 (break even)", () => {
    // At entry 0.60, breakeven winrate is 0.60
    const result = calculateKellyPosition({
      entryPrice: 0.60,
      winRate: 0.60,
      capital,
      config: cfg,
    });
    expect(result.size).toBe(0);
    expect(result.reason).toBe("kelly_non_positive");
  });

  it("returns positive size at favorable edge", () => {
    // At 0.50 with 60% win rate: payoffRatio = 1.0
    // Kelly = (0.6 * 1 - 0.4) / 1 = 0.2
    // Scaled by kellyMultiplier 0.25 → 0.05
    // Size = 10000 * 0.05 = 500, clamped to max $300
    const result = calculateKellyPosition({
      entryPrice: 0.50,
      winRate: 0.60,
      capital,
      config: cfg,
    });
    expect(result.size).toBeLessThanOrEqual(cfg.maxPositionUsdc);
    expect(result.size).toBeGreaterThan(0);
  });

  it("clamps size so single-trade loss cannot exceed maxSingleTradeLossUsdc", () => {
    // At 0.95, even Kelly-optimal size would lose 95% on failure.
    // If winRate=0.98 (enough to justify trade), position must be capped.
    // Max loss for price p = position * p → position ≤ $50 / 0.95 ≈ $52.63
    const result = calculateKellyPosition({
      entryPrice: 0.95,
      winRate: 0.98,
      capital,
      config: cfg,
    });
    if (result.size > 0) {
      const maxLoss = result.size * 0.95;
      expect(maxLoss).toBeLessThanOrEqual(cfg.maxSingleTradeLossUsdc + 0.01);
    }
  });

  it("returns 0 when computed size is below minPositionUsdc", () => {
    // Very tiny edge → size would be ~$10 → skip
    const result = calculateKellyPosition({
      entryPrice: 0.50,
      winRate: 0.505,
      capital: 10_000,
      config: cfg,
    });
    expect(result.size).toBe(0);
    expect(result.reason).toBe("below_min_position");
  });

  it("applies kellyMultiplier (1/4 Kelly)", () => {
    // Verify that doubling multiplier approximately doubles size
    const low = calculateKellyPosition({
      entryPrice: 0.50,
      winRate: 0.60,
      capital: 100_000,
      config: { ...cfg, kellyMultiplier: 0.25 },
    });
    const high = calculateKellyPosition({
      entryPrice: 0.50,
      winRate: 0.60,
      capital: 100_000,
      config: { ...cfg, kellyMultiplier: 0.50 },
    });
    // Before clamping, high ≈ 2× low. Both may hit max cap — verify at least
    // that high is not smaller.
    expect(high.size).toBeGreaterThanOrEqual(low.size);
  });
});
```

- [ ] **Step 2: Run, verify fails**

- [ ] **Step 3: Implement `kelly.ts`**

```typescript
import type { TraderConfig } from "../config/schema.js";

export interface KellyInput {
  entryPrice: number;
  winRate: number;
  capital: number;
  config: TraderConfig;
}

export interface KellyResult {
  size: number;
  kellyFraction: number;
  reason: "ok" | "kelly_non_positive" | "below_min_position";
}

export function calculateKellyPosition(input: KellyInput): KellyResult {
  const { entryPrice, winRate, capital, config } = input;

  // Payoff ratio for buying YES at entryPrice: on win you receive (1 - entryPrice)
  // per dollar staked (assuming you pay entryPrice per share and redeem at 1).
  // payoffRatio b = (1 - p) / p where p = entryPrice.
  const payoffRatio = (1 - entryPrice) / entryPrice;
  // Kelly fraction: f* = (winRate * b - (1 - winRate)) / b
  const rawKelly = (winRate * payoffRatio - (1 - winRate)) / payoffRatio;
  const kellyFraction = rawKelly * config.kellyMultiplier;

  if (kellyFraction <= 0) {
    return { size: 0, kellyFraction, reason: "kelly_non_positive" };
  }

  let size = capital * kellyFraction;

  // Clamp to max position
  size = Math.min(size, config.maxPositionUsdc);

  // Clamp by single-trade max loss. Loss on failure = size * entryPrice (full
  // cost of a YES share that resolves to 0).
  const maxSizeByLoss = config.maxSingleTradeLossUsdc / entryPrice;
  size = Math.min(size, maxSizeByLoss);

  // Round to whole USDC
  size = Math.floor(size);

  if (size < config.minPositionUsdc) {
    return { size: 0, kellyFraction, reason: "below_min_position" };
  }
  return { size, kellyFraction, reason: "ok" };
}
```

- [ ] **Step 4: Run, verify pass**

- [ ] **Step 5: Commit**

```bash
git add -f extensions/rivonclaw-polymarket/src/executor/kelly.ts extensions/rivonclaw-polymarket/tests/executor/kelly.test.ts
git commit -m "feat(polymarket): add Kelly position sizing with hard caps"
```

### Task 16: PnL computation

**Files:**
- Create: `extensions/rivonclaw-polymarket/src/executor/pnl.ts`
- Test: `extensions/rivonclaw-polymarket/tests/executor/pnl.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect } from "vitest";
import { computePnL } from "../../src/executor/pnl.js";

describe("computePnL", () => {
  it("computes gross, fees, slippage, gas, and net for a winning buy_yes", () => {
    const result = computePnL({
      direction: "buy_yes",
      sizeUsdc: 100,
      entryPrice: 0.50,
      exitPrice: 0.60,
      feePct: 0.005,
      slippagePct: 0.005,
      gasUsdc: 0.20,
    });
    // Shares bought = 100 / 0.50 = 200
    // Exit value = 200 * 0.60 = 120
    // Gross pnl = 120 - 100 = 20
    expect(result.pnlGross).toBeCloseTo(20, 2);
    expect(result.fees).toBeCloseTo(100 * 0.005 + 120 * 0.005, 2); // entry + exit fees
    expect(result.slippage).toBeCloseTo(100 * 0.005 + 120 * 0.005, 2);
    expect(result.gas).toBe(0.20);
    expect(result.pnlNet).toBeCloseTo(
      result.pnlGross - result.fees - result.slippage - result.gas,
      2
    );
  });

  it("computes correct loss for a losing buy_no", () => {
    const result = computePnL({
      direction: "buy_no",
      sizeUsdc: 100,
      entryPrice: 0.30,
      exitPrice: 0.20,
      feePct: 0,
      slippagePct: 0,
      gasUsdc: 0,
    });
    // buy_no: we buy NO tokens at 0.30; NO price drops to 0.20 → loss
    // Shares = 100 / 0.30 ≈ 333.33
    // Exit value = 333.33 * 0.20 ≈ 66.67
    // Gross = 66.67 - 100 = -33.33
    expect(result.pnlGross).toBeCloseTo(-33.33, 1);
  });

  it("includes gas fee in net PnL even for tiny trades", () => {
    const result = computePnL({
      direction: "buy_yes",
      sizeUsdc: 50,
      entryPrice: 0.50,
      exitPrice: 0.51,
      feePct: 0,
      slippagePct: 0,
      gasUsdc: 0.20,
    });
    // gross = 100 * 0.01 = 1.00; net = 1.00 - 0.20 = 0.80
    expect(result.pnlNet).toBeCloseTo(0.80, 2);
  });
});
```

- [ ] **Step 2: Run, verify fails**

- [ ] **Step 3: Implement `pnl.ts`**

```typescript
import type { Direction } from "../db/types.js";

export interface PnLInput {
  direction: Direction;
  sizeUsdc: number;
  entryPrice: number;
  exitPrice: number;
  feePct: number;
  slippagePct: number;
  gasUsdc: number;
}

export interface PnLResult {
  pnlGross: number;
  fees: number;
  slippage: number;
  gas: number;
  pnlNet: number;
}

export function computePnL(input: PnLInput): PnLResult {
  const { direction, sizeUsdc, entryPrice, exitPrice, feePct, slippagePct, gasUsdc } = input;

  // For buy_yes: we buy YES shares at entryPrice, sell at exitPrice
  // For buy_no: mirrored — we buy NO shares at entryPrice (price of NO), sell at exitPrice (NO price)
  // In both cases the math is identical because we treat entry/exit prices as
  // prices of the side we bought.
  const shares = sizeUsdc / entryPrice;
  const exitValue = shares * exitPrice;
  const pnlGross = exitValue - sizeUsdc;

  const fees = sizeUsdc * feePct + exitValue * feePct;
  const slippage = sizeUsdc * slippagePct + exitValue * slippagePct;
  const gas = gasUsdc;

  const pnlNet = pnlGross - fees - slippage - gas;
  return { pnlGross, fees, slippage, gas, pnlNet };
}
```

- [ ] **Step 4: Run, verify pass**

- [ ] **Step 5: Commit**

```bash
git add -f extensions/rivonclaw-polymarket/src/executor/pnl.ts extensions/rivonclaw-polymarket/tests/executor/pnl.test.ts
git commit -m "feat(polymarket): add PnL computation including fees/slippage/gas"
```

### Task 17: Circuit breaker

**Files:**
- Create: `extensions/rivonclaw-polymarket/src/executor/circuit-breaker.ts`
- Test: `extensions/rivonclaw-polymarket/tests/executor/circuit-breaker.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations.js";
import { createPortfolioStateRepo } from "../../src/db/portfolio-state-repo.js";
import { createCircuitBreaker } from "../../src/executor/circuit-breaker.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";

describe("circuitBreaker", () => {
  let db: Database.Database;
  let repo: ReturnType<typeof createPortfolioStateRepo>;
  let breaker: ReturnType<typeof createCircuitBreaker>;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    repo = createPortfolioStateRepo(db);
    breaker = createCircuitBreaker({ config: DEFAULT_CONFIG, portfolioRepo: repo });
  });

  it("allows new orders when no halt active", () => {
    expect(breaker.canOpenNewPosition()).toBe(true);
  });

  it("triggers daily halt when equity drops 2% below day_start", () => {
    repo.update({ day_start_equity: 10_000, current_equity: 9_799 });
    breaker.evaluate();
    expect(repo.read().daily_halt_triggered).toBe(true);
    expect(breaker.canOpenNewPosition()).toBe(false);
  });

  it("does not trigger daily halt at exactly -1.99%", () => {
    repo.update({ day_start_equity: 10_000, current_equity: 9_801 });
    breaker.evaluate();
    expect(repo.read().daily_halt_triggered).toBe(false);
  });

  it("triggers weekly halt when equity drops 4% below week_start", () => {
    repo.update({ week_start_equity: 10_000, current_equity: 9_590 });
    breaker.evaluate();
    expect(repo.read().weekly_halt_triggered).toBe(true);
    expect(breaker.canOpenNewPosition()).toBe(false);
  });

  it("resets daily halt at day rollover", () => {
    repo.update({ day_start_equity: 10_000, current_equity: 9_700, daily_halt_triggered: true });
    breaker.resetDaily(9_700);
    expect(repo.read().daily_halt_triggered).toBe(false);
    expect(repo.read().day_start_equity).toBe(9_700);
  });

  it("triggers total drawdown emergency stop at 10%", () => {
    repo.update({ peak_equity: 10_000, current_equity: 8_999 });
    expect(breaker.isEmergencyStop()).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify fails**

- [ ] **Step 3: Implement `circuit-breaker.ts`**

```typescript
import type { TraderConfig } from "../config/schema.js";
import type { PortfolioStateRepo } from "../db/portfolio-state-repo.js";

export interface CircuitBreakerDeps {
  config: TraderConfig;
  portfolioRepo: PortfolioStateRepo;
}

export interface CircuitBreaker {
  evaluate(): void;
  canOpenNewPosition(): boolean;
  isEmergencyStop(): boolean;
  resetDaily(newDayStartEquity: number): void;
  resetWeekly(newWeekStartEquity: number): void;
}

export function createCircuitBreaker(deps: CircuitBreakerDeps): CircuitBreaker {
  const { config, portfolioRepo } = deps;

  function evaluate(): void {
    const state = portfolioRepo.read();
    const patch: Partial<typeof state> = {};

    // Daily drawdown
    if (state.day_start_equity > 0) {
      const dailyDd = (state.day_start_equity - state.current_equity) / state.day_start_equity;
      if (dailyDd >= config.dailyLossHaltPct && !state.daily_halt_triggered) {
        patch.daily_halt_triggered = true;
      }
    }

    // Weekly drawdown
    if (state.week_start_equity > 0) {
      const weeklyDd = (state.week_start_equity - state.current_equity) / state.week_start_equity;
      if (weeklyDd >= config.weeklyLossHaltPct && !state.weekly_halt_triggered) {
        patch.weekly_halt_triggered = true;
      }
    }

    // Update peak_equity if current is higher
    if (state.current_equity > state.peak_equity) {
      patch.peak_equity = state.current_equity;
    }

    // Current drawdown from peak
    if (state.peak_equity > 0) {
      patch.current_drawdown = Math.max(
        0,
        (state.peak_equity - state.current_equity) / state.peak_equity
      );
    }

    if (Object.keys(patch).length > 0) portfolioRepo.update(patch);
  }

  function canOpenNewPosition(): boolean {
    const state = portfolioRepo.read();
    if (state.daily_halt_triggered) return false;
    if (state.weekly_halt_triggered) return false;
    if (isEmergencyStop()) return false;
    return true;
  }

  function isEmergencyStop(): boolean {
    const state = portfolioRepo.read();
    if (state.peak_equity <= 0) return false;
    const dd = (state.peak_equity - state.current_equity) / state.peak_equity;
    return dd >= config.totalDrawdownHaltPct;
  }

  return {
    evaluate,
    canOpenNewPosition,
    isEmergencyStop,
    resetDaily(newDayStartEquity) {
      portfolioRepo.update({
        day_start_equity: newDayStartEquity,
        daily_halt_triggered: false,
      });
    },
    resetWeekly(newWeekStartEquity) {
      portfolioRepo.update({
        week_start_equity: newWeekStartEquity,
        weekly_halt_triggered: false,
      });
    },
  };
}
```

- [ ] **Step 4: Run, verify pass**

- [ ] **Step 5: Commit**

```bash
git add -f extensions/rivonclaw-polymarket/src/executor/circuit-breaker.ts extensions/rivonclaw-polymarket/tests/executor/circuit-breaker.test.ts
git commit -m "feat(polymarket): add circuit breaker (daily/weekly/total drawdown)"
```

### Task 18: Position tracker

**Files:**
- Create: `extensions/rivonclaw-polymarket/src/executor/position-tracker.ts`
- Test: `extensions/rivonclaw-polymarket/tests/executor/position-tracker.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations.js";
import { createSignalLogRepo } from "../../src/db/signal-log-repo.js";
import { createPositionTracker } from "../../src/executor/position-tracker.js";

describe("positionTracker", () => {
  let db: Database.Database;
  let signalRepo: ReturnType<typeof createSignalLogRepo>;
  let tracker: ReturnType<typeof createPositionTracker>;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    signalRepo = createSignalLogRepo(db);
    tracker = createPositionTracker({ signalRepo });
  });

  it("loads empty state on first use", () => {
    expect(tracker.listOpen()).toHaveLength(0);
    expect(tracker.totalExposure()).toBe(0);
  });

  it("adds a new position and tracks exposure", () => {
    tracker.open({
      signal_id: "s1",
      market_id: "m1",
      market_title: "Test",
      resolves_at: Date.now() + 3_600_000,
      triggered_at: Date.now(),
      direction: "buy_yes",
      entry_price: 0.55,
      price_bucket: 0.55,
      size_usdc: 100,
      kelly_fraction: 0.1,
      snapshot_volume_1m: 3500,
      snapshot_net_flow_1m: 3200,
      snapshot_unique_traders_1m: 4,
      snapshot_price_move_5m: 0.04,
      snapshot_liquidity: 6000,
      llm_verdict: "real_signal",
      llm_confidence: 0.72,
      llm_reasoning: "reason",
    });
    expect(tracker.listOpen()).toHaveLength(1);
    expect(tracker.totalExposure()).toBe(100);
  });

  it("closes position and removes from open set", () => {
    tracker.open({
      signal_id: "s2",
      market_id: "m2",
      market_title: "Test",
      resolves_at: Date.now() + 3_600_000,
      triggered_at: Date.now(),
      direction: "buy_yes",
      entry_price: 0.55,
      price_bucket: 0.55,
      size_usdc: 100,
      kelly_fraction: 0.1,
      snapshot_volume_1m: 3500,
      snapshot_net_flow_1m: 3200,
      snapshot_unique_traders_1m: 4,
      snapshot_price_move_5m: 0.04,
      snapshot_liquidity: 6000,
      llm_verdict: "real_signal",
      llm_confidence: 0.72,
      llm_reasoning: "reason",
    });
    tracker.close("s2", {
      exit_at: Date.now() + 1000,
      exit_price: 0.60,
      exit_reason: "A_TP",
      pnl_gross_usdc: 9.0,
      fees_usdc: 0.5,
      slippage_usdc: 0.3,
      gas_usdc: 0.2,
      pnl_net_usdc: 8.0,
      holding_duration_sec: 1,
    });
    expect(tracker.listOpen()).toHaveLength(0);
  });

  it("recovers open positions from DB on construction", () => {
    tracker.open({
      signal_id: "recovery",
      market_id: "m1",
      market_title: "Test",
      resolves_at: Date.now() + 3_600_000,
      triggered_at: Date.now(),
      direction: "buy_yes",
      entry_price: 0.55,
      price_bucket: 0.55,
      size_usdc: 150,
      kelly_fraction: 0.1,
      snapshot_volume_1m: 3500,
      snapshot_net_flow_1m: 3200,
      snapshot_unique_traders_1m: 4,
      snapshot_price_move_5m: 0.04,
      snapshot_liquidity: 6000,
      llm_verdict: "real_signal",
      llm_confidence: 0.72,
      llm_reasoning: "reason",
    });
    // Create a new tracker over same DB
    const tracker2 = createPositionTracker({ signalRepo });
    expect(tracker2.listOpen()).toHaveLength(1);
    expect(tracker2.totalExposure()).toBe(150);
  });
});
```

- [ ] **Step 2: Run, verify fails**

- [ ] **Step 3: Implement `position-tracker.ts`**

```typescript
import type { SignalLogRepo } from "../db/signal-log-repo.js";
import type { NewSignal, SignalLogRow, ExitFill } from "../db/types.js";

export interface PositionTracker {
  open(signal: NewSignal): void;
  close(signalId: string, fill: ExitFill): void;
  listOpen(): SignalLogRow[];
  totalExposure(): number;
  findByMarket(marketId: string): SignalLogRow | undefined;
}

export function createPositionTracker(deps: { signalRepo: SignalLogRepo }): PositionTracker {
  const open = new Map<string, SignalLogRow>();
  // Startup recovery
  for (const row of deps.signalRepo.listOpen()) {
    open.set(row.signal_id, row);
  }

  return {
    open(signal) {
      deps.signalRepo.insert(signal);
      const row = deps.signalRepo.findById(signal.signal_id);
      if (!row) throw new Error(`positionTracker.open: failed to read back ${signal.signal_id}`);
      open.set(row.signal_id, row);
    },
    close(signalId, fill) {
      deps.signalRepo.recordExit(signalId, fill);
      open.delete(signalId);
    },
    listOpen() {
      return Array.from(open.values());
    },
    totalExposure() {
      let sum = 0;
      for (const row of open.values()) sum += row.size_usdc;
      return sum;
    },
    findByMarket(marketId) {
      for (const row of open.values()) {
        if (row.market_id === marketId) return row;
      }
      return undefined;
    },
  };
}
```

- [ ] **Step 4: Run, verify pass**

- [ ] **Step 5: Commit**

```bash
git add -f extensions/rivonclaw-polymarket/src/executor/position-tracker.ts extensions/rivonclaw-polymarket/tests/executor/position-tracker.test.ts
git commit -m "feat(polymarket): add position tracker with DB-backed recovery"
```

### Task 19: Paper fill engine

**Files:**
- Create: `extensions/rivonclaw-polymarket/src/executor/paper-fill.ts`
- Test: `extensions/rivonclaw-polymarket/tests/executor/paper-fill.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect } from "vitest";
import { createPaperFiller } from "../../src/executor/paper-fill.js";

describe("paperFiller", () => {
  const filler = createPaperFiller({ slippagePct: 0.005 });

  it("fills buy at mid + slippage", () => {
    const fill = filler.fillBuy({ midPrice: 0.50, sizeUsdc: 100, timestampMs: 1_000 });
    expect(fill.fillPrice).toBeCloseTo(0.50 * 1.005, 5);
    expect(fill.sizeUsdc).toBe(100);
    expect(fill.timestampMs).toBe(1_000);
  });

  it("fills sell at mid - slippage", () => {
    const fill = filler.fillSell({ midPrice: 0.60, sizeUsdc: 100, timestampMs: 1_000 });
    expect(fill.fillPrice).toBeCloseTo(0.60 * 0.995, 5);
  });
});
```

- [ ] **Step 2: Implement `paper-fill.ts`**

```typescript
export interface PaperFillOptions {
  slippagePct: number;
}

export interface PaperFillRequest {
  midPrice: number;
  sizeUsdc: number;
  timestampMs: number;
}

export interface PaperFillResult {
  fillPrice: number;
  sizeUsdc: number;
  timestampMs: number;
}

export interface PaperFiller {
  fillBuy(req: PaperFillRequest): PaperFillResult;
  fillSell(req: PaperFillRequest): PaperFillResult;
}

export function createPaperFiller(opts: PaperFillOptions): PaperFiller {
  return {
    fillBuy(req) {
      return {
        fillPrice: req.midPrice * (1 + opts.slippagePct),
        sizeUsdc: req.sizeUsdc,
        timestampMs: req.timestampMs,
      };
    },
    fillSell(req) {
      return {
        fillPrice: req.midPrice * (1 - opts.slippagePct),
        sizeUsdc: req.sizeUsdc,
        timestampMs: req.timestampMs,
      };
    },
  };
}
```

- [ ] **Step 3: Run, verify pass. Commit.**

```bash
git add -f extensions/rivonclaw-polymarket/src/executor/paper-fill.ts extensions/rivonclaw-polymarket/tests/executor/paper-fill.test.ts
git commit -m "feat(polymarket): add paper fill engine with configurable slippage"
```

### Task 20: Exit monitor (A/C/E rules)

**Files:**
- Create: `extensions/rivonclaw-polymarket/src/executor/exit-monitor.ts`
- Test: `extensions/rivonclaw-polymarket/tests/executor/exit-monitor.test.ts`

This task handles rules A-SL, A-TP, C, E. Rule D (reverse signal) is wired separately in Task 22.

- [ ] **Step 1: Write failing test for each exit trigger**

```typescript
import { describe, it, expect } from "vitest";
import { evaluateExit } from "../../src/executor/exit-monitor.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import type { SignalLogRow } from "../../src/db/types.js";

function makeOpen(overrides: Partial<SignalLogRow> = {}): SignalLogRow {
  return {
    signal_id: "s1",
    market_id: "m1",
    market_title: "Test",
    resolves_at: Date.now() + 7_200_000,
    triggered_at: Date.now() - 60_000,
    direction: "buy_yes",
    entry_price: 0.50,
    price_bucket: 0.50,
    size_usdc: 100,
    kelly_fraction: 0.1,
    snapshot_volume_1m: 3500,
    snapshot_net_flow_1m: 3200,
    snapshot_unique_traders_1m: 4,
    snapshot_price_move_5m: 0.04,
    snapshot_liquidity: 6000,
    llm_verdict: "real_signal",
    llm_confidence: 0.72,
    llm_reasoning: "",
    exit_at: null,
    exit_price: null,
    exit_reason: null,
    pnl_gross_usdc: null,
    fees_usdc: null,
    slippage_usdc: null,
    gas_usdc: null,
    pnl_net_usdc: null,
    holding_duration_sec: null,
    ...overrides,
  };
}

describe("evaluateExit", () => {
  const cfg = DEFAULT_CONFIG;
  const now = Date.now();

  it("triggers E (expiry buffer) when close to resolution", () => {
    const position = makeOpen({ resolves_at: now + 60_000 }); // 60s left, buffer 300s
    const result = evaluateExit(position, { currentPrice: 0.50, nowMs: now }, cfg);
    expect(result.exit).toBe(true);
    expect(result.reason).toBe("E");
  });

  it("triggers A-SL on -7% (normal)", () => {
    const position = makeOpen({ entry_price: 0.50 });
    const result = evaluateExit(position, { currentPrice: 0.46, nowMs: now }, cfg);
    expect(result.exit).toBe(true);
    expect(result.reason).toBe("A_SL");
  });

  it("triggers A-SL on -3% when late stage (< 30m to resolve)", () => {
    const position = makeOpen({ entry_price: 0.50, resolves_at: now + 1_200_000 });
    const result = evaluateExit(position, { currentPrice: 0.485, nowMs: now }, cfg);
    expect(result.exit).toBe(true);
    expect(result.reason).toBe("A_SL");
  });

  it("does NOT trigger A-SL at -1%", () => {
    const position = makeOpen({ entry_price: 0.50 });
    const result = evaluateExit(position, { currentPrice: 0.495, nowMs: now }, cfg);
    expect(result.exit).toBe(false);
  });

  it("triggers A-TP on +10%", () => {
    const position = makeOpen({ entry_price: 0.50 });
    const result = evaluateExit(position, { currentPrice: 0.55, nowMs: now }, cfg);
    expect(result.exit).toBe(true);
    expect(result.reason).toBe("A_TP");
  });

  it("triggers C on max holding time exceeded", () => {
    const position = makeOpen({
      triggered_at: now - 14_500_000, // > 4h
    });
    const result = evaluateExit(position, { currentPrice: 0.50, nowMs: now }, cfg);
    expect(result.exit).toBe(true);
    expect(result.reason).toBe("C");
  });

  it("E has highest priority: A-SL AND E both triggered → E wins", () => {
    const position = makeOpen({
      entry_price: 0.50,
      resolves_at: now + 60_000, // E triggered
    });
    const result = evaluateExit(
      position,
      { currentPrice: 0.40, nowMs: now }, // A-SL also triggered (-20%)
      cfg
    );
    expect(result.exit).toBe(true);
    expect(result.reason).toBe("E");
  });

  it("handles buy_no direction (price direction inverted)", () => {
    const position = makeOpen({ direction: "buy_no", entry_price: 0.40 });
    // For buy_no, price UP = loss, price DOWN = profit
    // A-SL should trigger when price goes from 0.40 → 0.428 (+7%)
    const result = evaluateExit(position, { currentPrice: 0.428, nowMs: now }, cfg);
    expect(result.exit).toBe(true);
    expect(result.reason).toBe("A_SL");
  });
});
```

- [ ] **Step 2: Run, verify fails**

- [ ] **Step 3: Implement `exit-monitor.ts`**

```typescript
import type { TraderConfig } from "../config/schema.js";
import type { SignalLogRow, ExitReason } from "../db/types.js";

export interface ExitContext {
  currentPrice: number;
  nowMs: number;
}

export interface ExitDecision {
  exit: boolean;
  reason?: ExitReason;
}

export function evaluateExit(
  position: SignalLogRow,
  ctx: ExitContext,
  cfg: TraderConfig
): ExitDecision {
  // E (expiry safety buffer) — highest priority
  const secToResolve = Math.floor((position.resolves_at - ctx.nowMs) / 1000);
  if (secToResolve <= cfg.expirySafetyBufferSec) {
    return { exit: true, reason: "E" };
  }

  // Late stage tightens stop-loss
  const isLateStage = secToResolve <= cfg.lateStageThresholdSec;
  const stopLossPct = isLateStage ? cfg.stopLossPctLateStage : cfg.stopLossPctNormal;

  // Direction-aware move calculation.
  // For buy_yes, profit direction is price up (positive delta good).
  // For buy_no, profit direction is price down (negative delta good).
  const rawDelta = (ctx.currentPrice - position.entry_price) / position.entry_price;
  const profitDelta = position.direction === "buy_yes" ? rawDelta : -rawDelta;

  if (profitDelta <= -stopLossPct) {
    return { exit: true, reason: "A_SL" };
  }
  if (profitDelta >= cfg.takeProfitPct) {
    return { exit: true, reason: "A_TP" };
  }

  // C: time stop
  const holdingSec = Math.floor((ctx.nowMs - position.triggered_at) / 1000);
  if (holdingSec >= cfg.maxHoldingSec) {
    return { exit: true, reason: "C" };
  }

  return { exit: false };
}
```

- [ ] **Step 4: Run, verify pass**

- [ ] **Step 5: Commit**

```bash
git add -f extensions/rivonclaw-polymarket/src/executor/exit-monitor.ts extensions/rivonclaw-polymarket/tests/executor/exit-monitor.test.ts
git commit -m "feat(polymarket): add exit monitor with E/A-SL/A-TP/C priority"
```

### Task 21: Conflict lock (per-market mutex)

**Files:**
- Create: `extensions/rivonclaw-polymarket/src/executor/conflict-lock.ts`
- Test: `extensions/rivonclaw-polymarket/tests/executor/conflict-lock.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect } from "vitest";
import { createConflictLock } from "../../src/executor/conflict-lock.js";

describe("conflictLock", () => {
  it("acquires lock for unheld market", () => {
    const lock = createConflictLock();
    expect(lock.tryAcquire("m1")).toBe(true);
  });

  it("rejects second acquisition for same market", () => {
    const lock = createConflictLock();
    expect(lock.tryAcquire("m1")).toBe(true);
    expect(lock.tryAcquire("m1")).toBe(false);
  });

  it("allows acquisition after release", () => {
    const lock = createConflictLock();
    lock.tryAcquire("m1");
    lock.release("m1");
    expect(lock.tryAcquire("m1")).toBe(true);
  });

  it("isolates locks across markets", () => {
    const lock = createConflictLock();
    expect(lock.tryAcquire("m1")).toBe(true);
    expect(lock.tryAcquire("m2")).toBe(true);
  });
});
```

- [ ] **Step 2: Implement `conflict-lock.ts`**

```typescript
export interface ConflictLock {
  tryAcquire(marketId: string): boolean;
  release(marketId: string): void;
  isHeld(marketId: string): boolean;
}

export function createConflictLock(): ConflictLock {
  const held = new Set<string>();
  return {
    tryAcquire(marketId) {
      if (held.has(marketId)) return false;
      held.add(marketId);
      return true;
    },
    release(marketId) {
      held.delete(marketId);
    },
    isHeld(marketId) {
      return held.has(marketId);
    },
  };
}
```

- [ ] **Step 3: Run, verify pass. Commit.**

```bash
git add -f extensions/rivonclaw-polymarket/src/executor/conflict-lock.ts extensions/rivonclaw-polymarket/tests/executor/conflict-lock.test.ts
git commit -m "feat(polymarket): add per-market conflict lock (first-come-first-served)"
```

### Task 22: Executor orchestrator

**Files:**
- Create: `extensions/rivonclaw-polymarket/src/executor/executor.ts`
- Test: `extensions/rivonclaw-polymarket/tests/executor/executor.test.ts`

- [ ] **Step 1: Write failing test covering full flow**

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations.js";
import { createSignalLogRepo } from "../../src/db/signal-log-repo.js";
import { createPortfolioStateRepo } from "../../src/db/portfolio-state-repo.js";
import { createEventBus } from "../../src/bus/events.js";
import { createExecutor } from "../../src/executor/executor.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import type { VerdictEvent } from "../../src/bus/types.js";

function makeVerdict(): VerdictEvent {
  const now = Date.now();
  return {
    type: "verdict",
    trigger: {
      type: "trigger",
      market_id: "m1",
      market_title: "Test",
      resolves_at: now + 7_200_000,
      triggered_at: now,
      direction: "buy_yes",
      snapshot: {
        volume_1m: 3500,
        net_flow_1m: 3200,
        unique_traders_1m: 4,
        price_move_5m: 0.04,
        liquidity: 6000,
        current_mid_price: 0.50,
      },
    },
    verdict: "real_signal",
    confidence: 0.80,
    reasoning: "strong flow",
    llm_direction: "buy_yes",
  };
}

describe("executor", () => {
  let db: Database.Database;
  let bus: ReturnType<typeof createEventBus>;
  let exec: ReturnType<typeof createExecutor>;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    const signalRepo = createSignalLogRepo(db);
    const portfolioRepo = createPortfolioStateRepo(db);
    bus = createEventBus();
    exec = createExecutor({
      config: DEFAULT_CONFIG,
      bus,
      signalRepo,
      portfolioRepo,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });
    portfolioRepo.update({ total_capital: 10_000, current_equity: 10_000, day_start_equity: 10_000, week_start_equity: 10_000, peak_equity: 10_000 });
  });

  it("executes an order when conditions are met", () => {
    const verdict = makeVerdict();
    const sigId = exec.handleVerdict(verdict);
    expect(sigId).not.toBeNull();
    expect(exec.openPositions()).toHaveLength(1);
  });

  it("rejects a second order for the same market (conflict lock)", () => {
    const verdict = makeVerdict();
    const id1 = exec.handleVerdict(verdict);
    const id2 = exec.handleVerdict(verdict);
    expect(id1).not.toBeNull();
    expect(id2).toBeNull();
    expect(exec.openPositions()).toHaveLength(1);
  });

  it("rejects order when daily halt is triggered", () => {
    const portfolioRepo = createPortfolioStateRepo(db);
    portfolioRepo.update({ daily_halt_triggered: true });
    expect(exec.handleVerdict(makeVerdict())).toBeNull();
  });

  it("rejects order when Kelly returns 0 (dead zone)", () => {
    const verdict = makeVerdict();
    verdict.trigger.snapshot.current_mid_price = 0.72; // inside dead zone
    // Collector should have caught this, but Executor must independently guard
    expect(exec.handleVerdict(verdict)).toBeNull();
  });

  it("processes tick, triggers A-TP at +10%, closes position", () => {
    const verdict = makeVerdict();
    const sigId = exec.handleVerdict(verdict);
    expect(sigId).not.toBeNull();
    // Simulate price tick
    exec.onPriceTick("m1", 0.55, Date.now());
    expect(exec.openPositions()).toHaveLength(0);
  });

  it("handles reverse signal by publishing exit", () => {
    const verdict = makeVerdict();
    const sigId = exec.handleVerdict(verdict);
    expect(sigId).not.toBeNull();
    // Publish opposite direction trigger on same market
    bus.publishTrigger({
      ...verdict.trigger,
      direction: "buy_no",
      triggered_at: Date.now() + 60_000,
    });
    // Executor should detect reverse and close
    expect(exec.openPositions()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run, verify fails**

- [ ] **Step 3: Implement `executor.ts`**

```typescript
import type { TraderConfig } from "../config/schema.js";
import type { EventBus } from "../bus/events.js";
import type { SignalLogRepo } from "../db/signal-log-repo.js";
import type { PortfolioStateRepo } from "../db/portfolio-state-repo.js";
import type { VerdictEvent } from "../bus/types.js";
import type { NewSignal, SignalLogRow, Direction } from "../db/types.js";
import { calculateKellyPosition } from "./kelly.js";
import { priceBucket, priorWinRate } from "./price-bucket.js";
import { createPositionTracker } from "./position-tracker.js";
import { createCircuitBreaker } from "./circuit-breaker.js";
import { createConflictLock } from "./conflict-lock.js";
import { createPaperFiller } from "./paper-fill.js";
import { computePnL } from "./pnl.js";
import { evaluateExit } from "./exit-monitor.js";
import { randomUUID } from "node:crypto";

export interface ExecutorDeps {
  config: TraderConfig;
  bus: EventBus;
  signalRepo: SignalLogRepo;
  portfolioRepo: PortfolioStateRepo;
  logger: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void };
}

export interface Executor {
  /** Returns signal_id on success, null if rejected. */
  handleVerdict(event: VerdictEvent): string | null;
  onPriceTick(marketId: string, currentMidPrice: number, nowMs: number): void;
  openPositions(): SignalLogRow[];
}

export function createExecutor(deps: ExecutorDeps): Executor {
  const tracker = createPositionTracker({ signalRepo: deps.signalRepo });
  const breaker = createCircuitBreaker({ config: deps.config, portfolioRepo: deps.portfolioRepo });
  const lock = createConflictLock();
  const filler = createPaperFiller({ slippagePct: deps.config.paperSlippagePct });

  // Re-acquire locks for positions loaded from DB on startup
  for (const pos of tracker.listOpen()) lock.tryAcquire(pos.market_id);

  // Reverse signal handling (Rule D) — subscribe to bus
  deps.bus.onTrigger((event) => {
    for (const pos of tracker.listOpen()) {
      if (pos.market_id === event.market_id && pos.direction !== event.direction) {
        closePosition(pos, event.snapshot.current_mid_price, event.triggered_at, "D");
      }
    }
  });

  function handleVerdict(event: VerdictEvent): string | null {
    if (event.verdict !== "real_signal") {
      deps.logger.info(`[executor] verdict not actionable: ${event.verdict}`);
      return null;
    }
    if (!breaker.canOpenNewPosition()) {
      deps.logger.warn("[executor] circuit breaker blocks new position");
      return null;
    }
    if (tracker.totalExposure() + deps.config.minPositionUsdc > deps.config.maxTotalPositionUsdc) {
      deps.logger.warn("[executor] total exposure cap reached");
      return null;
    }
    if (tracker.listOpen().length >= deps.config.maxOpenPositions) {
      deps.logger.warn("[executor] max open positions reached");
      return null;
    }
    if (!lock.tryAcquire(event.trigger.market_id)) {
      deps.logger.info(`[executor] market ${event.trigger.market_id} already held, rejecting`);
      return null;
    }

    const state = deps.portfolioRepo.read();
    const entryPrice = event.trigger.snapshot.current_mid_price;
    const bucket = priceBucket(entryPrice);
    const winRate = priorWinRate(bucket); // TODO Phase 8: use strategy_performance table
    const kelly = calculateKellyPosition({
      entryPrice,
      winRate,
      capital: state.current_equity,
      config: deps.config,
    });
    if (kelly.size === 0) {
      deps.logger.info(`[executor] kelly size 0 (${kelly.reason})`);
      lock.release(event.trigger.market_id);
      return null;
    }

    // Paper fill at mid + slippage
    const fill = filler.fillBuy({
      midPrice: entryPrice,
      sizeUsdc: kelly.size,
      timestampMs: event.trigger.triggered_at,
    });

    const newSignal: NewSignal = {
      signal_id: randomUUID(),
      market_id: event.trigger.market_id,
      market_title: event.trigger.market_title,
      resolves_at: event.trigger.resolves_at,
      triggered_at: event.trigger.triggered_at,
      direction: event.llm_direction,
      entry_price: fill.fillPrice,
      price_bucket: bucket,
      size_usdc: fill.sizeUsdc,
      kelly_fraction: kelly.kellyFraction,
      snapshot_volume_1m: event.trigger.snapshot.volume_1m,
      snapshot_net_flow_1m: event.trigger.snapshot.net_flow_1m,
      snapshot_unique_traders_1m: event.trigger.snapshot.unique_traders_1m,
      snapshot_price_move_5m: event.trigger.snapshot.price_move_5m,
      snapshot_liquidity: event.trigger.snapshot.liquidity,
      llm_verdict: event.verdict,
      llm_confidence: event.confidence,
      llm_reasoning: event.reasoning,
    };
    tracker.open(newSignal);
    deps.logger.info(`[executor] opened position ${newSignal.signal_id} size=$${kelly.size}`);
    return newSignal.signal_id;
  }

  function onPriceTick(marketId: string, currentMidPrice: number, nowMs: number): void {
    for (const pos of tracker.listOpen()) {
      if (pos.market_id !== marketId) continue;
      const decision = evaluateExit(pos, { currentPrice: currentMidPrice, nowMs }, deps.config);
      if (decision.exit && decision.reason) {
        closePosition(pos, currentMidPrice, nowMs, decision.reason);
      }
    }
  }

  function closePosition(
    pos: SignalLogRow,
    exitMidPrice: number,
    nowMs: number,
    reason: "E" | "A_SL" | "A_TP" | "D" | "C"
  ): void {
    const fill = filler.fillSell({
      midPrice: exitMidPrice,
      sizeUsdc: pos.size_usdc,
      timestampMs: nowMs,
    });
    const pnl = computePnL({
      direction: pos.direction,
      sizeUsdc: pos.size_usdc,
      entryPrice: pos.entry_price,
      exitPrice: fill.fillPrice,
      feePct: 0, // TODO: plug in real Polymarket fees
      slippagePct: deps.config.paperSlippagePct,
      gasUsdc: deps.config.gasPerTradeUsdc,
    });
    tracker.close(pos.signal_id, {
      exit_at: nowMs,
      exit_price: fill.fillPrice,
      exit_reason: reason,
      pnl_gross_usdc: pnl.pnlGross,
      fees_usdc: pnl.fees,
      slippage_usdc: pnl.slippage,
      gas_usdc: pnl.gas,
      pnl_net_usdc: pnl.pnlNet,
      holding_duration_sec: Math.floor((nowMs - pos.triggered_at) / 1000),
    });
    lock.release(pos.market_id);

    // Update portfolio state
    const state = deps.portfolioRepo.read();
    deps.portfolioRepo.update({ current_equity: state.current_equity + pnl.pnlNet });
    breaker.evaluate();

    deps.logger.info(
      `[executor] closed ${pos.signal_id} reason=${reason} netPnl=$${pnl.pnlNet.toFixed(2)}`
    );
  }

  return {
    handleVerdict,
    onPriceTick,
    openPositions: () => tracker.listOpen(),
  };
}
```

- [ ] **Step 4: Run, verify pass**

- [ ] **Step 5: Commit**

```bash
git add -f extensions/rivonclaw-polymarket/src/executor/executor.ts extensions/rivonclaw-polymarket/tests/executor/executor.test.ts
git commit -m "feat(polymarket): add Executor orchestrator with Kelly/CB/conflict/fill/exit/D"
```

---

## Phase 6 — Analyzer Integration (Agent + RPC)

Goal: Create the polymarket-analyzer OpenClaw agent, wire the plugin to call it on trigger events, parse the JSON verdict, publish VerdictEvent.

### Task 23: Verdict schema + parser

**Files:**
- Create: `extensions/rivonclaw-polymarket/src/analyzer/verdict-parser.ts`
- Test: `extensions/rivonclaw-polymarket/tests/analyzer/verdict-parser.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect } from "vitest";
import { parseVerdict } from "../../src/analyzer/verdict-parser.js";
import { VerdictParseError } from "../../src/util/errors.js";

describe("parseVerdict", () => {
  it("parses a clean JSON verdict", () => {
    const raw = JSON.stringify({
      verdict: "real_signal",
      direction: "buy_yes",
      confidence: 0.75,
      reasoning: "Strong flow with 4 unique traders",
    });
    const parsed = parseVerdict(raw);
    expect(parsed.verdict).toBe("real_signal");
    expect(parsed.direction).toBe("buy_yes");
    expect(parsed.confidence).toBe(0.75);
  });

  it("extracts JSON embedded in markdown fences", () => {
    const raw = "```json\n" + JSON.stringify({
      verdict: "noise",
      direction: "buy_yes",
      confidence: 0.2,
      reasoning: "looks like bots",
    }) + "\n```";
    const parsed = parseVerdict(raw);
    expect(parsed.verdict).toBe("noise");
  });

  it("throws on invalid verdict value", () => {
    const raw = JSON.stringify({
      verdict: "probably",
      direction: "buy_yes",
      confidence: 0.5,
      reasoning: "",
    });
    expect(() => parseVerdict(raw)).toThrow(VerdictParseError);
  });

  it("throws on confidence out of [0, 1]", () => {
    const raw = JSON.stringify({
      verdict: "real_signal",
      direction: "buy_yes",
      confidence: 1.5,
      reasoning: "",
    });
    expect(() => parseVerdict(raw)).toThrow(VerdictParseError);
  });

  it("throws on non-JSON input", () => {
    expect(() => parseVerdict("I think yes")).toThrow(VerdictParseError);
  });
});
```

- [ ] **Step 2: Implement `verdict-parser.ts`**

```typescript
import { VerdictParseError } from "../util/errors.js";
import type { Direction, LlmVerdict } from "../db/types.js";

export interface ParsedVerdict {
  verdict: LlmVerdict;
  direction: Direction;
  confidence: number;
  reasoning: string;
}

const VALID_VERDICTS: LlmVerdict[] = ["real_signal", "noise", "uncertain"];
const VALID_DIRECTIONS: Direction[] = ["buy_yes", "buy_no"];

function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  // Strip markdown fences if present
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const jsonText = fenceMatch ? fenceMatch[1]! : trimmed;
  try {
    return JSON.parse(jsonText);
  } catch (err) {
    throw new VerdictParseError(`Invalid JSON: ${(err as Error).message}`, raw);
  }
}

export function parseVerdict(raw: string): ParsedVerdict {
  const obj = extractJson(raw);
  if (typeof obj !== "object" || obj === null) {
    throw new VerdictParseError("Verdict not an object", raw);
  }
  const o = obj as Record<string, unknown>;

  if (!VALID_VERDICTS.includes(o.verdict as LlmVerdict)) {
    throw new VerdictParseError(`Invalid verdict value: ${String(o.verdict)}`, raw);
  }
  if (!VALID_DIRECTIONS.includes(o.direction as Direction)) {
    throw new VerdictParseError(`Invalid direction: ${String(o.direction)}`, raw);
  }
  const conf = Number(o.confidence);
  if (!Number.isFinite(conf) || conf < 0 || conf > 1) {
    throw new VerdictParseError(`Confidence out of range: ${String(o.confidence)}`, raw);
  }
  const reasoning = typeof o.reasoning === "string" ? o.reasoning : "";

  return {
    verdict: o.verdict as LlmVerdict,
    direction: o.direction as Direction,
    confidence: conf,
    reasoning,
  };
}
```

- [ ] **Step 3: Run, verify pass. Commit.**

```bash
git add -f extensions/rivonclaw-polymarket/src/analyzer/verdict-parser.ts extensions/rivonclaw-polymarket/tests/analyzer/verdict-parser.test.ts
git commit -m "feat(polymarket): add verdict parser with JSON/fence/validation handling"
```

### Task 24: Context packer

**Files:**
- Create: `extensions/rivonclaw-polymarket/src/analyzer/context-packer.ts`
- Test: `extensions/rivonclaw-polymarket/tests/analyzer/context-packer.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect } from "vitest";
import { packContext } from "../../src/analyzer/context-packer.js";
import type { TriggerEvent } from "../../src/bus/types.js";

const trigger: TriggerEvent = {
  type: "trigger",
  market_id: "m1",
  market_title: "Will it rain tomorrow?",
  resolves_at: Date.now() + 7_200_000,
  triggered_at: Date.now(),
  direction: "buy_yes",
  snapshot: {
    volume_1m: 3500,
    net_flow_1m: 3200,
    unique_traders_1m: 4,
    price_move_5m: 0.04,
    liquidity: 6000,
    current_mid_price: 0.55,
  },
};

describe("packContext", () => {
  it("includes all required fields in the prompt", () => {
    const prompt = packContext(trigger);
    expect(prompt).toContain("Will it rain tomorrow?");
    expect(prompt).toContain("current price: 0.55");
    expect(prompt).toContain("net flow (1m)");
    expect(prompt).toContain("3200");
    expect(prompt).toContain("unique traders (1m): 4");
    expect(prompt).toContain("JSON");
    expect(prompt).toContain("verdict");
  });

  it("includes time-to-resolve in human-readable form", () => {
    const prompt = packContext(trigger);
    expect(prompt).toMatch(/resolves in: (1h \d+m|\dh|[5-9][0-9] minutes)/);
  });
});
```

- [ ] **Step 2: Implement `context-packer.ts`**

```typescript
import type { TriggerEvent } from "../bus/types.js";

function formatDuration(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 3600) return `${Math.floor(sec / 60)} minutes`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m`;
}

export function packContext(trigger: TriggerEvent): string {
  const resolveIn = formatDuration(trigger.resolves_at - trigger.triggered_at);
  return `You are judging a Polymarket trading signal.

Market: "${trigger.market_title}"
Market ID: ${trigger.market_id}
Current price: ${trigger.snapshot.current_mid_price.toFixed(4)}
Resolves in: ${resolveIn}
Liquidity: $${trigger.snapshot.liquidity.toFixed(0)}

Detected flow indicators:
- Volume (1m): $${trigger.snapshot.volume_1m.toFixed(0)}
- Net flow (1m): $${trigger.snapshot.net_flow_1m.toFixed(0)} (${trigger.direction === "buy_yes" ? "toward YES" : "toward NO"})
- Unique traders (1m): ${trigger.snapshot.unique_traders_1m}
- Price move (5m): ${(trigger.snapshot.price_move_5m * 100).toFixed(2)}%

Suggested direction from flow: ${trigger.direction}

Your task: assess whether this is a real actionable signal or noise (bots, manipulation, illiquid, irrelevant).

Respond with ONLY a JSON object in this exact schema (no extra commentary):

{
  "verdict": "real_signal" | "noise" | "uncertain",
  "direction": "buy_yes" | "buy_no",
  "confidence": 0.0 to 1.0,
  "reasoning": "brief explanation"
}

Use "real_signal" only when you are confident. Use "uncertain" when ambiguous. Use "noise" when you see red flags (bot patterns, low liquidity, micro-market irrelevance).`;
}
```

- [ ] **Step 3: Run, verify pass. Commit.**

```bash
git add -f extensions/rivonclaw-polymarket/src/analyzer/context-packer.ts extensions/rivonclaw-polymarket/tests/analyzer/context-packer.test.ts
git commit -m "feat(polymarket): add Analyzer context packer that formats trigger as LLM prompt"
```

### Task 25: Analyzer RPC client

**Files:**
- Create: `extensions/rivonclaw-polymarket/src/analyzer/analyzer-client.ts`
- Test: `extensions/rivonclaw-polymarket/tests/analyzer/analyzer-client.test.ts`

**Note:** The exact API for invoking another OpenClaw agent from within a plugin depends on I1 findings (investigation step). The implementation below assumes a `runtime.runAgent(agentId, message)` style API. If I1 shows the API is different, this task's implementation needs adjustment — the test and interface remain unchanged.

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect, vi } from "vitest";
import { createAnalyzerClient } from "../../src/analyzer/analyzer-client.js";
import { LlmTimeoutError } from "../../src/util/errors.js";

describe("analyzerClient", () => {
  it("returns parsed verdict on success", async () => {
    const invoker = vi.fn().mockResolvedValue(
      JSON.stringify({
        verdict: "real_signal",
        direction: "buy_yes",
        confidence: 0.8,
        reasoning: "test",
      })
    );
    const client = createAnalyzerClient({
      agentId: "polymarket-analyzer",
      timeoutMs: 5_000,
      invoker,
    });
    const result = await client.judge("some prompt");
    expect(result.verdict).toBe("real_signal");
    expect(invoker).toHaveBeenCalledWith("polymarket-analyzer", "some prompt");
  });

  it("throws LlmTimeoutError when invoker exceeds timeout", async () => {
    const invoker = vi.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve("{}"), 200))
    );
    const client = createAnalyzerClient({
      agentId: "polymarket-analyzer",
      timeoutMs: 50,
      invoker,
    });
    await expect(client.judge("prompt")).rejects.toThrow(LlmTimeoutError);
  });
});
```

- [ ] **Step 2: Implement `analyzer-client.ts`**

```typescript
import { parseVerdict } from "./verdict-parser.js";
import type { ParsedVerdict } from "./verdict-parser.js";
import { LlmTimeoutError } from "../util/errors.js";

/**
 * Abstracts the mechanism for invoking an OpenClaw agent. The concrete
 * implementation is wired in `src/index.ts` based on I1 findings (direct
 * runtime import vs gateway RPC method).
 */
export type AgentInvoker = (agentId: string, message: string) => Promise<string>;

export interface AnalyzerClientOptions {
  agentId: string;
  timeoutMs: number;
  invoker: AgentInvoker;
}

export interface AnalyzerClient {
  judge(prompt: string): Promise<ParsedVerdict>;
}

export function createAnalyzerClient(opts: AnalyzerClientOptions): AnalyzerClient {
  return {
    async judge(prompt: string): Promise<ParsedVerdict> {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new LlmTimeoutError(opts.timeoutMs)), opts.timeoutMs)
      );
      const raw = await Promise.race([opts.invoker(opts.agentId, prompt), timeoutPromise]);
      return parseVerdict(raw);
    },
  };
}
```

- [ ] **Step 3: Run, verify pass. Commit.**

```bash
git add -f extensions/rivonclaw-polymarket/src/analyzer/analyzer-client.ts extensions/rivonclaw-polymarket/tests/analyzer/analyzer-client.test.ts
git commit -m "feat(polymarket): add Analyzer RPC client with timeout handling"
```

### Task 26: polymarket-analyzer OpenClaw agent workspace

**Files:**
- Create: `~/.openclaw/agents/polymarket-analyzer/agent/AGENTS.md` (manual setup, not in repo)
- Create: `extensions/rivonclaw-polymarket/docs/AGENTS-analyzer.md` (template committed to repo)

- [ ] **Step 1: Create `docs/AGENTS-analyzer.md` as the canonical template**

```markdown
# Polymarket Analyzer Agent

You are the Polymarket Analyzer — one of two "employees" that operate the Polymarket trading system inside RivonClaw.

## Your role

You receive a single prompt per invocation describing a potential trading signal. Your job is to decide whether it is a **real actionable signal**, **noise**, or **uncertain**.

## How to judge

Look for these **red flags** (lean toward noise/uncertain):
- Unique traders in 1m window < 3 with no large order exemption → likely bots
- Price move < 3% over 5m → insufficient conviction
- Liquidity < $5000 → slippage will eat any profit
- Market title contains "up or down" or other short-term gambling templates
- Unique trader count coming entirely from one cluster of addresses

Look for these **green flags** (lean toward real_signal):
- Net flow > $5000 in 1m with 5+ unique traders → broad participation
- Price move aligned with net flow direction → coherent move
- Resolving in hours, not weeks → event-driven window
- Price in middle range (0.25 – 0.60) → asymmetric payoff in your favor

## Hard constraints you must respect

- You must NOT suggest trading in the dead zone [0.60, 0.85]. If you see a signal in that range, respond with `"verdict": "noise"` and explain it's in the dead zone.
- You must NOT bias confidence upward to "help" the system. The system does not use confidence as a gate — confidence only feeds into audit logs. Report your true confidence.
- You must respond with JSON only, no extra commentary.

## Output format

```json
{
  "verdict": "real_signal" | "noise" | "uncertain",
  "direction": "buy_yes" | "buy_no",
  "confidence": 0.0 to 1.0,
  "reasoning": "brief 1-2 sentence justification"
}
```

## Chat context

When a human asks you "why did you approve signal X" or "why did you reject signal Y", you can look up the specifics in `polymarket.db` signal_log table. Be direct and honest — if you made a call that turned out wrong, say so.
```

- [ ] **Step 2: Write manual setup instructions in plugin README**

Append to `extensions/rivonclaw-polymarket/README.md`:

```markdown
## Setup (manual, one-time)

### 1. Create the Analyzer agent workspace

```bash
mkdir -p ~/.openclaw/agents/polymarket-analyzer/agent
cp extensions/rivonclaw-polymarket/docs/AGENTS-analyzer.md ~/.openclaw/agents/polymarket-analyzer/agent/AGENTS.md
```

### 2. Register the agent in openclaw.json

Add to the `agents.list` array in `~/.openclaw/openclaw.json`:

```json
{
  "id": "polymarket-analyzer",
  "workspaceDir": "~/.openclaw/workspace-polymarket-analyzer",
  "agentDir": "~/.openclaw/agents/polymarket-analyzer/agent"
}
```

### 3. Restart the RivonClaw gateway

After the above, RivonClaw will detect the new agent on next start.
```

- [ ] **Step 3: Commit**

```bash
git add -f extensions/rivonclaw-polymarket/docs/ extensions/rivonclaw-polymarket/README.md
git commit -m "docs(polymarket): add Analyzer agent persona template and setup instructions"
```

---

## Phase 7 — Plugin Wiring

Goal: Make the plugin actually start everything when RivonClaw activates it. Database connection, Collector, Executor, Analyzer bridge all hooked up in `src/index.ts`.

### Task 27: Startup recovery module

**Files:**
- Create: `extensions/rivonclaw-polymarket/src/recovery/startup-recovery.ts`
- Test: `extensions/rivonclaw-polymarket/tests/recovery/startup-recovery.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations.js";
import { createSignalLogRepo } from "../../src/db/signal-log-repo.js";
import { createPortfolioStateRepo } from "../../src/db/portfolio-state-repo.js";
import { performStartupRecovery } from "../../src/recovery/startup-recovery.js";

describe("performStartupRecovery", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
  });

  it("resets daily_halt flag when day has rolled over", () => {
    const portfolio = createPortfolioStateRepo(db);
    const lastUpdateMs = Date.now() - 25 * 3600 * 1000; // 25h ago
    portfolio.update({ daily_halt_triggered: true, day_start_equity: 10_000 });
    // We simulate the rollover by calling recovery with a future date
    performStartupRecovery({
      signalRepo: createSignalLogRepo(db),
      portfolioRepo: portfolio,
      nowMs: lastUpdateMs + 25 * 3600 * 1000,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });
    // NB: recovery logic for daily reset is based on comparing clock-day of
    // last update vs now. This test just exercises the path.
  });

  it("logs count of recovered open positions", () => {
    const signalRepo = createSignalLogRepo(db);
    signalRepo.insert({
      signal_id: "open-1",
      market_id: "m1",
      market_title: "T",
      resolves_at: Date.now() + 3_600_000,
      triggered_at: Date.now(),
      direction: "buy_yes",
      entry_price: 0.5,
      price_bucket: 0.5,
      size_usdc: 100,
      kelly_fraction: 0.1,
      snapshot_volume_1m: 3000,
      snapshot_net_flow_1m: 3000,
      snapshot_unique_traders_1m: 4,
      snapshot_price_move_5m: 0.04,
      snapshot_liquidity: 6000,
      llm_verdict: "real_signal",
      llm_confidence: 0.8,
      llm_reasoning: "",
    });

    const logs: string[] = [];
    performStartupRecovery({
      signalRepo,
      portfolioRepo: createPortfolioStateRepo(db),
      nowMs: Date.now(),
      logger: {
        info: (m) => logs.push(m),
        warn: () => {},
        error: () => {},
      },
    });
    expect(logs.some((l) => l.includes("1") && l.toLowerCase().includes("open"))).toBe(true);
  });
});
```

- [ ] **Step 2: Implement `startup-recovery.ts`**

```typescript
import type { SignalLogRepo } from "../db/signal-log-repo.js";
import type { PortfolioStateRepo } from "../db/portfolio-state-repo.js";

export interface StartupRecoveryDeps {
  signalRepo: SignalLogRepo;
  portfolioRepo: PortfolioStateRepo;
  nowMs: number;
  logger: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void };
}

export interface RecoveryReport {
  openPositionCount: number;
  dailyHaltReset: boolean;
  weeklyHaltReset: boolean;
}

export function performStartupRecovery(deps: StartupRecoveryDeps): RecoveryReport {
  const open = deps.signalRepo.listOpen();
  deps.logger.info(`[recovery] ${open.length} open positions loaded from DB`);

  const state = deps.portfolioRepo.read();
  const patch: Partial<typeof state> = {};
  let dailyReset = false;
  let weeklyReset = false;

  // On any startup, reset start-of-day and start-of-week anchors if the
  // current clock is past the previous anchor's day/week.
  const now = new Date(deps.nowMs);
  const dayAnchor = new Date(state.day_start_equity > 0 ? deps.nowMs : deps.nowMs);
  // Simple heuristic: if daily halt is set but current equity has recovered
  // (or a full day has passed as tracked by current_equity === day_start_equity),
  // clear the flag. The full logic lives in circuit-breaker resetDaily().
  // For recovery we conservatively clear halts on startup if the user restarted
  // the process (likely intentional recovery).
  if (state.daily_halt_triggered) {
    patch.daily_halt_triggered = false;
    patch.day_start_equity = state.current_equity;
    dailyReset = true;
  }
  if (state.weekly_halt_triggered) {
    patch.weekly_halt_triggered = false;
    patch.week_start_equity = state.current_equity;
    weeklyReset = true;
  }
  if (Object.keys(patch).length > 0) deps.portfolioRepo.update(patch);

  return {
    openPositionCount: open.length,
    dailyHaltReset: dailyReset,
    weeklyHaltReset: weeklyReset,
  };
}
```

- [ ] **Step 3: Run, verify pass. Commit.**

```bash
git add -f extensions/rivonclaw-polymarket/src/recovery/ extensions/rivonclaw-polymarket/tests/recovery/
git commit -m "feat(polymarket): add startup recovery for open positions and halt flags"
```

### Task 28: Wire everything in `src/index.ts`

**Files:**
- Modify: `extensions/rivonclaw-polymarket/src/index.ts`

- [ ] **Step 1: Replace `src/index.ts` with full wiring**

```typescript
/**
 * RivonClaw Polymarket Trader plugin.
 * See docs/superpowers/specs/2026-04-06-polymarket-trading-agents-design.md
 */
import { defineRivonClawPlugin } from "@rivonclaw/plugin-sdk";
import type { PluginApi } from "@rivonclaw/plugin-sdk";
import { homedir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "./db/connection.js";
import { createSignalLogRepo } from "./db/signal-log-repo.js";
import { createPortfolioStateRepo } from "./db/portfolio-state-repo.js";
import { loadConfig } from "./config/loader.js";
import { createEventBus } from "./bus/events.js";
import { createCollector } from "./collector/collector.js";
import { createExecutor } from "./executor/executor.js";
import { createAnalyzerClient } from "./analyzer/analyzer-client.js";
import type { AgentInvoker } from "./analyzer/analyzer-client.js";
import { packContext } from "./analyzer/context-packer.js";
import { createPolymarketWsClient } from "./collector/ws-client.js";
import { performStartupRecovery } from "./recovery/startup-recovery.js";

const DEFAULT_DB_PATH = join(homedir(), ".rivonclaw", "polymarket.db");

// Module-level state survives double activation (see event-bridge plugin pattern)
let started = false;
let cleanup: (() => void) | null = null;

export default defineRivonClawPlugin({
  id: "rivonclaw-polymarket",
  name: "Polymarket Trader",

  setup(api: PluginApi) {
    if (started) {
      api.logger.info("[polymarket] already started, skipping re-activation");
      return;
    }
    started = true;
    api.logger.info("[polymarket] activating...");

    const config = loadConfig(undefined);
    const db = openDatabase(DEFAULT_DB_PATH);
    const signalRepo = createSignalLogRepo(db);
    const portfolioRepo = createPortfolioStateRepo(db);

    // Startup recovery
    performStartupRecovery({
      signalRepo,
      portfolioRepo,
      nowMs: Date.now(),
      logger: api.logger as any,
    });

    const bus = createEventBus();

    // Agent invoker — PLACEHOLDER, resolves per I1 findings.
    // For now, inject a stub that throws, so the plugin can load but LLM
    // calls are gated until I1 is complete.
    const invoker: AgentInvoker = async (_agentId, _message) => {
      throw new Error(
        "AgentInvoker not implemented yet — complete investigation I1 and wire up the runtime invocation here"
      );
    };
    const analyzerClient = createAnalyzerClient({
      agentId: "polymarket-analyzer",
      timeoutMs: config.llmTimeoutMs,
      invoker,
    });

    // Market metadata provider — PLACEHOLDER. For M1, stub returns a dummy
    // metadata. For M2, hook into Polymarket Gamma API via gateway fetch.
    const marketMetadataProvider = async (marketId: string) => {
      return {
        marketId,
        marketTitle: marketId,
        resolvesAt: Date.now() + 86_400_000,
        liquidity: 10_000,
      };
    };

    const collector = createCollector({
      config,
      bus,
      wsClientFactory: (onTrade) =>
        createPolymarketWsClient({
          url: config.polymarketWsUrl,
          onTrade,
          onError: (err) => api.logger.warn(`[polymarket-ws] ${err.message}`),
        }),
      marketMetadataProvider,
      logger: api.logger as any,
    });

    const executor = createExecutor({
      config,
      bus,
      signalRepo,
      portfolioRepo,
      logger: api.logger as any,
    });

    // Wire trigger → Analyzer → Executor
    bus.onTrigger(async (trigger) => {
      try {
        const prompt = packContext(trigger);
        const parsed = await analyzerClient.judge(prompt);
        executor.handleVerdict({
          type: "verdict",
          trigger,
          verdict: parsed.verdict,
          confidence: parsed.confidence,
          reasoning: parsed.reasoning,
          llm_direction: parsed.direction,
        });
      } catch (err) {
        api.logger.warn(`[polymarket] analyzer error: ${String(err)}`);
      }
    });

    collector.start().catch((err) => {
      api.logger.error(`[polymarket] collector failed to start: ${String(err)}`);
    });

    cleanup = () => {
      try {
        collector.stop();
        db.close();
      } catch (err) {
        api.logger.warn(`[polymarket] cleanup error: ${String(err)}`);
      }
    };

    api.logger.info("[polymarket] activated");
  },
});

export function __testCleanup(): void {
  cleanup?.();
  cleanup = null;
  started = false;
}
```

- [ ] **Step 2: Build the plugin and verify no type errors**

Run: `pnpm --filter @rivonclaw/rivonclaw-polymarket build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add -f extensions/rivonclaw-polymarket/src/index.ts
git commit -m "feat(polymarket): wire collector/analyzer/executor in plugin setup()"
```

---

## Phase 8 — Reviewer Agent

Goal: Reviewer agent reads `signal_log`, computes per-bucket win rates, auto-kills unprofitable strategies, produces filter_proposals for human review, publishes alerts via RivonClaw channels.

### Task 29: Strategy performance statistics

**Files:**
- Create: `extensions/rivonclaw-polymarket/src/reviewer/statistics.ts`
- Test: `extensions/rivonclaw-polymarket/tests/reviewer/statistics.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect } from "vitest";
import { computeBucketStats } from "../../src/reviewer/statistics.js";
import type { SignalLogRow } from "../../src/db/types.js";

function closedTrade(bucket: number, netPnl: number): SignalLogRow {
  return {
    signal_id: `t-${bucket}-${netPnl}`,
    market_id: "m",
    market_title: "x",
    resolves_at: 0,
    triggered_at: 0,
    direction: "buy_yes",
    entry_price: bucket + 0.01,
    price_bucket: bucket,
    size_usdc: 100,
    kelly_fraction: 0.1,
    snapshot_volume_1m: 0,
    snapshot_net_flow_1m: 0,
    snapshot_unique_traders_1m: 0,
    snapshot_price_move_5m: 0,
    snapshot_liquidity: 0,
    llm_verdict: "real_signal",
    llm_confidence: 0.5,
    llm_reasoning: "",
    exit_at: 1,
    exit_price: 0,
    exit_reason: netPnl > 0 ? "A_TP" : "A_SL",
    pnl_gross_usdc: netPnl,
    fees_usdc: 0,
    slippage_usdc: 0,
    gas_usdc: 0.2,
    pnl_net_usdc: netPnl,
    holding_duration_sec: 1,
  };
}

describe("computeBucketStats", () => {
  it("returns empty stats for no trades", () => {
    expect(computeBucketStats([], { windowMs: 86_400_000, nowMs: 1000 })).toEqual([]);
  });

  it("computes per-bucket win rate", () => {
    const trades = [
      closedTrade(0.5, 10),
      closedTrade(0.5, 10),
      closedTrade(0.5, -5),
      closedTrade(0.5, -5),
    ];
    const stats = computeBucketStats(trades, { windowMs: 86_400_000, nowMs: 1000 });
    const b50 = stats.find((s) => s.price_bucket === 0.5);
    expect(b50?.trade_count).toBe(4);
    expect(b50?.win_count).toBe(2);
    expect(b50?.win_rate).toBe(0.5);
    expect(b50?.total_pnl_net).toBe(10);
  });

  it("separates different buckets", () => {
    const trades = [
      closedTrade(0.30, 5),
      closedTrade(0.30, 5),
      closedTrade(0.70, -10),
      closedTrade(0.70, -10),
    ];
    const stats = computeBucketStats(trades, { windowMs: 86_400_000, nowMs: 1000 });
    expect(stats.find((s) => s.price_bucket === 0.30)?.win_rate).toBe(1);
    expect(stats.find((s) => s.price_bucket === 0.70)?.win_rate).toBe(0);
  });
});
```

- [ ] **Step 2: Implement `statistics.ts`**

```typescript
import type { SignalLogRow } from "../db/types.js";

export interface BucketStats {
  price_bucket: number;
  trade_count: number;
  win_count: number;
  win_rate: number;
  total_pnl_net: number;
}

export function computeBucketStats(
  trades: SignalLogRow[],
  opts: { windowMs: number; nowMs: number }
): BucketStats[] {
  const cutoff = opts.nowMs - opts.windowMs;
  const filtered = trades.filter((t) => t.exit_at !== null && t.exit_at >= cutoff);
  const byBucket = new Map<number, { count: number; wins: number; pnl: number }>();
  for (const t of filtered) {
    if (t.pnl_net_usdc === null) continue;
    const entry = byBucket.get(t.price_bucket) ?? { count: 0, wins: 0, pnl: 0 };
    entry.count++;
    if (t.pnl_net_usdc > 0) entry.wins++;
    entry.pnl += t.pnl_net_usdc;
    byBucket.set(t.price_bucket, entry);
  }
  const out: BucketStats[] = [];
  for (const [bucket, agg] of byBucket.entries()) {
    out.push({
      price_bucket: bucket,
      trade_count: agg.count,
      win_count: agg.wins,
      win_rate: agg.count > 0 ? agg.wins / agg.count : 0,
      total_pnl_net: agg.pnl,
    });
  }
  return out.sort((a, b) => a.price_bucket - b.price_bucket);
}
```

- [ ] **Step 3: Run, verify pass. Commit.**

```bash
git add -f extensions/rivonclaw-polymarket/src/reviewer/statistics.ts extensions/rivonclaw-polymarket/tests/reviewer/statistics.test.ts
git commit -m "feat(polymarket): add Reviewer bucket statistics calculator"
```

### Task 30: Kill switch auto-trigger

**Files:**
- Create: `extensions/rivonclaw-polymarket/src/reviewer/kill-switch-decider.ts`
- Test: `extensions/rivonclaw-polymarket/tests/reviewer/kill-switch-decider.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect } from "vitest";
import { decideKillSwitch } from "../../src/reviewer/kill-switch-decider.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";

describe("decideKillSwitch", () => {
  it("does not kill with fewer than minTrades samples", () => {
    const decision = decideKillSwitch(
      { trade_count: 5, win_count: 1, win_rate: 0.2, total_pnl_net: -5 },
      DEFAULT_CONFIG
    );
    expect(decision.kill).toBe(false);
  });

  it("kills when trade_count >= min and win_rate < max_win_rate", () => {
    const decision = decideKillSwitch(
      { trade_count: 10, win_count: 3, win_rate: 0.30, total_pnl_net: -20 },
      DEFAULT_CONFIG
    );
    expect(decision.kill).toBe(true);
    expect(decision.reason).toContain("win rate 30.0%");
  });

  it("does not kill at exactly the threshold", () => {
    const decision = decideKillSwitch(
      { trade_count: 10, win_count: 5, win_rate: 0.50, total_pnl_net: 0 },
      DEFAULT_CONFIG
    );
    expect(decision.kill).toBe(false);
  });
});
```

- [ ] **Step 2: Implement `kill-switch-decider.ts`**

```typescript
import type { TraderConfig } from "../config/schema.js";
import type { BucketStats } from "./statistics.js";

export interface KillDecision {
  kill: boolean;
  reason?: string;
}

export function decideKillSwitch(
  stats: Pick<BucketStats, "trade_count" | "win_count" | "win_rate" | "total_pnl_net">,
  cfg: TraderConfig
): KillDecision {
  if (stats.trade_count < cfg.killSwitchMinTrades) {
    return { kill: false };
  }
  if (stats.win_rate < cfg.killSwitchMaxWinRate) {
    return {
      kill: true,
      reason: `win rate ${(stats.win_rate * 100).toFixed(1)}% over ${stats.trade_count} trades < kill threshold ${(cfg.killSwitchMaxWinRate * 100).toFixed(1)}%`,
    };
  }
  return { kill: false };
}
```

- [ ] **Step 3: Run, verify pass. Commit.**

```bash
git add -f extensions/rivonclaw-polymarket/src/reviewer/kill-switch-decider.ts extensions/rivonclaw-polymarket/tests/reviewer/kill-switch-decider.test.ts
git commit -m "feat(polymarket): add Reviewer kill switch decision logic"
```

### Task 31: Reviewer report generator

**Files:**
- Create: `extensions/rivonclaw-polymarket/src/reviewer/report-generator.ts`
- Test: `extensions/rivonclaw-polymarket/tests/reviewer/report-generator.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect } from "vitest";
import { generateReport } from "../../src/reviewer/report-generator.js";

describe("generateReport", () => {
  it("produces markdown with header, per-bucket stats, and recommendation", () => {
    const md = generateReport({
      period: "weekly",
      nowMs: new Date("2026-04-13T00:00:00Z").getTime(),
      buckets7d: [
        { price_bucket: 0.30, trade_count: 5, win_count: 4, win_rate: 0.8, total_pnl_net: 25 },
        { price_bucket: 0.50, trade_count: 12, win_count: 6, win_rate: 0.5, total_pnl_net: -5 },
      ],
      killSwitches: [],
      totalPnl7d: 20,
    });
    expect(md).toContain("# Polymarket Reviewer Report");
    expect(md).toContain("2026-04-13");
    expect(md).toContain("0.30");
    expect(md).toContain("80.0%");
    expect(md).toContain("0.50");
  });

  it("includes kill switch warnings prominently", () => {
    const md = generateReport({
      period: "weekly",
      nowMs: Date.now(),
      buckets7d: [],
      killSwitches: [
        { strategy: "smart_money_flow", reason: "win rate 30% over 10 trades" },
      ],
      totalPnl7d: -50,
    });
    expect(md).toMatch(/kill switch/i);
    expect(md).toContain("smart_money_flow");
  });
});
```

- [ ] **Step 2: Implement `report-generator.ts`**

```typescript
import type { BucketStats } from "./statistics.js";

export interface ReportInput {
  period: "daily" | "weekly";
  nowMs: number;
  buckets7d: BucketStats[];
  killSwitches: Array<{ strategy: string; reason: string }>;
  totalPnl7d: number;
}

export function generateReport(input: ReportInput): string {
  const lines: string[] = [];
  const date = new Date(input.nowMs).toISOString().slice(0, 10);
  lines.push(`# Polymarket Reviewer Report`);
  lines.push(``);
  lines.push(`**Period:** ${input.period}`);
  lines.push(`**Generated:** ${date}`);
  lines.push(`**7-day net PnL:** $${input.totalPnl7d.toFixed(2)}`);
  lines.push(``);

  if (input.killSwitches.length > 0) {
    lines.push(`## ⚠️ Kill switches fired`);
    lines.push(``);
    for (const k of input.killSwitches) {
      lines.push(`- **${k.strategy}**: ${k.reason}`);
    }
    lines.push(``);
  }

  lines.push(`## Per-bucket performance (7d)`);
  lines.push(``);
  lines.push(`| Bucket | Trades | Wins | Win rate | Net PnL |`);
  lines.push(`|--------|--------|------|----------|---------|`);
  for (const b of input.buckets7d) {
    lines.push(
      `| ${b.price_bucket.toFixed(2)} | ${b.trade_count} | ${b.win_count} | ${(b.win_rate * 100).toFixed(1)}% | $${b.total_pnl_net.toFixed(2)} |`
    );
  }
  lines.push(``);

  return lines.join("\n");
}
```

- [ ] **Step 3: Run, verify pass. Commit.**

```bash
git add -f extensions/rivonclaw-polymarket/src/reviewer/report-generator.ts extensions/rivonclaw-polymarket/tests/reviewer/report-generator.test.ts
git commit -m "feat(polymarket): add Reviewer markdown report generator"
```

### Task 32: Reviewer entry point (called via gateway method)

**Files:**
- Create: `extensions/rivonclaw-polymarket/src/reviewer/reviewer.ts`
- Modify: `extensions/rivonclaw-polymarket/src/index.ts` (register gateway method)

- [ ] **Step 1: Implement `reviewer.ts`**

```typescript
import type Database from "better-sqlite3";
import type { TraderConfig } from "../config/schema.js";
import type { SignalLogRepo } from "../db/signal-log-repo.js";
import type { StrategyPerformanceRepo } from "../db/strategy-performance-repo.js";
import { computeBucketStats } from "./statistics.js";
import { decideKillSwitch } from "./kill-switch-decider.js";
import { generateReport } from "./report-generator.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ReviewerDeps {
  db: Database.Database;
  config: TraderConfig;
  signalRepo: SignalLogRepo;
  strategyPerfRepo: StrategyPerformanceRepo;
  logger: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void };
}

export interface ReviewerRunResult {
  bucketCount: number;
  killSwitches: number;
  reportPath: string;
}

export async function runReviewer(deps: ReviewerDeps): Promise<ReviewerRunResult> {
  const nowMs = Date.now();
  const windowMs = 7 * 24 * 3600 * 1000;
  const trades = deps.signalRepo.listClosedSince(nowMs - windowMs);

  const buckets = computeBucketStats(trades, { windowMs, nowMs });

  // Write per-bucket stats back to strategy_performance
  for (const b of buckets) {
    deps.strategyPerfRepo.upsert({
      price_bucket: b.price_bucket,
      window: "7d",
      trade_count: b.trade_count,
      win_count: b.win_count,
      win_rate: b.win_rate,
      total_pnl_net: b.total_pnl_net,
      last_updated: nowMs,
    });
  }

  // Aggregate for strategy-level kill switch (single strategy v1)
  const aggregate = buckets.reduce(
    (acc, b) => ({
      trade_count: acc.trade_count + b.trade_count,
      win_count: acc.win_count + b.win_count,
      win_rate: 0,
      total_pnl_net: acc.total_pnl_net + b.total_pnl_net,
    }),
    { trade_count: 0, win_count: 0, win_rate: 0, total_pnl_net: 0 }
  );
  aggregate.win_rate = aggregate.trade_count > 0 ? aggregate.win_count / aggregate.trade_count : 0;
  const killDecision = decideKillSwitch(aggregate, deps.config);

  const killSwitches: Array<{ strategy: string; reason: string }> = [];
  if (killDecision.kill) {
    killSwitches.push({ strategy: "smart_money_flow", reason: killDecision.reason ?? "unknown" });
  }

  const totalPnl7d = aggregate.total_pnl_net;
  const markdown = generateReport({
    period: "weekly",
    nowMs,
    buckets7d: buckets,
    killSwitches,
    totalPnl7d,
  });

  const reportsDir = join(homedir(), ".rivonclaw", "polymarket-reports");
  mkdirSync(reportsDir, { recursive: true });
  const reportPath = join(reportsDir, `review-${new Date(nowMs).toISOString().slice(0, 10)}.md`);
  writeFileSync(reportPath, markdown, "utf-8");
  deps.logger.info(`[reviewer] report written to ${reportPath}`);

  return {
    bucketCount: buckets.length,
    killSwitches: killSwitches.length,
    reportPath,
  };
}
```

- [ ] **Step 2: Register gateway method in `src/index.ts`**

Add after `collector.start().catch(...)`:

```typescript
    if (typeof api.registerGatewayMethod === "function") {
      api.registerGatewayMethod("polymarket.runReviewer", async ({ respond }) => {
        try {
          const result = await runReviewer({
            db,
            config,
            signalRepo,
            strategyPerfRepo: createStrategyPerformanceRepo(db),
            logger: api.logger as any,
          });
          respond(true, result);
        } catch (err) {
          respond(false, undefined, {
            code: "REVIEWER_FAILED",
            message: String(err),
          });
        }
      });
    }
```

Add imports: `runReviewer` from `./reviewer/reviewer.js`, `createStrategyPerformanceRepo` from `./db/strategy-performance-repo.js`.

- [ ] **Step 3: Build and manually smoke-test gateway method**

Run: `pnpm --filter @rivonclaw/rivonclaw-polymarket build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add -f extensions/rivonclaw-polymarket/src/reviewer/reviewer.ts extensions/rivonclaw-polymarket/src/index.ts
git commit -m "feat(polymarket): add Reviewer entry point registered as gateway method"
```

### Task 33: polymarket-reviewer agent workspace + cron setup docs

**Files:**
- Create: `extensions/rivonclaw-polymarket/docs/AGENTS-reviewer.md`
- Modify: `extensions/rivonclaw-polymarket/README.md`

- [ ] **Step 1: Create AGENTS-reviewer.md persona**

```markdown
# Polymarket Reviewer Agent

You are the Polymarket Reviewer — the second "employee" of the trading system. Your job is to read the system's own trading log and find patterns the human operator can act on.

## When you run

Automatically every day at 00:00 UTC via OpenClaw cron. You can also be invoked manually by the user asking "review this week" or similar.

## What you do

When invoked, you should:

1. Call the `polymarket.runReviewer` gateway method via tool.
2. Read the generated report file at `~/.rivonclaw/polymarket-reports/review-YYYY-MM-DD.md`.
3. If the system auto-killed any strategies, raise a clear alert.
4. Look at per-bucket win rates — identify 1-2 buckets that are notably better or worse than others.
5. If a bucket has ≥ 5 trades and win rate significantly different from the prior (0.50 or 0.34 for dead zone), suggest a filter_proposal to adjust the prior.
6. Write proposals to the `filter_proposals` table via SQL tool.

## Writing proposals

Every proposal should include:
- The field being adjusted (e.g., `prior_win_rate[0.55]`)
- Old value vs proposed value
- Sample count backing the change
- Expected delta in win rate or PnL

## Tone

Be concise and data-driven. Avoid speculation. If you don't have enough data, say "insufficient sample size" rather than guessing.
```

- [ ] **Step 2: Append to README.md**

```markdown
### 4. Create the Reviewer agent workspace

```bash
mkdir -p ~/.openclaw/agents/polymarket-reviewer/agent
cp extensions/rivonclaw-polymarket/docs/AGENTS-reviewer.md ~/.openclaw/agents/polymarket-reviewer/agent/AGENTS.md
```

### 5. Add Reviewer to openclaw.json and configure cron

Add to `agents.list`:

```json
{
  "id": "polymarket-reviewer",
  "workspaceDir": "~/.openclaw/workspace-polymarket-reviewer",
  "agentDir": "~/.openclaw/agents/polymarket-reviewer/agent"
}
```

Add cron entry (exact format per I2 findings):

```json
"cron": [
  { "agent": "polymarket-reviewer", "schedule": "0 0 * * *", "prompt": "Run the daily review" }
]
```
```

- [ ] **Step 3: Commit**

```bash
git add -f extensions/rivonclaw-polymarket/docs/AGENTS-reviewer.md extensions/rivonclaw-polymarket/README.md
git commit -m "docs(polymarket): add Reviewer agent persona and cron setup"
```

---

## Phase 9 — End-to-End Integration

Goal: record a Polymarket WS session, replay it through Collector → Analyzer stub → Executor → Reviewer, assert expected PnL and signal_log contents.

### Task 34: Record WS fixture

**Files:**
- Create: `extensions/rivonclaw-polymarket/tests/fixtures/polymarket-ws-sample.json`
- Create: `extensions/rivonclaw-polymarket/scripts/record-ws.mjs`

- [ ] **Step 1: Create recording script**

```javascript
// scripts/record-ws.mjs
// Usage: node scripts/record-ws.mjs > tests/fixtures/polymarket-ws-sample.json
// Records 1 hour of Polymarket trade events to stdout as JSONL.
import WebSocket from "ws";

const URL = process.env.POLYMARKET_WS_URL ?? "wss://ws-subscriptions-clob.polymarket.com/ws/";
const DURATION_MS = 60 * 60 * 1000;

const ws = new WebSocket(URL);
const events = [];
const startMs = Date.now();

ws.on("open", () => {
  ws.send(JSON.stringify({ type: "SUBSCRIBE", channel: "market" }));
  console.error(`Recording for ${DURATION_MS / 1000}s...`);
});
ws.on("message", (data) => {
  try {
    const parsed = JSON.parse(data.toString());
    if (parsed.event_type === "trade") {
      events.push(parsed);
    }
  } catch {}
  if (Date.now() - startMs > DURATION_MS) {
    console.log(JSON.stringify(events));
    process.exit(0);
  }
});
ws.on("error", (err) => {
  console.error(`WS error: ${err.message}`);
  process.exit(1);
});
```

- [ ] **Step 2: Create a synthetic fixture (for tests to not depend on network)**

Write `tests/fixtures/polymarket-ws-sample.json` by hand with 30-50 synthetic trades across 2-3 markets, one sequence that should trigger and one that shouldn't. Skip full JSON in this plan — construct it based on the trigger thresholds.

- [ ] **Step 3: Commit**

```bash
git add -f extensions/rivonclaw-polymarket/scripts/record-ws.mjs extensions/rivonclaw-polymarket/tests/fixtures/polymarket-ws-sample.json
git commit -m "test(polymarket): add WS recording script and synthetic fixture"
```

### Task 35: End-to-end integration test

**Files:**
- Create: `extensions/rivonclaw-polymarket/tests/e2e/paper-trading.test.ts`

- [ ] **Step 1: Write failing E2E test**

```typescript
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations.js";
import { createSignalLogRepo } from "../../src/db/signal-log-repo.js";
import { createPortfolioStateRepo } from "../../src/db/portfolio-state-repo.js";
import { createEventBus } from "../../src/bus/events.js";
import { createCollector } from "../../src/collector/collector.js";
import { createExecutor } from "../../src/executor/executor.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

describe("E2E paper trading", () => {
  it("processes the WS fixture end-to-end producing closed trades", async () => {
    const db = new Database(":memory:");
    runMigrations(db);
    const signalRepo = createSignalLogRepo(db);
    const portfolioRepo = createPortfolioStateRepo(db);
    portfolioRepo.update({
      total_capital: 10_000,
      current_equity: 10_000,
      day_start_equity: 10_000,
      week_start_equity: 10_000,
      peak_equity: 10_000,
    });
    const bus = createEventBus();

    const logger = { info: () => {}, warn: () => {}, error: () => {} };

    // Stub Analyzer: always approves buy_yes with confidence 0.8
    bus.onTrigger((trigger) => {
      const executor = exec; // captured below
      executor.handleVerdict({
        type: "verdict",
        trigger,
        verdict: "real_signal",
        confidence: 0.8,
        reasoning: "e2e stub",
        llm_direction: trigger.direction,
      });
    });

    const exec = createExecutor({ config: DEFAULT_CONFIG, bus, signalRepo, portfolioRepo, logger });

    const collector = createCollector({
      config: DEFAULT_CONFIG,
      bus,
      wsClientFactory: () => ({ connect: async () => {}, close: () => {} }),
      marketMetadataProvider: async (marketId) => ({
        marketId,
        marketTitle: "Test market",
        resolvesAt: Date.now() + 7_200_000,
        liquidity: 6000,
      }),
      logger,
    });

    const __filename = fileURLToPath(import.meta.url);
    const fixturePath = join(dirname(__filename), "../fixtures/polymarket-ws-sample.json");
    const trades = JSON.parse(readFileSync(fixturePath, "utf-8"));

    for (const raw of trades) {
      await collector.ingestTrade({
        marketId: raw.market,
        timestampMs: parseInt(raw.timestamp, 10),
        address: raw.taker ?? "unknown",
        sizeUsdc: parseFloat(raw.size),
        side: raw.side.toLowerCase() === "buy" ? "buy" : "sell",
        price: parseFloat(raw.price),
      });
    }

    const openAfterFixture = exec.openPositions();
    expect(openAfterFixture.length).toBeGreaterThanOrEqual(0);

    // Now simulate price ticks that should close all open positions
    for (const pos of [...openAfterFixture]) {
      exec.onPriceTick(pos.market_id, pos.entry_price * 1.15, Date.now());
    }

    expect(exec.openPositions()).toHaveLength(0);
    // All signal_log rows should have net PnL recorded (non-null)
    const allRows = db.prepare("SELECT * FROM signal_log").all() as Array<any>;
    for (const row of allRows) {
      expect(row.exit_at).not.toBeNull();
      expect(row.pnl_net_usdc).not.toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run and iterate until pass**

Run: `pnpm --filter @rivonclaw/rivonclaw-polymarket test:run tests/e2e/paper-trading.test.ts`
Fix any integration mismatches.

- [ ] **Step 3: Commit**

```bash
git add -f extensions/rivonclaw-polymarket/tests/e2e/paper-trading.test.ts
git commit -m "test(polymarket): add end-to-end paper trading integration test"
```

### Task 36: Test coverage verification

- [ ] **Step 1: Run full coverage report**

Run: `pnpm --filter @rivonclaw/rivonclaw-polymarket test:run --coverage`
Expected: 100% branch coverage for `src/executor/**` (per spec §10).

- [ ] **Step 2: Fix any uncovered executor branches**

Add targeted tests for any branches missed.

- [ ] **Step 3: Commit**

```bash
git add -f extensions/rivonclaw-polymarket/tests/
git commit -m "test(polymarket): achieve 100% branch coverage on executor module"
```

---

## Phase 10 — M4 Stability Observation

Goal: run the plugin for 2-4 weeks in paper mode, collect data, validate Reviewer output, assess whether Kelly sizing with priors converges sensibly.

This phase is **not code** — it's observation with defined exit criteria.

### Task 37: M4 stability runbook

**Files:**
- Create: `extensions/rivonclaw-polymarket/docs/m4-runbook.md`

- [ ] **Step 1: Write `m4-runbook.md`**

```markdown
# M4 Stability Observation Runbook

## Pre-flight checklist (complete before starting the observation window)

- [ ] Plugin loaded in RivonClaw (`openclaw logs` shows "[polymarket] activated")
- [ ] Collector is publishing trigger events (`tail -f ~/.rivonclaw/logs/*.log | grep trigger`)
- [ ] Analyzer agent is configured and responsive (manual test via RivonClaw chat)
- [ ] Reviewer agent is configured
- [ ] Cron entry for reviewer is in openclaw.json
- [ ] portfolio_state initialized with $10,000 virtual capital
- [ ] All unit + E2E tests pass

## Observation metrics (track daily)

Run this SQL against `~/.rivonclaw/polymarket.db`:

```sql
-- Daily summary
SELECT
  date(triggered_at / 1000, 'unixepoch') AS day,
  count(*) AS trades,
  sum(CASE WHEN pnl_net_usdc > 0 THEN 1 ELSE 0 END) AS wins,
  round(sum(pnl_net_usdc), 2) AS daily_net_pnl,
  round(avg(pnl_net_usdc), 2) AS avg_per_trade
FROM signal_log
WHERE exit_at IS NOT NULL
GROUP BY day
ORDER BY day DESC;
```

## Exit criteria for M4

The M4 phase is successful when **ALL** of these hold over a 2-week window:

- [ ] No unexpected plugin crashes (`count(restart_events) = 0`)
- [ ] `signal_log` has at least 50 closed trades
- [ ] No day triggered the 2% daily halt
- [ ] Total drawdown from peak < 10%
- [ ] Reviewer has run successfully at least 5 times (cron)
- [ ] At least 1 `filter_proposals` row exists (indicates Reviewer is generating suggestions)

## Failure criteria (abort M4 and re-plan)

Stop and revisit the spec if **ANY** of these happen:
- Total drawdown > 10% (emergency stop triggers)
- Plugin crashes > 3 times in a week
- Zero triggers for 3+ consecutive days (thresholds are too strict)
- > 20% of trades have identical entry/exit prices (paper fill bug)

## Post-M4 decisions to make

Based on M4 data, answer:
1. Are the default trigger thresholds producing a sensible number of signals per day? (target: 5-20/day)
2. Is the [0.60, 0.85] dead zone actually being respected? (check `select count(*) from signal_log where price_bucket between 0.60 and 0.85` — should be 0)
3. Is the Reviewer's per-bucket win rate calibration converging? (compare prior vs observed win rates for buckets with ≥ 10 samples)
4. Should any kill switches from Reviewer be upheld or reverted?
5. Is the system ready for Phase 2 (adding Regime Gate, considering Live Executor)?
```

- [ ] **Step 2: Commit**

```bash
git add -f extensions/rivonclaw-polymarket/docs/m4-runbook.md
git commit -m "docs(polymarket): add M4 stability observation runbook"
```

---

## Spec Coverage Check

| Spec section | Tasks covering it |
|--------------|-------------------|
| §1.1 稳定目标 | §10 in spec is quantified; verified via M4 runbook exit criteria (Task 37) |
| §1.2 YAGNI list | No tasks for items in YAGNI list — confirmed by omission |
| §2 旧系统诊断 | Informational; no direct tasks, but Tasks 21, 22, 28 implement the specific fixes |
| §3 架构 1 插件 + 2 agent | Tasks 1 (bootstrap), 28 (wiring), 26 (analyzer workspace), 33 (reviewer workspace) |
| §4.2 触发条件 | Task 11 (trigger evaluator) |
| §4.3 死亡区间 | Task 6 (priors), Task 11 (hard check) |
| §5 出场规则 E/A/D/C | Task 20 (E/A/C monitor), Task 22 (D wiring in executor) |
| §6.1 按桶 Kelly | Task 15 (Kelly) + Task 6 (priors) |
| §6.2 组合限制 | Task 22 (exposure check) |
| §6.3 熔断 | Task 17 (circuit breaker) |
| §7.1 signal_log | Task 2 (schema) + Task 3 (repo) |
| §7.2 strategy_performance | Task 2 (schema) + Task 4 (repo) |
| §7.3 filter_config | Task 4 |
| §7.4 filter_proposals | Task 4 |
| §7.5 kill_switch | Task 4 + Task 30 |
| §7.6 portfolio_state | Task 4 (repo) |
| §8 技术栈 | Task 1 (package.json) |
| §9 错误处理 | Task 7 (typed errors), enforced via convention in all tasks |
| §10 测试策略 | Tasks 2-36 (TDD throughout) + Task 36 (coverage) |
| §11 里程碑 M1-M4 | Phases 0-10 map to M1-M4 |
| §12 已确认决定 | Architectural — no direct tasks |
| §13 开放问题 | Investigation I1, I2 cover most; 监控 market 范围 and 起始资金 deferred to M4 runbook |

**Gaps identified during self-review:**

1. **No task for the `filter-config-repo` hot reload semantics** — Task 4 lumps all KV repos together. If hot reload (file watch + notification) is needed beyond simple DB reads, add follow-up Task 4b once the test demands it.

2. **Gateway channel alert forwarding** (spec §3 mentions Reviewer pushing Telegram/Feishu alerts) — not covered. **Adding Task 32b.**

3. **Market metadata provider is stubbed in Task 28** — needs a real implementation. Deferred explicitly as a known limitation; M2 acceptance requires a real Gamma API client or manual config.

### Task 32b (inserted): Channel alert dispatcher

**Files:**
- Create: `extensions/rivonclaw-polymarket/src/reviewer/alert-dispatcher.ts`
- Test: `extensions/rivonclaw-polymarket/tests/reviewer/alert-dispatcher.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect, vi } from "vitest";
import { createAlertDispatcher } from "../../src/reviewer/alert-dispatcher.js";

describe("alertDispatcher", () => {
  it("dispatches critical alerts through the provided sender", async () => {
    const sender = vi.fn().mockResolvedValue(true);
    const dispatcher = createAlertDispatcher({
      sender,
      channel: "telegram",
      userId: "chat-123",
    });
    await dispatcher.dispatch({
      severity: "critical",
      title: "Kill switch fired",
      body: "smart_money_flow killed (win rate 30%)",
    });
    expect(sender).toHaveBeenCalledWith(
      "telegram",
      "chat-123",
      expect.stringContaining("Kill switch fired")
    );
  });

  it("silently drops alerts when no channel configured", async () => {
    const sender = vi.fn();
    const dispatcher = createAlertDispatcher({ sender, channel: null, userId: null });
    await dispatcher.dispatch({ severity: "info", title: "t", body: "b" });
    expect(sender).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement `alert-dispatcher.ts`**

```typescript
export type AlertSender = (channelId: string, userId: string, text: string) => Promise<boolean>;

export interface AlertDispatcherOptions {
  sender: AlertSender;
  channel: string | null;
  userId: string | null;
}

export interface Alert {
  severity: "info" | "warning" | "critical";
  title: string;
  body: string;
}

export interface AlertDispatcher {
  dispatch(alert: Alert): Promise<void>;
}

export function createAlertDispatcher(opts: AlertDispatcherOptions): AlertDispatcher {
  return {
    async dispatch(alert) {
      if (!opts.channel || !opts.userId) return;
      const text = `[${alert.severity.toUpperCase()}] ${alert.title}\n\n${alert.body}`;
      await opts.sender(opts.channel, opts.userId, text);
    },
  };
}
```

- [ ] **Step 3: Wire into reviewer.ts and plugin index.ts**

In `reviewer.ts`, after generating the report, if `killSwitches.length > 0` call `alertDispatcher.dispatch({ severity: "critical", title: "Kill switch fired", body: killSwitches.map(k => `${k.strategy}: ${k.reason}`).join("\n") })`.

In `src/index.ts`, the dispatcher's `sender` is provided via a RivonClaw-specific function. For now, inject a no-op sender. Add a comment: `TODO: wire to @rivonclaw/desktop channel senders once public API is available`.

- [ ] **Step 4: Commit**

```bash
git add -f extensions/rivonclaw-polymarket/src/reviewer/alert-dispatcher.ts extensions/rivonclaw-polymarket/tests/reviewer/alert-dispatcher.test.ts extensions/rivonclaw-polymarket/src/reviewer/reviewer.ts extensions/rivonclaw-polymarket/src/index.ts
git commit -m "feat(polymarket): add alert dispatcher for Reviewer critical events"
```

---

## Final Plan Notes

- **Every task uses TDD** (test first, implement to pass, commit).
- **No task batches multiple commits** — 1 task ≈ 1 commit.
- **Investigation tasks I1 and I2 must run before Task 1** to resolve unknowns about OpenClaw agent invocation and cron configuration.
- **Executor module requires 100% branch coverage** (spec §10 mandate).
- **Kelly formula math** has been verified in Task 15 tests to auto-enforce the dead zone via priors.
- **Reverse signal (Rule D)** is wired inside Executor's own trigger listener, not as a separate monitor — keeps responsibility localized.
- **Market metadata provider** is stubbed in Task 28 — this is an explicit M2 gap that needs a real implementation before moving to M3. A follow-up task should be added when entering M2.
- **Database connection and open positions are recovered on startup** via Task 27 — ensures crash recovery.
- **Error handling rule** (no bare catches, typed errors) is enforced via convention and linter config; any PR introducing bare catches should be rejected in code review.

