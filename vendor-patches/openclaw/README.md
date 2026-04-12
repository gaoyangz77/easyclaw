# OpenClaw Patch Stack

This directory stores RivonClaw-owned source patches for `vendor/openclaw/`.

The source of truth is the patch stack in this directory, not the live state of
`vendor/openclaw/`. The pinned upstream base remains `.openclaw-version`.

## Scope

Store only source-level OpenClaw changes that are still required during normal
development or runtime.

Do not store:

- packaging-only rewrites that belong in build scripts
- broad refactors for convenience
- "just in case" patches without a current product need

## Rules

- Keep the patch count as low as possible.
- One patch must cover exactly one feature, one fix, or one upstream gap.
- Touch the fewest files that can solve the problem.
- Every patch must come with at least one RivonClaw test that would fail without
  the patch.
- Prefer upstreamable patches. If upstream already fixed the problem, remove the
  local patch instead of carrying it forward.
- If a patch can be replaced by a plugin, extension hook, config override, or
  RivonClaw-side adaptation, prefer that over patching vendor code.

## Format

Patch files should be generated with `git format-patch` from a disposable
patched vendor workspace. Keep them numbered in replay order:

```text
0001-topic.patch
0002-topic.patch
```

Each patch commit message should use this structure:

```text
vendor(openclaw): short imperative summary

Why:
- why RivonClaw still needs this patch

Removal:
- exact upstream condition, PR, or release that lets us drop it

Tests:
- path/to/test-one
- path/to/test-two
```

That commit body is preserved inside the patch file and gives the AI enough
context to judge whether the patch is still correct, still needed, or should be
dropped after an upstream update.

## Replay

Use `scripts/provision-vendor-patched.sh` to create a disposable patched
workspace at `tmp/vendor-patched/openclaw` and replay this patch stack with
`git am --3way`.

After exporting or refreshing a patch file, restore `vendor/openclaw` back to
the pinned upstream commit. Do not leave local vendor commits sitting on the
canonical checkout.

A clean replay is necessary but not sufficient. After replaying patches during a
vendor upgrade, the AI must still inspect whether each patch:

- is still semantically correct
- is still the smallest viable patch
- is still required at all
- still has meaningful test coverage

## Current Patches

### 0001 — Browser lifecycle hooks for plugin integration

**File:** `0001-vendor-openclaw-add-browser-lifecycle-hooks-for-plug.patch`

**Why:** OpenClaw's browser subsystem has no plugin hooks for lifecycle events
(launch, close, page navigation). EasyClaw's
`extensions/rivonclaw-browser-profiles-tools/` needs these hooks to manage
browser profiles, inject CDP sessions, and synchronize browser state with the
gateway. Without this patch, browser-profile plugins cannot observe or control
browser lifecycle.

**Removal:** Drop when upstream OpenClaw adds a browser plugin lifecycle API
(hooks or event emitter) that covers launch/close/navigate events.

### 0002 — `before_tool_resolve` hook for per-session tool filtering

**File:** `0002-vendor-openclaw-add-before_tool_resolve-hook-for-per.patch`

**Why:** OpenClaw resolves the full tool list once at agent startup and does not
support per-session or per-turn filtering. EasyClaw's capability manager
(`extensions/rivonclaw-capability-manager/`, ADR-031) needs to dynamically
show/hide tools based on the current session's `effectiveTools` policy. This
patch adds a `before_tool_resolve` hook that lets plugins intercept tool
resolution and filter the list before it reaches the LLM.

**Removal:** Drop when upstream OpenClaw provides a native tool-filtering hook
or plugin API that supports per-session tool visibility.

### 0003 — `promptMode: "raw"` for custom persona agents

**File:** `0003-vendor-openclaw-add-promptMode-raw-for-custom-person.patch`

