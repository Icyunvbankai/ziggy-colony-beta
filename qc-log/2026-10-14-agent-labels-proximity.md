# QC receipt — Beta proximity-gated agent name plates

Date: 2026-10-14 (EDT)
Scope: BETA colony only (https://icyunvbankai.github.io/ziggy-colony-beta/, repo ziggy-colony-beta).
Change: per-agent name plates hidden by default, shown only at close proximity.
Adrian: beta visual pass APPROVED ("looks good") + this change requested.

## Finding that shaped the implementation

The beta had NO per-agent name plates at all (only stack HQ plates + `?`/`!`
badges). The clutter Adrian described matches the live colony's always-on agent
plates. Implemented the requested end-state behavior in beta: agent name plates
exist, but stay hidden until the camera is close — so the beta map reads clean
at overview zoom and names appear only when leaning in to a bot.

## What changed (beta only, live untouched)

- `src/world/plots.js`: `createLabel` accepts an `opts` override
  (height/fontSize/dot/gap/pad, defaults = existing project plate). New
  `agentLabelText(thread)` (title → name → id → 'Untitled thread') and
  `createAgentLabel(text, accent)` — compact plate (height 0.30, fontSize 26,
  no accent dot), same billboarded style as project plates.
- `src/agents/agent-tiers.js`: new `agentLabelNear({tiersOn, tier, distance,
  prevNear})` — tiers on: follows the bot's tier (near only); tiers off:
  distance gate on the same NEAR_IN 26 / NEAR_OUT 34 hysteresis band.
  Default orbit is ~62, close inspection ~10–25, so at default zoom no bot is
  near and no agent plate shows.
- `src/game/colony.js`: new `agentLabelGroup` + `agentLabels` cache;
  `_syncAgentLabels()` (create once per agent, remake on name change, dispose
  on roster exit; accent = stack accent); `_updateAgentLabels(dt)` (plate
  follows its bot at groundY + 2.3, opacity damped toward 1 when near +
  showLabels on, else 0). Stack HQ plates untouched. Badges (`?`/`!`) left
  as-is (near only) — the urgent-badges question stays open.
- `deploy-beta.py`: fixed stale import path
  `/opt/hatch/skills/skill-creator/bin` → `/opt/muse/skills/custom-connector-setup/bin`
  (same stale path that broke the live pusher earlier).

## Verification

| Check | Result |
|---|---|
| `npm test` | PASS — 155/155 (151 before + 4 new in test/agent-labels.test.mjs: text fallback, tiers-on gate, tiers-off distance + hysteresis, compact vs project plate geometry) |
| `build-beta.sh` | PASS — new bundle `docs/assets/index-Dnn1vn99.js`; zero absolute `src="/` / `href="/` refs in docs/index.html; bundle contains the new code ("Untitled thread", "agent:") |
| Deploy to beta repo | PASS — commit `515e46cc` (parent `90738639`), new bundle in commit tree. Final Pages-source PUT errored empty-body AFTER the commit landed (known wart, Pages already main:/docs) — no retry, no duplicate push. |
| Live beta URL | PASS — `https://icyunvbankai.github.io/ziggy-colony-beta/` serves `./assets/index-Dnn1vn99.js`, bundle HTTP 200 |
| Live colony | UNTOUCHED — no reads beyond comparison, no writes, no deploys to ziggy-colony |

## Limits

- No live-browser visual check by this agent (subagents cannot drive a browser):
  the visual confirmation that plates appear at close zoom and stay hidden at
  overview needs a live-browser task (parent/root) or Adrian's own pass.
- The `?`/`!` urgent-badges-at-all-distances question is still open; badges
  remain near-only per the earlier decision.

Verdict: PASS (beta). Promotion to live is a separate step requiring Adrian's
go-ahead — NOT done in this receipt.
