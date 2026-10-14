/**
 * Muse harness adapter (agent-level redesign, 2026-10-14).
 *
 * Muse (Meta's personal agent) has no local transcript files for this colony to read —
 * its activity lives in the Muse runtime. So instead of scanning a session directory,
 * this adapter reads a snapshot file the runtime writes: a factual dump of live work
 * (scheduled jobs, running subagents) plus their real status signals. The adapter owns
 * the presentation mapping (stack zones, building size); the snapshot itself carries
 * only facts.
 *
 * Snapshot schema (written by the runtime via tools/build-agent-snapshot.mjs;
 * roster: ~/workspace/bot-crossing-build/agent-roster.json):
 *   { generatedAt: <epoch ms>,
 *     items: [{                       // ONE PER AGENT (164)
 *       kind: 'agent', id: 'agent:<agent_id>',
 *       agent_id, name, role, stack_id, stack_title,
 *       preview,                       // the STACK's latest factual line (shared)
 *       createdAt, lastActivityAt,     // null = no activity in window → dormant
 *       running, lastRunStatus: 'ok' | 'failed' | '', runs, subagents }],
 *     stacks: [{                       // ONE PER STACK (29) — zone summary
 *       stack_id, stack_title, agent_count, preview,
 *       createdAt, lastActivityAt, running, lastRunStatus, runs }] }
 *
 * Thread mapping (per agent item):
 *   - `project` = the stack title: each STACK is one project zone on the map.
 *     Agents are bots on tiles within their stack's zone; `tile_index` is the
 *     agent's stable slot inside its stack (roster order, 0-based), so the
 *     client can place each bot on its own tile without inventing positions.
 *   - Status fields are inherited from the stack: `running`, `hasError`/`unread`
 *     from the stack's `lastRunStatus === 'failed'`, `lastActivityAt` from the
 *     stack (null → now−4d so the bot sleeps). Per-agent activity is never
 *     invented — every agent in a stack shares that stack's evidence.
 *   - `sizeBytes` uses the stack's run count (same value for every agent in a
 *     stack), so a client that renders one building per stack has one
 *     consistent size for the zone.
 *
 * Backwards compatibility: legacy snapshots with `kind: 'team'` / `'main'`
 * items (pre-redesign) still map through the old PROJECT_RULES path, so the
 * merged threads.json keeps working for the one existing consumer while the
 * client rolls over to per-stack files.
 *
 * Everything else follows the adapter contract in server/harnesses/README.md:
 * read-only, malformed snapshot → empty list (never throw the scan away), and no
 * deep link — Muse threads live in the Muse app, so Open is honestly unavailable.
 */
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const SNAPSHOT =
  process.env.BOT_CROSSING_MUSE_SNAPSHOT || path.join(here, '..', '..', 'data', 'muse-snapshot.json')

async function readSnapshot() {
  try {
    const raw = JSON.parse(await fsp.readFile(SNAPSHOT, 'utf8'))
    const items = Array.isArray(raw?.items) ? raw.items : []
    const stacks = Array.isArray(raw?.stacks) ? raw.stacks : []
    return { items, stacks, generatedAt: Number(raw?.generatedAt) || 0 }
  } catch {
    // Missing or half-written snapshot (the runtime writes it on a timer) — skip the
    // pass rather than failing the whole scan.
    return { items: [], stacks: [], generatedAt: 0 }
  }
}

const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback)
const str = (v) => (typeof v === 'string' ? v : '')

/**
 * Legacy workstream → hex zone. First match wins. Only used for pre-redesign
 * `team` / `main` snapshot items; agent items use their stack title directly.
 */
const PROJECT_RULES = [
  [/team:social-/i, 'Social'],
  [/team:github-team/i, 'GitHub Team'],
  [/alts/i, 'ALTS AM'],
  [/glitchmobz|clips/i, 'GlitchMobz Clips'],
  [/sunshine|aceloco|instagram|drip/i, 'Instagram Drips'],
  [/giveaway|terp/i, 'Terp Giveaway'],
  [/prompt-pack/i, 'Prompt Packs'],
  [/site-ads|hourly-ad|ad-drip|\bads\b/i, 'Ads'],
  [/zona/i, 'ZONA'],
  [/tiktok/i, 'TikTok Shop'],
  [/commission|whatsapp|shop/i, 'Shop'],
  [/colony|bot-crossing/i, 'Colony'],
  [/bar-exam|bitstream|podcast|w-news|news/i, 'Bitstream Podcast'],
  [/grant/i, 'Grants'],
  [/honda|navi/i, 'Honda Navi Watch'],
  [/basel|ticket/i, 'Basel Tickets'],
  [/aws|key-rotation|secret|hygiene/i, 'Operations'],
  [/transcribeme/i, 'TranscribeMe'],
  [/fiverr|etsy/i, 'Fiverr + Etsy'],
]

const projectFor = (item) => {
  const hay = `${item.id || ''} ${item.title || ''}`
  for (const [re, project] of PROJECT_RULES) if (re.test(hay)) return project
  return 'Operations'
}

const isAgentItem = (item) => item?.kind === 'agent' || (typeof item?.agent_id === 'string' && typeof item?.stack_id === 'string')