**Why:** OpenClaw injects identity ("You are a personal assistant running
inside OpenClaw"), runtime info, safety guidelines, heartbeat tokens, and
documentation links into every system prompt. For EasyClaw's customer-service
agent, which must present a human persona, these sections leak AI identity and
undermine the custom prompt. Even `promptMode: "none"` still injects the
identity line. `promptMode: "raw"` returns only the caller-supplied
`extraSystemPrompt` with zero hardcoded content.

**Change:** Add `"raw"` to `PromptMode` union type and an early return in
`buildAgentSystemPrompt()` that returns `extraSystemPrompt ?? ""` when
`promptMode === "raw"`. Also passes `promptMode` into the `before_prompt_build`
hook context so plugins (e.g. `rivonclaw-tools`) can skip their own system
prompt injections in raw mode.

**Removal:** Drop when upstream OpenClaw adds a native way to fully suppress
all default system prompt sections.

### 0004 — Skip `stopChannel` for new-account QR logins

**File:** `0004-vendor-openclaw-skip-stopChannel-for-new-account-QR-.patch`

**Why:** OpenClaw's `web.login.start` RPC handler unconditionally calls
`context.stopChannel(provider.id, accountId)` before generating a QR code.
When `accountId` is undefined (new account login), this stops ALL running
accounts for the channel -- killing live WeChat bots the moment the QR code
is displayed, before anyone scans it. EasyClaw supports multiple WeChat
accounts; starting a QR login for a new account must not disconnect existing
accounts.

**Change:** Wrap `stopChannel` in `if (accountId)` so it only fires for
re-login of an existing account, not for new-account logins.

**Removal:** Drop when upstream OpenClaw makes `stopChannel` conditional on
re-login vs new-account login, or adds an option to skip channel stop.

### 0005 — Re-apply system prompt override before LLM call

**File:** `0005-vendor-openclaw-re-apply-system-prompt-override-befo.patch`

**Why:** `pi-coding-agent`'s `AgentSession` internally rebuilds `_baseSystemPrompt`
via `_rebuildSystemPrompt()` during tool refresh, compaction, and extension
lifecycle events. When a gateway session JSONL file already exists (second message
onwards in the same conversation), these internal rebuilds can overwrite the
`_baseSystemPrompt` that `applySystemPromptOverrideToSession` set, causing
`extraSystemPrompt` callers (e.g. EasyClaw CS agents using `promptMode: "raw"`)
to silently lose their custom system prompt.

**Change:** Add a single `applySystemPromptOverrideToSession(activeSession,
systemPromptText)` call in `attempt.ts` immediately before `activeSession.prompt()`,
ensuring the caller's system prompt is always the last one applied before the
LLM call.

**Removal:** Drop when `pi-coding-agent`'s `AgentSession.prompt()` natively
respects external `_baseSystemPrompt` overrides across session reuse, or when
upstream adds a dedicated system-prompt-override API.

### 0006 — Bypass SSRF-guarded fetch for FormData audio transcription

**File:** `0006-vendor-openclaw-bypass-ssrf-guard-for-formdata-audio.patch`

**Why:** OpenClaw's `fetchWithSsrFGuard` routes requests through
`fetchWithRuntimeDispatcher` (bundled `undici.fetch`) whenever any dispatcher
is active. Node's native `FormData` and bundled `undici.fetch` come from
different runtime realms, so undici cannot serialize the multipart boundary
correctly. The server receives a request without a valid
`Content-Type: multipart/form-data` header and returns HTTP 400. This breaks
all OpenAI-compatible audio transcription providers (Groq, OpenAI, Mistral).

Upstream #64766 added `pinDns: false` which disables the pinned DNS
dispatcher, but does not prevent other dispatcher paths (e.g.
`createPolicyDispatcherWithoutPinnedDns` from `dispatcherPolicy`) from
triggering `undici.fetch`.

**Change:** Replace `postTranscriptionRequest()` call in
`transcribeOpenAiCompatibleAudio()` with a direct `globalThis.fetch()` call.
This preserves correct FormData serialization and still routes through the
global `EnvHttpProxyAgent` dispatcher set by EasyClaw's `proxy-setup.cjs`,
so proxy/firewall configurations (including GFW bypass) are honored.

**Upstream issues:**
- openclaw/openclaw#64312 — guarded runtime fetch drops multipart FormData fields
- openclaw/openclaw#64762 — SSRF guard pinned DNS corrupts FormData
- openclaw/openclaw#64766 — incomplete fix (pinDns only)

**Removal:** Drop when upstream openclaw/openclaw#64312 is resolved in a
released version AND verified that FormData multipart encoding works
end-to-end through the SSRF guard without corruption. Test by sending a
voice message via Feishu or Telegram and confirming the agent receives
the transcript text.

## Dropped Patches

### (Dropped in v2026.4.9 upgrade) Respect `ask=off` for obfuscation-triggered approvals

Previously patch 0003. Upstream commit `a74fb94fa3` ("fix(exec): remove host
obfuscation gating") removed the obfuscation detection from both
`bash-tools.exec-host-gateway.ts` and `bash-tools.exec-host-node.ts` entirely,
making this patch unnecessary. The `requiresExecApproval` function with
`ask=off` still returns `false` natively, satisfying the core EasyClaw
requirement.

### (Dropped in v2026.4.11 upgrade) Defer `prewarmConfiguredPrimaryModel`

Wrapped `prewarmConfiguredPrimaryModel()` in `setTimeout(15s)`. Initially
thought necessary for v2026.4.11, but further testing showed: (a) the ~9s
delay was non-deterministic and correlated with specific build artifacts
rather than the patch presence, (b) clean builds without the patch show
375ms sidecars→webchat, (c) the patch actually caused slower startups in
some builds. Root cause of sporadic slowness remains under investigation
but is not consistently reproducible and not solved by this patch.
