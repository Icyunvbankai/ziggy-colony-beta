import { mergeState } from './merge-state.js'
import { BETA_BRANDING, LIVE_RAW_BASE, FALLBACK_STATE_URL } from '../beta/config.js'
import { assessDataHealth, findProvenanceGaps, validateThreads } from './telemetry.js'

/**
 * Static hosting (GitHub Pages): there is no server, so threads and colony state
 * come from JSON files the publisher refreshes, and saves persist to this
 * browser's localStorage instead of a PUT. Enabled at build time only:
 *   VITE_BOT_CROSSING_STATIC=1 vite build --base=./
 * Off by default — the live-server path below is untouched.
 */
const STATIC = import.meta.env?.VITE_BOT_CROSSING_STATIC === '1'
const STATIC_STATE_KEY = 'botcrossing.static-state'
const STATIC_VIEWER_NOTE = 'This colony is a read-only viewer — Muse threads live in the Muse app.'

async function req(url, options) {
  const res = await fetch(url, options)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `${res.status} ${res.statusText}`)
  return body
}

const post = (url, payload) =>
  req(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

/**
 * Agent-level threads: the manifest + one file per stack, with the old merged
 * bundle as the fallback.
 *
 * Contract (producer: the per-stack generator): `threads/manifest.json` lists the
 * stack files; each stack file holds that stack's agents, either as `threads`
 * (already thread-shaped) or as `agents` (`{ agent_id, name, role }`, mapped to
 * threads below). The manifest carries `generatedAt`/`scannedAt`, which MUST bump
 * whenever any stack file changes — an unchanged stamp is what lets a poll skip
 * refetching every stack file.
 *
 * Partial-failure policy: one missing stack file must NOT retire other stacks'
 * bots. Each stack keeps its last-good threads; a failed stack is retried on the
 * next poll (even when the manifest stamp is unchanged), and the merged list is
 * what `poll()` / `applyThreads()` / `setThreads()` already consume, so nothing
 * downstream changes shape.
 */
const THREADS_MANIFEST_URL = 'threads/manifest.json'
const THREADS_BUNDLE_URL = 'threads.json'

/** Last manifest generation stamp seen; unchanged => stack files need no refetch. */
let lastManifestStamp = null
/** Per-stack last-good threads, keyed by the manifest's stack key. */
const lastGoodByStack = new Map()
/** Last good merged result from any source — returned when a poll fetches nothing new. */
let lastGoodMerged = null
/** Stack keys whose last fetch failed — retried on the next poll. */
const failedStacks = new Set()

/** The manifest's stack list, tolerating its plausible shapes. */
function manifestStacks(manifest) {
  const raw = Array.isArray(manifest)
    ? manifest
    : manifest?.stacks ?? manifest?.files ?? manifest?.threads ?? []
  const out = []
  const push = (entry, fallbackKey) => {
    if (typeof entry === 'string') {
      out.push({ key: fallbackKey, file: entry.includes('/') ? entry : `threads/${entry}`, title: null })
      return
    }
    if (!entry || typeof entry !== 'object') return
    let file =
      entry.file || entry.path || entry.url || entry.href ||
      (entry.stack_id || entry.id ? `threads/${entry.stack_id || entry.id}.json` : null)
    if (!file) return
    // A bare filename in the manifest is relative to the threads/ directory
    // (the live manifest lists `build-team.json`, not `threads/build-team.json`).
    if (!file.includes('/') && !file.startsWith('http')) file = `threads/${file}`
    out.push({
      key: entry.stack_id || entry.id || entry.name || file,
      file,
      title: entry.stack_title || entry.stackTitle || entry.title || entry.name || null,
    })
  }
  if (Array.isArray(raw)) raw.forEach((entry, i) => push(entry, `stack-${i}`))
  else if (raw && typeof raw === 'object') Object.entries(raw).forEach(([k, v]) => push(v, k))
  return out
}

/** Raw entries of one stack/bundle payload, whatever shape the producer used. */
function extractRawEntries(data) {
  if (Array.isArray(data)) return data
  const container = data && typeof data === 'object' ? data : {}
  return container.threads || container.agents || container.stack?.agents || container.stack?.threads || []
}

/** One stack file → thread-shaped entries the colony already understands. */
function normalizeStackThreads(data, stackKey, stackTitle) {
  const container = data && typeof data === 'object' && !Array.isArray(data) ? data : {}
  const project = container.stack_title || container.stackTitle || container.title || stackTitle || stackKey
  const entries = extractRawEntries(data)
  // The live stack files carry `tile_index` in file order; honour it so slot
  // assignment follows the producer's tile order even if file order ever drifts.
  const ordered = [...(entries || [])].sort(
    (a, b) => (a?.tile_index ?? Infinity) - (b?.tile_index ?? Infinity)
  )
  const out = []
  for (const entry of ordered) {
    if (!entry || typeof entry !== 'object') continue
    // Already thread-shaped (the live stack files: full thread fields plus
    // `agent_id` / `agent_role` / `tile_index`): pass through, keeping the
    // producer's own stamps. The roster-presence rule lives in `statusFor`,
    // not here — no timestamp is rewritten.
    if (entry.id && entry.title) {
      out.push({
        ...entry,
        project: entry.project || project,
        lastActivityAt: entry.lastActivityAt || Date.now(),
        createdAt: entry.createdAt ?? 0,
      })
      continue
    }
    // Raw roster shape: `{ agent_id, name, role }` — no thread fields yet.
    if (entry.agent_id || (entry.name && entry.role)) {
      const agentId = String(entry.agent_id ?? entry.id ?? '')
      if (!agentId) continue
      out.push({
        id: typeof entry.id === 'string' && entry.id.startsWith('muse:') ? entry.id : `muse:agent:${agentId}`,
        title: entry.name || entry.title || agentId,
        preview: entry.role || entry.preview || '',
        project,
        // Roster order is the stable order: equal createdAt keeps the file's order
        // through the sort in setThreads, so slots stay put poll to poll.
        createdAt: Number(entry.createdAt ?? entry.created_at ?? 0) || 0,
        // An agent on the roster is present. A missing stamp means "now", not
        // "four days ago" — otherwise every stack reads as dormant and folds away.
        lastActivityAt: Number(entry.lastActivityAt ?? entry.last_activity_at ?? 0) || Date.now(),
        lastFocusedAt: 0,
        running: Boolean(entry.running ?? entry.active ?? false),
        unread: false,
        hasError: Boolean(entry.hasError ?? false),
        starred: false,
        routine: false,
        archived: false,
        prState: '',
        sizeBytes: 2000,
        canOpen: false,
        model: 'Muse Spark',
        source: 'agent',
        projectPath: '',
        worktree: '',
        cwd: '',
        gitBranch: '',
        effort: '',
        subagents: undefined,
        role: entry.role || '',
        ref: { kind: 'agent', id: agentId },
      })
      continue
    }
    // Anything else (an id without a title, or neither shape) is unusable.
  }
  return out
}

/** Recompute data health on a cached merge so a stale re-serve still reads stale. */
function withFreshHealth(merged) {
  if (!merged) return merged
  return {
    ...merged,
    dataHealth: assessDataHealth({
      threads: merged.threads || [],
      scannedAt: merged.scannedAt ?? null,
      warnings: merged.warnings || [],
      gapCount: merged.gapCount || 0,
      invalidCount: merged.invalidCount,
      failedStacks: merged.failedStacks || 0,
    }),
  }
}

async function fetchSplitThreads(urlBase = '') {
  const manifestUrl = urlBase ? `${urlBase}/${THREADS_MANIFEST_URL}` : THREADS_MANIFEST_URL
  const res = await fetch(`${manifestUrl}?v=${Date.now()}`)
  if (!res.ok) throw new Error(`Could not load ${manifestUrl} (${res.status})`)
  const manifest = await res.json()
  const stacks = manifestStacks(manifest)
  if (!stacks.length) throw new Error('threads manifest lists no stack files')
  const stamp = manifest.generatedAt ?? manifest.generated_at ?? manifest.scannedAt ?? manifest.scanned_at ?? null

  // Unchanged manifest + no outstanding failures + a cached merge: skip the stack
  // fetches entirely. The manifest is refetched every poll (it is tiny); the tens
  // of KB of stack files are only refetched when something actually changed.
  if (stamp !== null && stamp === lastManifestStamp && !failedStacks.size && lastGoodMerged) {
    return withFreshHealth(lastGoodMerged)
  }
  lastManifestStamp = stamp

  const results = await Promise.allSettled(
    stacks.map(async (stack) => {
      // Cache-buster: Pages caches static files, and the colony polls every 15s.
      // BETA: stack files are fetched from the same base as the manifest
      // (the live repo at runtime, or the bundled fallback copy).
      const stackUrl = urlBase ? `${urlBase}/${stack.file}` : stack.file
      const r = await fetch(`${stackUrl}?v=${Date.now()}`)
      if (!r.ok) throw new Error(`Could not load ${stackUrl} (${r.status})`)
      const raw = await r.json()
      // Truthful telemetry: count unproven stamps on the RAW entries, before
      // normalization fills missing stamps with "now" for layout stability.
      // Entries that fail schema validation are dropped, counted, reported.
      const rawEntries = extractRawEntries(raw)
      const gapCount = rawEntries.reduce((n, e) => n + (findProvenanceGaps(e).length ? 1 : 0), 0)
      const normalized = normalizeStackThreads(raw, stack.key, stack.title)
      const { valid, invalid } = validateThreads(normalized)
      return { stack, threads: valid, gapCount, invalidCount: invalid.length }
    })
  )
  const warnings = []
  let gapCount = 0
  let invalidCount = 0
  results.forEach((result, i) => {
    const stack = stacks[i]
    if (result.status === 'fulfilled') {
      lastGoodByStack.set(stack.key, result.value.threads)
      failedStacks.delete(stack.key)
      gapCount += result.value.gapCount || 0
      invalidCount += result.value.invalidCount || 0
      if (result.value.invalidCount) {
        warnings.push(`Stack ${stack.key}: ${result.value.invalidCount} entr${result.value.invalidCount === 1 ? 'y' : 'ies'} failed validation and were dropped`)
      }
    } else {
      // Keep this stack's last-good bots; the failure is retried on the next poll.
      failedStacks.add(stack.key)
      warnings.push(`Stack ${stack.key} could not be refreshed — showing its last good bots`)
    }
  })

  // Merge in manifest order so the list is deterministic; first id wins.
  const seen = new Set()
  const threads = []
  for (const stack of stacks) {
    for (const thread of lastGoodByStack.get(stack.key) || []) {
      if (seen.has(thread.id)) continue
      seen.add(thread.id)
      threads.push(thread)
    }
  }
  if (!threads.length) throw new Error('No stack files could be loaded')
  const merged = {
    threads,
    scannedAt: typeof stamp === 'number' ? stamp : Date.now(),
    warnings,
    gapCount,
    invalidCount,
    failedStacks: failedStacks.size,
  }
  merged.dataHealth = assessDataHealth({
    threads,
    scannedAt: merged.scannedAt,
    warnings,
    gapCount,
    invalidCount,
    failedStacks: failedStacks.size,
  })
  lastGoodMerged = merged
  return merged
}

/** The old merged bundle — the fallback when the manifest (or every stack file) is gone. */
async function fetchBundleThreads(urlBase = '') {
  // Cache-buster: Pages caches static files, and the colony polls every 15s.
  const bundleUrl = urlBase ? `${urlBase}/${THREADS_BUNDLE_URL}` : THREADS_BUNDLE_URL
  const res = await fetch(`${bundleUrl}?v=${Date.now()}`)
  if (!res.ok) throw new Error(`Could not load ${bundleUrl} (${res.status})`)
  const body = await res.json()
  const rawEntries = extractRawEntries(body)
  const gapCount = rawEntries.reduce((n, e) => n + (findProvenanceGaps(e).length ? 1 : 0), 0)
  const { valid, invalid } = validateThreads(Array.isArray(body) ? body : body.threads || [])
  const out = {
    threads: valid,
    scannedAt: body.scannedAt ?? Date.now(),
    warnings: body.warnings || [],
    gapCount,
    invalidCount: invalid.length,
    failedStacks: failedStacks.size,
  }
  if (invalid.length) {
    out.warnings = [...out.warnings, `${invalid.length} bundle entr${invalid.length === 1 ? 'y' : 'ies'} failed validation and were dropped`]
  }
  out.dataHealth = assessDataHealth({
    threads: valid,
    scannedAt: out.scannedAt,
    warnings: out.warnings,
    gapCount,
    invalidCount: invalid.length,
    failedStacks: failedStacks.size,
  })
  lastGoodMerged = out
  return out
}

export const fetchThreads = async () => {
  if (!STATIC) return req('/api/threads')
  // BETA branding: read the SAME public data the live colony publishes, at runtime,
  // from the live repo. If that fails, fall back to the bundled copy of that
  // public data shipped with this build. The beta never writes anywhere.
  // On live (branding off), data comes from local files — see below.
  if (BETA_BRANDING) {
    try {
      return await fetchSplitThreads(LIVE_RAW_BASE)
    } catch {
      /* live manifest/stack files unreachable: try the live bundle */
    }
    try {
      return await fetchBundleThreads(LIVE_RAW_BASE)
    } catch {
      /* live bundle unreachable: bundled fallback copy */
    }
    try {
      return await fetchSplitThreads('beta-data')
    } catch {
      /* bundled manifest unreachable: bundled bundle */
    }
    try {
      return await fetchBundleThreads('beta-data')
    } catch (err) {
      if (lastGoodMerged) return lastGoodMerged
      throw err
    }
  }
  try {
    return await fetchSplitThreads()
  } catch {
    // Manifest missing, malformed, or every stack file failed: the merged bundle
    // is the old shape the client has always read.
  }
  try {
    return await fetchBundleThreads()
  } catch (err) {
    // A poll that fetches nothing new keeps the last good colony rather than
    // wiping the map; the next poll retries.
    if (lastGoodMerged) return lastGoodMerged
    throw err
  }
}

/**
 * The colony file, and the base every later save is measured against.
 *
 * `baseUpdatedAt` is the file version this tab last agreed with; `baseSnapshot` is the state as
 * it looked at that moment. The snapshot is the half that matters: without it a conflicted save
 * can only union the two lists, and a union can never express "I un-archived this".
 */
let baseUpdatedAt = 0
let baseSnapshot = null

function adoptBase(state, updatedAt) {
  baseUpdatedAt = Number(updatedAt ?? state?.updatedAt) || 0
  // Cloned, because the page mutates the object it holds. Sharing the reference would let
  // `local` and `base` drift into being the same thing, which reads as "this tab changed
  // nothing" and quietly turns every save back into last-writer-wins.
  baseSnapshot = structuredClone(state)
}

export const fetchState = async () => {
  // BETA branding: this browser's own saved state (beta origin) wins, then the live
  // repo's published public state, then the bundled fallback copy. Read-only
  // throughout — the beta never writes to the live repo.
  if (BETA_BRANDING) {
    try {
      const saved = localStorage.getItem(STATIC_STATE_KEY)
      if (saved) {
        const state = JSON.parse(saved)
        adoptBase(state)
        return state
      }
    } catch {
      /* corrupted local state: fall through to the published seed */
    }
    for (const url of [`${LIVE_RAW_BASE}/state.json`, FALLBACK_STATE_URL]) {
      try {
        const res = await fetch(`${url}?v=${Date.now()}`)
        if (!res.ok) continue
        const state = await res.json()
        adoptBase(state)
        return state
      } catch {
        /* try the next source */
      }
    }
    throw new Error('Could not load beta state.json')
  }
  if (STATIC) {
    // This browser's own saved colony wins over the seed file — that is what
    // makes archive/hide/layout persist per device without a server.
    try {
      const saved = localStorage.getItem(STATIC_STATE_KEY)
      if (saved) {
        const state = JSON.parse(saved)
        adoptBase(state)
        return state
      }
    } catch {
      /* corrupted local state: fall through to the seed file */
    }
    const res = await fetch(`state.json?v=${Date.now()}`)
    if (!res.ok) throw new Error(`Could not load state.json (${res.status})`)
    const state = await res.json()
    adoptBase(state)
    return state
  }
  const state = await req('/api/state')
  adoptBase(state)
  return state
}

/** Enough attempts to get through a burst of saves from another tab, and no more. */
const SAVE_TRIES = 3

/**
 * Save the colony, merging rather than clobbering if another tab got there first.
 *
 * The server answers 409 with what is on disk when this tab's base is stale. That is not a
 * failure to report at the user — it is the normal shape of two tabs being open — so it is
 * merged and re-sent here. The base for the next attempt is the disk state just merged against,
 * which keeps a retry from re-applying edits it has already folded in.
 *
 * Returns the state the caller should hold from now on: the *same object* when nothing
 * conflicted, so the common path never swaps the page's state out from under a click that
 * happened mid-flight, and only a real merge hands back something new.
 */
export async function saveState(state) {
  // Nothing may be written before the file has been read. The page boots holding an EMPTY
  // archive list and only swaps it for the real one when fetchState() resolves; a save that
  // slips out inside that window PUTs the empty list and erases every archive on disk.
  //
  // The optimistic-concurrency guard does not cover it, by design: `baseUpdatedAt` is 0 until
  // a base is adopted, and the server reads a zero base as a first write and allows it. That
  // is right for a fresh install and wrong for a tab whose read failed — and the two are
  // distinguishable here, which is why the guard lives at this seam rather than at the caller.
  // A fresh install still *read* the file; the server answers a missing one with an empty state
  // rather than an error, so `baseSnapshot` is an object. Only a read that never happened
  // leaves it null.
  //
  // The damage hides itself, which is what makes this worth a guard rather than a comment: the
  // scan carries each harness's own archived flag independently of this file, so a wiped list
  // reads back populated rather than empty. Measured twice by the contributor who found it —
  // an archive list of 50 came back as 11, exactly the number with a Claude Code desktop record.
  if (baseSnapshot === null) throw new Error('Refusing to save a colony that was never read')

  if (STATIC) {
    // No server: persist to this browser. The next load reads it back via
    // fetchState before the seed file, so archives survive reloads per device.
    const next = { ...state, updatedAt: Date.now() }
    try {
      localStorage.setItem(STATIC_STATE_KEY, JSON.stringify(next))
    } catch {
      /* storage full or blocked: the in-memory state still holds for this session */
    }
    adoptBase(next, next.updatedAt)
    return next
  }

  let local = state
  for (let attempt = 0; attempt < SAVE_TRIES; attempt++) {
    const res = await fetch('/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...local, baseUpdatedAt }),
    })
    const body = await res.json().catch(() => ({}))

    if (res.status === 409) {
      local = mergeState(baseSnapshot, local, body)
      adoptBase(body)
      continue
    }
    if (!res.ok) throw new Error(body.error || `${res.status} ${res.statusText}`)
    adoptBase(local, body.updatedAt)
    return local
  }
  // Losing three times running means the other tab is saving faster than we can merge. The
  // caller swallows this: nothing local is lost, and the next save tries again.
  throw new Error('Could not save the colony — another tab kept writing first')
}

/**
 * Hand a thread back to whichever harness owns it — the desktop app comes forward on its own,
 * or a terminal opens with its CLI, whichever `via` asks for.
 *
 * `ref` is opaque here on purpose: it is whatever that harness's adapter needs to find the
 * thread again, and the browser only ever passes it straight back. Nothing in the UI knows
 * what a Claude Code session id, or a Codex rollout id, actually looks like.
 */
export const openThread = async (thread, via) => {
  if (STATIC) throw new Error(STATIC_VIEWER_NOTE)
  return post('/api/open', { harness: thread.harness, ref: thread.ref, via })
}

/** A brand new thread in a repo, via that harness's own new-session deep link. */
export const newSession = async (folder, harness, via) => {
  if (STATIC) throw new Error(STATIC_VIEWER_NOTE)
  return post('/api/new-session', { folder, harness, via })
}

export const revealFolder = async (folder) => {
  if (STATIC) throw new Error(STATIC_VIEWER_NOTE)
  return post('/api/reveal', { folder })
}
