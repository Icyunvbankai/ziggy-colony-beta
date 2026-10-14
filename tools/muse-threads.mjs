#!/usr/bin/env node
/**
 * Static-hosting companion to the Muse harness adapter.
 *
 * The Bot Crossing server scans harness files on a poll and serves /api/threads.
 * On static hosting (GitHub Pages) there is no server, so this script plays that
 * role: it runs the Muse adapter against the runtime-written snapshot and emits
 * the exact JSON the static client fetches.
 *
 * Agent-level redesign (2026-10-14) — one run writes THREE outputs:
 *   1. docs/threads.json            — merged bundle, compat path. Shape
 *      { threads, scannedAt, warnings, stacks } — the extra `stacks` field is
 *      additive; the existing client reads `threads` and ignores the rest.
 *      The client prefers per-stack files with fallback to this bundle.
 *   2. docs/threads/<stack>.json    — one file per stack (29), each holding
 *      that stack's agent threads in the same thread shape:
 *      { stack_id, stack_title, agents: [...], scannedAt, warnings: [] }.
 *      Legacy (non-agent) threads, if any, group by project slug instead.
 *   3. docs/threads/manifest.json   — { scannedAt, total_agents, stacks:
 *      [{ stack_id, stack_title, file, agent_count }] } — the file list the
 *      client and the pusher both read, so no list is hard-coded twice.
 *
 * Usage:
 *   node tools/muse-threads.mjs [--out docs/threads.json] [--seed-state docs/state.json]
 *     [--stack-dir docs/threads]
 *
 * The refresh job runs this after rebuilding data/muse-snapshot.json, then
 * pushes the changed files (see ~/workspace/bin/bot-crossing-push-stack-threads.py).
 *
 * state.json is seeded ONCE (empty colony state, version 2). It is never
 * overwritten: on static hosting the browser persists archives/layout to
 * localStorage, and state.json is only the first-run seed.
 */
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import muse from '../server/harnesses/muse.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.join(here, '..')

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const outPath = path.resolve(repo, flag('--out', 'docs/threads.json'))
const statePath = path.resolve(repo, flag('--seed-state', 'docs/state.json'))
const stackDir = path.resolve(repo, flag('--stack-dir', 'docs/threads'))

const slug = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown'

const detected = await muse.detect()
const { threads, stacks, generatedAt } = detected && typeof muse.scanSnapshot === 'function'
  ? await muse.scanSnapshot()
  : { threads: detected ? await muse.scanThreads() : [], stacks: [], generatedAt: 0 }
// Determinism: scannedAt tracks the snapshot's generatedAt (fallback wall
// clock), so regenerating from the same snapshot yields byte-identical
// output. The pusher ignores scannedAt when comparing stack files / the
// bundle, and byte-compares the manifest so its stamp still bumps each sync.
const scannedAt = Number.isFinite(generatedAt) && generatedAt > 0 ? generatedAt : Date.now()

// Merged bundle (compat path) — same shape as before, plus the additive
// `stacks` summary section.
const payload = { threads, scannedAt, warnings: [], stacks }
await fsp.mkdir(path.dirname(outPath), { recursive: true })
await fsp.writeFile(outPath, JSON.stringify(payload, null, 2))
console.log(`wrote ${threads.length} Muse thread(s) → ${outPath}`)

// Per-stack files. Group key: the thread's stack_id for agent threads;
// the project slug for legacy threads (which carry no stack_id).
const groups = new Map()
for (const thread of threads) {
  const key = thread.stack_id || slug(thread.project)
  if (!groups.has(key)) groups.set(key, [])
  groups.get(key).push(thread)
}
await fsp.mkdir(stackDir, { recursive: true })
const manifestStacks = []
for (const [key, agents] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  const file = `${key}.json`
  const stackTitle = agents[0]?.stack_title || agents[0]?.project || key
  const stackPayload = {
    stack_id: key,
    stack_title: stackTitle,
    agents,
    scannedAt,
    warnings: [],
  }
  await fsp.writeFile(path.join(stackDir, file), JSON.stringify(stackPayload, null, 2))
  manifestStacks.push({ stack_id: key, stack_title: stackTitle, file, agent_count: agents.length })
}
const agentThreads = threads.filter((t) => t.source === 'agent').length
const manifest = {
  scannedAt,
  total_agents: agentThreads,
  total_threads: threads.length,
  stacks: manifestStacks,
}
await fsp.writeFile(path.join(stackDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log(`wrote ${manifestStacks.length} stack file(s) + manifest → ${stackDir}`)

try {
  await fsp.access(statePath)
  console.log(`state seed already exists, left alone → ${statePath}`)
} catch {
  await fsp.mkdir(path.dirname(statePath), { recursive: true })
  await fsp.writeFile(
    statePath,
    JSON.stringify(
      {
        version: 2,
        archived: [],
        archivedAt: {},
        opened: [],
        plots: {},
        seen: {},
        hiddenProjects: [],
        viewedAt: {},
        settings: null,
        updatedAt: 0,
      },
      null,
      2
    )
  )
  console.log(`seeded empty colony state → ${statePath}`)
}
