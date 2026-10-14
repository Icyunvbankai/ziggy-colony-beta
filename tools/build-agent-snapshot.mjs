#!/usr/bin/env node
/**
 * Agent-level snapshot builder (Bot Crossing agent-level redesign).
 *
 * Reads the agent roster (source of truth for agent definitions) and a
 * stack-state file (live per-stack status gathered by the sync worker from
 * cron runs / QC receipts / queues) and emits the agent-level snapshot:
 *
 *   { generatedAt, items: [ one per AGENT, 164 ], stacks: [ one per STACK, 29 ] }
 *
 * Each agent item inherits its STACK's live state (preview, lastActivityAt,
 * running, lastRunStatus, runs, subagents). Per-agent activity is NEVER
 * invented: agents in a stack with no evidence of activity show dormant via
 * lastActivityAt: null (the adapter maps null to now-4d so the bot sleeps).
 *
 * Carry-forward: a stack missing from --stack-state keeps its previous
 * snapshot preview (from the previous snapshot's `stacks` section), so a
 * quiet stack keeps its last factual line instead of going blank. Anything
 * with no previous preview gets "" — never an invented line.
 *
 * Usage:
 *   node tools/build-agent-snapshot.mjs --stack-state <stack-state.json>
 *     [--roster ~/workspace/bot-crossing-build/agent-roster.json]
 *     [--prev data/muse-snapshot.json] [--out data/muse-snapshot.json]
 *
 * Stack-state shape:
 *   { "stacks": { "<stack_id>": {
 *       "preview": "<one factual line>",
 *       "createdAt": <epoch ms>, "lastActivityAt": <epoch ms | null>,
 *       "running": <bool>, "lastRunStatus": "ok" | "failed" | "",
 *       "runs": <number>, "subagents": [{ "id", "task", "lastActivityAt" }]
 *   } } }
 *
 * The snapshot is LOCAL-ONLY and is never pushed to GitHub.
 */
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.join(here, '..')

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const rosterPath = path.resolve(flag('--roster', path.join(process.env.HOME || '~', 'workspace', 'bot-crossing-build', 'agent-roster.json')))
const stackStatePath = path.resolve(repo, flag('--stack-state', ''))
const prevPath = path.resolve(repo, flag('--prev', 'data/muse-snapshot.json'))
const outPath = path.resolve(repo, flag('--out', 'data/muse-snapshot.json'))

if (!stackStatePath || args.indexOf('--stack-state') < 0) {
  console.error('build-agent-snapshot: --stack-state <file> is required (live per-stack state from the sync worker)')
  process.exit(2)
}

const readJson = async (p, fallback) => {
  try {
    return JSON.parse(await fsp.readFile(p, 'utf8'))
  } catch {
    return fallback
  }
}

const roster = await readJson(rosterPath, null)
if (!roster || !Array.isArray(roster.stacks)) {
  console.error(`build-agent-snapshot: cannot read roster at ${rosterPath}`)
  process.exit(1)
}
const stackState = await readJson(stackStatePath, null)
if (!stackState || typeof stackState.stacks !== 'object' || stackState.stacks === null) {
  console.error(`build-agent-snapshot: stack-state file must be { stacks: { <stack_id>: {...} } }: ${stackStatePath}`)
  process.exit(1)
}
const prev = await readJson(prevPath, { items: [], stacks: [] })
const prevStacks = new Map(
  (Array.isArray(prev?.stacks) ? prev.stacks : []).map((s) => [s?.stack_id, s])
)

const now = Date.now()
const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback)
const str = (v) => (typeof v === 'string' ? v : '')

const items = []
const stacks = []
const seenAgentIds = new Set()

for (const stack of roster.stacks) {
  const hasLive = Object.prototype.hasOwnProperty.call(stackState.stacks, stack.stack_id)
  const live = stackState.stacks[stack.stack_id] || {}
  const prevStack = prevStacks.get(stack.stack_id) || {}
  // Preview: live value wins; else carry the previous snapshot's line; else "".
  // Never invent a preview.
  // Activity fields: the live entry is authoritative when present — an explicit
  // null lastActivityAt means "no activity in the window" and must NOT be
  // overwritten by the previous timestamp (that would keep a dormant stack
  // looking active forever). Only a stack ABSENT from stack-state falls back
  // to its previous entry.
  const preview = hasLive ? (str(live.preview) || str(prevStack.preview)) : str(prevStack.preview)
  const stackEntry = {
    stack_id: stack.stack_id,
    stack_title: stack.stack_title,
    agent_count: Array.isArray(stack.agents) ? stack.agents.length : 0,
    preview,
    createdAt: hasLive ? num(live.createdAt, num(prevStack.createdAt, now)) : num(prevStack.createdAt, now),
    lastActivityAt: hasLive
      ? (live.lastActivityAt === null || live.lastActivityAt === undefined ? null : num(live.lastActivityAt, null))
      : (prevStack.lastActivityAt ?? null),
    running: hasLive ? Boolean(live.running) : Boolean(prevStack.running),
    lastRunStatus: hasLive
      ? (['ok', 'failed', ''].includes(live.lastRunStatus) ? live.lastRunStatus : str(prevStack.lastRunStatus || ''))
      : str(prevStack.lastRunStatus || ''),
    runs: hasLive ? num(live.runs, num(prevStack.runs, 0)) : num(prevStack.runs, 0),
  }
  stacks.push(stackEntry)

  const subagents = Array.isArray(live.subagents) ? live.subagents : []
  for (const agent of stack.agents || []) {
    if (!agent?.agent_id) {
      console.error(`build-agent-snapshot: roster stack ${stack.stack_id} has an agent without agent_id`)
      process.exit(1)
    }
    if (seenAgentIds.has(agent.agent_id)) {
      console.error(`build-agent-snapshot: duplicate agent_id in roster: ${agent.agent_id}`)
      process.exit(1)
    }
    seenAgentIds.add(agent.agent_id)
    items.push({
      kind: 'agent',
      id: `agent:${agent.agent_id}`,
      agent_id: agent.agent_id,
      name: str(agent.name),
      role: str(agent.role),
      stack_id: stack.stack_id,
      stack_title: stack.stack_title,
      preview: stackEntry.preview,
      createdAt: stackEntry.createdAt,
      lastActivityAt: stackEntry.lastActivityAt,
      running: stackEntry.running,
      lastRunStatus: stackEntry.lastRunStatus,
      runs: stackEntry.runs,
      subagents,
    })
  }
}

// Validate against the roster's own totals when present — a silent short
// snapshot would drop bots from the map.
if (roster.totals) {
  if (roster.totals.stacks !== undefined && roster.totals.stacks !== stacks.length) {
    console.error(`build-agent-snapshot: roster totals.stacks=${roster.totals.stacks} but built ${stacks.length} stack summaries`)
    process.exit(1)
  }
  if (roster.totals.agents !== undefined && roster.totals.agents !== items.length) {
    console.error(`build-agent-snapshot: roster totals.agents=${roster.totals.agents} but built ${items.length} agent items`)
    process.exit(1)
  }
}

const snapshot = { generatedAt: now, items, stacks }
await fsp.mkdir(path.dirname(outPath), { recursive: true })
await fsp.writeFile(outPath, JSON.stringify(snapshot, null, 2))
console.log(`wrote ${items.length} agent item(s) + ${stacks.length} stack summaries → ${outPath}`)
