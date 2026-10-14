/**
 * Truthful telemetry (StarNet pattern, adapted to a visualization).
 *
 * StarNet's product law: "the interface must never assert state the harness
 * cannot prove." The colony is a viewer, not a harness — it can only prove
 * what the published snapshot says. This module is the honesty layer between
 * the snapshot fetch and the render:
 *
 * - Every thread entry is schema-validated. Entries that fail are dropped
 *   from the render, counted, and reported — never silently smoothed.
 * - Provenance gaps (a missing lastActivityAt / createdAt / project stamp)
 *   are counted as UNPROVEN, never backfilled with Date.now() at this layer.
 *   (The renderer still applies its own "missing stamp means now" fallback
 *   for layout stability; that fallback is a display choice, and this module
 *   exists so the panel can say the stamp was never proven.)
 * - Stale, partial, and unknown data get a status the panel shows honestly:
 *   PROVEN / PARTIAL / STALE / UNKNOWN. Truncated or malformed payloads are
 *   failures, never shipped as if they were a full scan.
 *
 * Pure functions only — no DOM, no fetch — so the whole layer is unit-tested.
 */

/** A scan older than this is STALE: two missed 5-minute sync polls. */
export const STALE_AFTER_MS = 10 * 60 * 1000

/** Fields a thread entry must carry to be renderable at all. */
const REQUIRED_STRING_FIELDS = ['id', 'title']

/** Optional fields with their expected types, when present. */
const OPTIONAL_TYPED_FIELDS = {
  running: 'boolean',
  unread: 'boolean',
  hasError: 'boolean',
  archived: 'boolean',
  lastActivityAt: 'number',
  createdAt: 'number',
  project: 'string',
  preview: 'string',
  stack_id: 'string',
  agent_id: 'string',
  agent_role: 'string',
}

/**
 * Fields whose absence means "unproven", not "zero". A timestamp of 0 is a
 * gap too: the producer uses 0 as its own "no stamp" sentinel.
 */
const PROVENANCE_FIELDS = ['lastActivityAt', 'createdAt', 'project', 'stack_id']

function isMissingStamp(value) {
  return value === null || value === undefined || value === 0 || value === ''
}

/**
 * Validate one thread entry against the render contract.
 * Returns { ok, errors[] }. Missing id/title or a mistyped field fails.
 */
export function validateThread(entry) {
  const errors = []
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return { ok: false, errors: ['entry is not an object'] }
  }
  for (const field of REQUIRED_STRING_FIELDS) {
    if (typeof entry[field] !== 'string' || !entry[field].trim()) {
      errors.push(`missing ${field}`)
    }
  }
  for (const [field, type] of Object.entries(OPTIONAL_TYPED_FIELDS)) {
    const value = entry[field]
    if (value === undefined || value === null) continue
    if (typeof value !== type) errors.push(`field ${field} must be ${type}`)
  }
  return { ok: errors.length === 0, errors }
}

/** Split a list of entries into valid / invalid, keeping each failure's reason. */
export function validateThreads(entries) {
  const valid = []
  const invalid = []
  for (const entry of Array.isArray(entries) ? entries : []) {
    const result = validateThread(entry)
    if (result.ok) valid.push(entry)
    else invalid.push({ entry, errors: result.errors })
  }
  return { valid, invalid, validCount: valid.length, invalidCount: invalid.length }
}

/**
 * Which provenance fields this raw entry cannot prove. A gap is NOT an error
 * and does NOT drop the entry — it is counted so the panel can say, honestly,
 * "N entries carry unproven stamps" instead of stamping them "now" and
 * pretending the snapshot proved it.
 */
export function findProvenanceGaps(entry) {
  if (!entry || typeof entry !== 'object') return [...PROVENANCE_FIELDS]
  return PROVENANCE_FIELDS.filter((field) => isMissingStamp(entry[field]))
}

/**
 * Assess the health of one merged poll result.
 *
 * status:
 * - 'unknown' — nothing to prove: no threads, or no scan stamp at all.
 * - 'stale' — the last scan is older than STALE_AFTER_MS.
 * - 'partial' — a scan exists, but some entries failed validation, some
 *   stamps are unproven, some stacks failed to refresh, or warnings fired.
 * - 'proven' — a fresh scan, every entry validated, no gaps, no warnings.
 *
 * Nothing here invents: every count comes from the payload handed in.
 */
export function assessDataHealth({
  threads = [],
  scannedAt = null,
  warnings = [],
  gapCount = 0,
  invalidCount = null,
  failedStacks = 0,
  now = Date.now(),
} = {}) {
  const computed = validateThreads(threads)
  const valid = computed.validCount
  // Dropped entries are counted by the fetcher (invalidCount) when it drops
  // them before the merge; otherwise count them from the threads handed in.
  const invalid = invalidCount === null || invalidCount === undefined ? computed.invalidCount : invalidCount
  const stamp = typeof scannedAt === 'number' ? scannedAt : null
  const ageMs = stamp === null ? null : Math.max(0, now - stamp)
  let status
  if (!threads.length || stamp === null) status = 'unknown'
  else if (ageMs > STALE_AFTER_MS) status = 'stale'
  else if (invalid > 0 || gapCount > 0 || failedStacks > 0 || warnings.length > 0) status = 'partial'
  else status = 'proven'
  return {
    status,
    scannedAt: stamp,
    ageMs,
    valid,
    invalid,
    gaps: gapCount,
    failedStacks,
    warnings: [...warnings],
    summary: formatDataHealthSummary({ status, ageMs, valid, invalid, gaps: gapCount }),
  }
}

function formatAge(ageMs) {
  if (ageMs === null) return 'never'
  if (ageMs < 60 * 1000) return `${Math.floor(ageMs / 1000)}s ago`
  if (ageMs < 60 * 60 * 1000) return `${Math.floor(ageMs / 60000)}m ago`
  return `${Math.floor(ageMs / 3600000)}h ago`
}

/** One honest line for the panel: counts + scan age, never a smoothed claim. */
export function formatDataHealthSummary({ status, ageMs, valid, invalid, gaps }) {
  const age = formatAge(ageMs)
  switch (status) {
    case 'proven':
      return `${valid} proven · scanned ${age}`
    case 'partial':
      return `${valid} proven · ${invalid} dropped · ${gaps} unproven stamps · scanned ${age}`
    case 'stale':
      return `STALE — last scan ${age}`
    case 'unknown':
    default:
      return 'UNKNOWN — no scan to prove state'
  }
}
