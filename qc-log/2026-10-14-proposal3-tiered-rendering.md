# QC Receipt — Proposal 3: Camera-Distance-Tiered Instanced Agent Rendering

**Date:** 2026-10-14
**Scope:** BETA ONLY — `~/workspace/bot-crossing-beta/`, repo `Icyunvbankai/ziggy-colony-beta`,
live beta URL https://icyunvbankai.github.io/ziggy-colony-beta/
**Status:** IMPLEMENTED + TESTED + DEPLOYED TO BETA. Live colony untouched by this work.
**Approver:** Adrian approved the proposal; no push to live without a separate go-ahead.

## 1. Baseline captured (BEFORE any change)

Method: headless Node measurement (no browser/WebGL in this environment) + code
inspection. Numbers are analytic, not browser frame times — see §5 limits.

- Agent draws: **11** (8 worn-part InstancedMesh + crew body + 2 prop phone halves),
  independent of agent count. Bots were **already instanced**.
- Worn-part triangles per bot: helmet 2912 + visor 1376 + face 720 = **5008**,
  plus ~400 (pack/antenna/tip/lamp/hammer) → **~5400/bot** → ~1.04M at 193 bots
  (crew-body GLTF triangles additional, asset size not measurable headlessly).
- Per-frame CPU: `_writeMatrices` rewrote **every** agent's matrices + bone
  attachments **every** frame; `_animate` + face anim advanced for every agent.
- Shadows: `renderer.shadowMap.autoUpdate` never set → three default **true** →
  **full shadow pass every frame (60/s)**, even when nothing moved.
  Shadow camera already tight (SHADOW_EXTENT=30 around view focus, `sky.js`).

**Honest re-scope (proposal §5):** the proposal's premise "collapse ~193 agent
draws to ~2" does NOT hold for this codebase — draws were already ~11. The real
wins implemented instead: (1) frozen + throttled shadow map, (2) near-only
per-frame bone/matrix/animation work, (3) far dots / mid low-poly geometry
replacing ~5400-tri worn parts at distance, (4) near-only shadow casting via
near-only instance sets. The tier system was built around those, not pushed
through on the false premise.

## 2. Tiers implemented per spec

New module `src/agents/agent-tiers.js` (fresh code, no copied code, three.js
primitives only; blob texture generated procedurally into a DataTexture):

| Tier | Rendering | Shadows | Animation | Picking |
|---|---|---|---|---|
| Near (camera dist < 26 in / 34 out) | Existing full instanced bot (parts + crew + props), labels/badges, face | **ONLY tier that casts** (part meshes hold near bots only) | Full, per-frame | Full multi-part body capsules |
| Mid (34–88 / 100) | ONE InstancedMesh, low-poly bot, **112 tris** | Blob shadow: ONE InstancedMesh of quads, radial-gradient texture, opacity 0.38, depthWrite off. Never dynamic shadows. | None; matrices on move / status change / tier change / 4 Hz tick | Single head-proxy sphere |
| Far (> 100 in / 88 out) | ONE InstancedMesh, flat 12-tri ground dots, position + colour only | None | None; same reduced cadence | Single head-proxy sphere |

- **Shared palette:** `STATUS_TRIM` in `agent-tiers.js` is the single source;
  `astronauts.js` `AGENT_LOOK` trims derive from it. Mid/far instance colours
  come from the same table — colour meaning never changes across tiers.
  Test asserts mid colour == far colour for every status.
- **Transitions:** hysteresis (NEAR_IN 26 / NEAR_OUT 34, FAR_IN 100 / FAR_OUT 88)
  + grow-in scale blend 0.7→1 over 0.25 s. NOTE: this is a grow-in, not a
  two-tier dithered cross-fade — double-draw blending was cut to keep slot
  accounting correct; hysteresis + grow-in is the pop mitigation shipped.
- **Terrain:** no terrain rebuild (per STAYS). Terrain receives shadows but the
  shadow map no longer re-renders per frame (frozen + throttled, §3). Shadow
  frustum already tight (SHADOW_EXTENT=30, focus-tracked) — verified, unchanged.
- **Camera UX (only the three specified):**
  (a) persistent tier/quality indicator: `.tier-chip` HUD pill, always visible
  (`LOD · N near · M mid · F far`, or `LOD off · legacy renderer`), plus the
  tier mix appended to the Show-FPS readout;
  (b) click-to-focus / selection forces the bot into near tier while focused
  (`setForcedNear`, wired in `select()`; cleared on deselect);
  (c) badges (per-bot labels) render only for near-tier bots when tiers are on;
  non-near `badgeSize` is explicitly cleared so no phantom pick bubble remains.
  No new camera modes, no fly-through, no control-scheme change.
- **instanceId → agent map:** `TierMeshes.midMap / farMap`, rebuilt every frame;
  `agentForInstance(tier, instanceId)` resolves raycast hits. Covered by tests.
- **Flag:** settings key `agentTiers` (default true in beta). OFF = legacy renderer
  (all bots near, shadow map re-rendered every frame) + tier meshes hidden.
  Toggle in Settings → View → "Agent distance tiers". Not a preset key, so
  preset changes never silently flip it.

### Shadow freezing (the largest per-frame win)

- `Engine.setTieredShadows(true)`: `shadowMap.autoUpdate = false`.
- Shadow map renders only on `requestShadowUpdate()`: near-set change, near bot
  moved > 0.1 (gated to ≤ ~7 renders/s by `ShadowGate`, 150 ms), or the sun
  moving under autoTime/clockTime (≤ 1 render/s). `engine.shadowUpdates`
  counts tiered shadow renders for verification.
