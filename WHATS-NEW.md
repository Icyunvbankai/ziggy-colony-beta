# Ziggy's Colony — BETA: What's New

**Beta URL:** https://icyunvbankai.github.io/ziggy-colony-beta/
**Live colony (untouched):** https://icyunvbankai.github.io/ziggy-colony/

> 🧪 **BETA — TEST COLONY.** This is a separate build for Adrian to beta test.
> It reads the SAME real agent data as the live colony at runtime, but nothing
> done here changes the live colony. It never replaces live and never
> auto-promotes.

## What improved

### 0. StarNet patterns — steal what's worth stealing (beta only)
Three ideas borrowed from StarNet's evaluation (study-only — the app itself
was NOT adopted), adapted to a visualization that must never act:
- **Truthful telemetry:** every snapshot entry is schema-validated before it
  renders. Entries that fail are dropped, counted, and reported — never
  smoothed. Missing stamps are counted as unproven, never backfilled. A new
  panel line shows the scan's health honestly: PROVEN / PARTIAL / STALE /
  UNKNOWN, with counts and scan age.
- **Object = capability (display only):** map objects project onto the
  capabilities they stand for (HQ → team overview, distress beacon →
  attention request, pond → nothing), recomputed fresh, with a kill-switch
  that drops whole grant families from the display. Never permissions, never
  real actions.
- **Outbox + Task Brief + spend rail (display / concept only):** the Outbox
  lists decisions waiting, derived only from the snapshot (blocked, then
  waiting-on-you) — empty means empty. A Task Brief turns the first waiting
  item into one concrete question with options; the options are concept-only
  and do nothing. The spend rail reads $0 spent / $0 authorized — agents
  spend nothing by rule; StarNet's $25/day soft rail is shown as a reference
  design, NOT enabled. Nothing here is wired to spending, accounts, or real
  agent control.
- Open the panel with the **Outbox · Briefs · Spend** button, bottom-right.

### 1. Real topography — the ground is not flat anymore
- **Hills and valleys:** a seeded heightmap (deterministic — the same ground
  every load) gives the colony rolling hills, ridged valleys and a shoreline.
  The colony now reads as an island with a coast, not a diorama on a disc.
- **Water:** ponds in the low ground plus a sea around the colony edge. Valley
  floors sit just under the water level, so ponds are shallow — bots wade,
  they never swim.
- **Plots sit ON the terrain:** every stack's slab lifts onto its own terrace.
  The ground flattens under each plot and slopes up to it, so paths climb to a
  plot instead of stepping off a cliff. Slabs have deep mesa skirts, so a plot
  on a hillside reads as a terrace, never a floating tile.
- **Bots walk the terrain:** boots follow the ground — up hills, down into
  hollows, across the aprons between plots. Props, scatter, grass and the
  lander all sit on the same height field, so nothing floats or sinks.
- **Terrain shapes the layout:** high ground, low ground and water are real
  geography now — where a stack lands changes what its ground looks like.

### 2. Claimed tasks (amux-inspired)
- A **spinning diamond** floats above every WORKING bot, in its stack's accent
  colour — the task it has claimed, visible from across the map.
- Click a bot: its detail card names its **claimed task** (its current work).

### 3. Worker awareness + agent lens (commit-city-inspired)
- Every bot wears a **status-coloured ring**: green = working, red = blocked,
  amber = waiting, grey = idle, purple = sleeping, gold = celebrating.
- **Activity as a place:** live stacks read bright; dormant stacks sit quiet
  and dim. The map reads at a glance — bright ground is where the work is.
- Detail cards show **adapter / source / ref info** (which harness adapter
  owns the thread, where the record came from) plus the bot's role.

### 4. Behaviour by state (ccworkspace-inspired)
- Bots already animate by state (hammering, wandering, sleeping); the beta
  adds the overlays that make state legible at distance: claim markers for
  working, beacons for blocked, dimming for dormant.

### 5. Blocked / waiting beacons (thisoffice-inspired, clean-room)
- A **tall pulsing red light pillar** stands over every BLOCKED bot — the one
  state that wants a human gets the loudest thing on the map.
- The detail card adds a **distress line** when a bot is blocked.

### 6. Home desks (citylife-inspired, clean-room)
- Every bot has a **home desk** at its home tile, in its stack's colour —
  the desk it returns to. Dormant bots sit at their desks; the colony reads
  as a place with addresses, not a crowd milling on a plane.
- Detail cards show the bot's **home desk coordinates**.

### 7. Visual upgrades everywhere
- **Day/night cycle** drifts on its own (240 s per full day) — lighting,
  shadows and night lamps show themselves off with no clicks.
- Terrain is vertex-coloured by height and slope: sand at the shore, grass on
  the flats, rock on steep slopes, snow on the peaks.
- Same camera as live (drag to pan, right-drag to tilt/rotate, scroll to zoom
  to cursor, `O` for auto-orbit), same instanced bots, same 60 fps target —
  the overlays cost 4 extra draw calls total, however many bots are on screen.

## Data
- **Real data, nothing invented:** the beta fetches the live colony's
  published `threads.json` + per-stack files at runtime from the live repo.
- If the live fetch fails, it falls back to a bundled copy of that same public
  data (`beta-data/`, shipped with the build).
- The beta **never writes** to the live repo, never pushes a snapshot, and
  saves only to this browser's localStorage on the beta origin.

## How to beta test
1. Open the beta URL. Confirm the red **🧪 BETA — TEST COLONY** banner is
   pinned to the top (and the footer/help sheet says BETA).
2. **Terrain:** zoom out. You should see hills, valleys, ponds and a sea
   around the colony — not a flat disc. Plots should sit on terraces; no slab
   should float or be swallowed.
3. **Bots:** 189 bots across 30 stacks (same counts as live). Bots should walk
   over hills without sinking or floating. Working bots carry a spinning
   diamond; blocked bots (if any) carry a red pillar.
4. **Desks:** zoom into any plot — every bot should have a small desk at its
   home tile.
5. **Dimming:** find a dormant stack (all bots sleeping) — its plot should
   read visibly dimmer than a live one.
6. **Detail card:** click a bot — check claimed task, home desk, adapter /
   source / role lines.
7. **Camera:** drag / right-drag / scroll / `O` — all should feel smooth.
8. **Console:** open DevTools — there should be no errors on load.
9. Compare with live if anything looks off — live is untouched, so any
   difference is a beta difference.

## Known beta limits
- Water is a calm translucent plane (no ripples/foam yet) — glassy by design.
- Bots wade through shallow ponds rather than routing around them.
- Terrain is a fixed seed: the land does not re-roll between visits (by
  design — a map you learn).
