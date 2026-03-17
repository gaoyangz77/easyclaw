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

- `0001-vendor-openclaw-add-browser-lifecycle-hooks-for-plug.patch`
  - adds browser lifecycle hooks required by
    `extensions/browser-profiles-tools/`