- Terrain / buildings / ship / fauna casters unchanged — they still cast, but
  their shadow map is re-rendered on demand instead of every frame.

### Files changed (beta only)

- NEW `src/agents/agent-tiers.js`, NEW `test/agent-tiers.test.mjs`
- `src/agents/astronauts.js` (tier assignment, near-only writes/anim, tier pick proxy, forced-near, shadow-dirty)
- `src/core/engine.js` (tiered shadow freeze + request + counter)
- `src/core/settings.js` (`agentTiers` flag)
- `src/game/colony.js` (camera pos → astronauts, near-only badges, `tierStats()`)
- `src/main.js` (shadow wiring, forced-near on select, HUD tier stats, sun tick)
- `src/ui/hud.js` + `src/ui/styles.css` (toggle + tier chip)

STAYS honoured: Three.js/WebGL, no engine switch, no WebGPU shadows, no skeletal
baking, no terrain regeneration, no new bot models, no server change, no
sync/threads.json change. No code copied from any source; nothing from a
NOASSERTION-licensed repo.

## 3. Verification — proposal §4 table

| Area | Before | After (beta, tiers on) | Verdict |
|---|---|---|---|
| Draw calls (overview) | 11 agent draws | **1** live agent draw (far dots; part meshes + crew hidden; props 2 zero-count draws as before) | ✅ down substantially |
| Draw calls (default zoom ~62) | 11 | **2** (mid + blob; near part meshes only for bots within ~26) | ✅ |
| Triangles (overview, 193 bots) | ~1,042,200 worn-part tris | **2,316** (193 × 12) | ✅ −99.8% |
| Triangles (default zoom) | ~1,042,200 | **22,002** (193 × 112 + 193 × 2 blob) | ✅ −97.8% |
| Shadow passes | 60/s (every frame) | ≤ ~7/s throttled + ≤ 1/s sun tick | ✅ ~8× fewer |
| CPU per frame | All bots: bone + matrix + anim + face, every frame | Near-only bone/matrix/anim; mid/far matrices ≤ 4 Hz or on move | ✅ (code + tests) |
| Frame time (overview) | — | — | ⚠️ NOT measured: no browser/WebGL in this environment. The HUD FPS readout (`Show FPS` + tier mix) is the A/B instrument — compare live beta vs `agentTiers` off in a real browser. |
| No visible popping, slow zoom overview → single bot → back | — | — | ⚠️ NOT visually verified headlessly. Mitigations shipped (hysteresis + grow-in). Needs Adrian's / a browser visual pass. |
| Click-to-identify in each tier | per-part analytic pick | Near: full body capsules. Mid/far: single head-proxy sphere. instanceId maps tested. | ✅ logic + tests; visual click test needs a browser. |
| Status colour consistent across tiers | — | Single `STATUS_TRIM` table; test asserts mid == far per status | ✅ |
| instanceId → agent map correct | n/a | `midMap`/`farMap` rebuilt per frame; tests assert resolution + nulls | ✅ |
| Beta deployed + live URL verified | — | Beta built (`build-beta.sh` ✅), deployed via `deploy-beta.py` (see §4) | ⏳ Pages build — verify URL below after propagation |

Tests: `npm test` → **151 pass / 0 fail** (incl. 8 new `agent-tiers` tests:
hysteresis both bands, forced-near, blend scale, palette identity, geometry
costs, blob falloff, counts/maps/colours, skip-slot stability, shadow gate).
Build: `build-beta.sh` → vite build ✅, tier strings present in bundle.

## 4. Deploy

- Beta build staged to `docs/` via `build-beta.sh` ✅
- Deployed to `Icyunvbankai/ziggy-colony-beta` via `deploy-beta.py` — see
  deploy output in the delivery report (commit + Pages status).
- Live-beta check: https://icyunvbankai.github.io/ziggy-colony-beta/ — after the
  Pages build propagates (several minutes), confirm it loads, the tier chip
  reads `LOD · N near · M mid · F far`, and toggling `agentTiers` off restores
  the legacy renderer. (A fresh fetch showing old content + 404s on new assets
  right after a confirmed commit usually means the Pages build is still running
  — check `/repos/Icyunvbankai/ziggy-colony-beta/pages/builds/latest`.)
- **Live colony untouched by this work** — no commits, deploys, or sync changes
  to `~/workspace/bot-crossing/` or `ziggy-colony`. (That dir shows
  pre-existing uncommitted changes from other sessions; none are mine.)

## 5. Honest limits / follow-ups for the Lead

1. **No browser in this environment** → no measured frame time, no visual
   popping check, no visual blob-shadow side-by-side. The blob fallback rule
   stands: if blobs look noisy in a browser pass, remove them (mid bots keep
   working with no shadows) — never re-enable dynamic shadows for mid/far.
2. **Transition is grow-in + hysteresis**, not a dithered two-tier cross-fade.
   If Adrian's visual pass shows popping, the next iteration is a true
   cross-fade (draw the bot in both tiers during the 0.25 s blend).
3. **Mid geometry is a fresh low-poly bot** (~112 tris), not the near silhouette
   — correct per the proposal (ONE InstancedMesh of a single low-poly bot).
4. **Badge filtering** hides far/mid badges by design (labels toggle = near
   only). Waiting/blocked bots at overview are still findable by colour +
   click-to-focus, but their `?`/`!` badges only appear when near. If Adrian
   wants urgent badges at all distances, that is a one-line change in
   `colony.js` (pass urgent agents through the badge filter) — flag for his call.