function mapItem(item, tileIndex, now) {
  // No observed activity: treat as dormant (4 days quiet) so the colony's
  // own sleep rule puts the bot down instead of showing it as just-active.
  const lastActivityAt = item.lastActivityAt ? num(item.lastActivityAt, now) : now - 4 * 24 * 3600 * 1000
  const failed = item.lastRunStatus === 'failed'
  const runs = num(item.runs, 0)
  const base = {
    id: `muse:${item.id}`,
    preview: str(item.preview),
    projectPath: '',
    worktree: '',
    cwd: '',
    gitBranch: '',
    model: 'Muse Spark',
    effort: '',
    createdAt: num(item.createdAt, lastActivityAt),
    lastActivityAt,
    lastFocusedAt: 0,
    running: Boolean(item.running),
    // A failed last run is the colony's `?`: something here wants a look.
    unread: failed,
    hasError: failed,
    starred: false,
    routine: false,
    prState: '',
    archived: false,
    canOpen: false,
    subagents: Array.isArray(item.subagents)
      ? item.subagents
          .filter((s) => s && typeof s.id === 'string')
          .map((s) => ({ id: s.id, task: str(s.task), lastActivityAt: num(s.lastActivityAt, now) }))
      : [],
  }
  if (isAgentItem(item)) {
    // Agent-level item: the stack is the zone; the agent is a bot on a tile.
    const stackTitle = str(item.stack_title) || 'Operations'
    return {
      ...base,
      title: str(item.name) || 'Untitled agent',
      project: stackTitle,
      stack_id: str(item.stack_id),
      stack_title: stackTitle,
      agent_id: str(item.agent_id),
      agent_role: str(item.role),
      // Stable tile inside the stack's zone (roster order). The client assigns
      // one tile per agent; the largest stack has 11 agents, well under the
      // 63-slot per-project tile capacity.
      tile_index: tileIndex,
      // Building size is a visual proxy for real completed-work counts, never
      // a made-up number. Shared per stack so a per-stack building has one size.
      sizeBytes: 2000 + Math.min(runs, 200) * 1500,
      source: 'agent',
      ref: { kind: 'agent', id: item.id, agent_id: str(item.agent_id), stack_id: str(item.stack_id) },
    }
  }
  // Legacy team / main item: pre-redesign mapping, unchanged.
  return {
    ...base,
    title: str(item.title) || 'Untitled thread',
    project: projectFor(item),
    stack_id: '',
    stack_title: projectFor(item),
    agent_id: '',
    agent_role: '',
    tile_index: 0,
    // Building size is a visual proxy for real completed-work counts, never
    // a made-up number: long-running jobs have bigger buildings.
    sizeBytes: item.kind === 'main' ? 20000 : 2000 + Math.min(runs, 200) * 1500,
    source: str(item.kind) || 'muse',
    ref: { kind: str(item.kind) || 'muse', id: item.id },
  }
}

async function scanSnapshot() {
  const { items, stacks, generatedAt } = await readSnapshot()
  // Determinism: derive `now` from the snapshot's own generatedAt (fallback
  // wall clock) so regenerating from the same snapshot yields byte-identical
  // output — dormant-agent fallbacks (now-4d) and subagent fallbacks must not
  // drift with wall-clock time between runs.
  const now = generatedAt > 0 ? generatedAt : Date.now()
  // Stable per-stack tile assignment: snapshot order is roster order (the
  // builder emits agents stack by stack), so the first agent seen for a
  // stack takes tile 0, the next tile 1, and so on.
  const tileCounters = new Map()
  const threads = items
    .filter((item) => item && typeof item.id === 'string' && item.id)
    .map((item) => {
      let tileIndex = 0
      if (isAgentItem(item)) {
        tileIndex = tileCounters.get(item.stack_id) || 0
        tileCounters.set(item.stack_id, tileIndex + 1)
      }
      return mapItem(item, tileIndex, now)
    })
  // Stack summaries: prefer the snapshot's own `stacks` section; derive from
  // threads when running against a legacy snapshot that has none (legacy
  // threads carry no stack_id, so they group by project).
  const outStacks = stacks.length
    ? stacks.map((s) => ({
        stack_id: str(s.stack_id),
        stack_title: str(s.stack_title),
        agent_count: num(s.agent_count, 0),
        preview: str(s.preview),
        lastActivityAt: s.lastActivityAt ?? null,
        running: Boolean(s.running),
        lastRunStatus: str(s.lastRunStatus),
        runs: num(s.runs, 0),
      }))
    : (() => {
        const byKey = new Map()
        for (const t of threads) {
          const key = t.stack_id || t.project
          if (!byKey.has(key)) byKey.set(key, [])
          byKey.get(key).push(t)
        }
        return [...byKey.entries()].map(([key, list]) => ({
          stack_id: key,
          stack_title: list[0]?.stack_title || list[0]?.project || key,
          agent_count: list.length,
          preview: list[0]?.preview || '',
          lastActivityAt: list[0]?.lastActivityAt ?? null,
          running: Boolean(list[0]?.running),
          lastRunStatus: list[0]?.hasError ? 'failed' : '',
          runs: 0,
        }))
      })()
  return { threads, stacks: outStacks, generatedAt }
}

export default {
  id: 'muse',
  name: 'Muse',

  detect: async () => {
    try {
      await fsp.access(SNAPSHOT)
      return true
    } catch {
      return false
    }
  },

  scanThreads: async () => (await scanSnapshot()).threads,

  // Full agent-level scan: threads + per-stack summaries (used by the
  // generator to write per-stack files + the manifest).
  scanSnapshot,

  openThread: () => ({
    ok: false,
    error: 'Muse threads live in the Muse app — this colony is a viewer.',
  }),

  newSession: () => ({
    ok: false,
    error: 'New Muse threads start in the Muse app.',
  }),
}
