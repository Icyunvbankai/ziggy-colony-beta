/** StarNet patterns (beta only): truthful telemetry, object=capability, panel helpers. */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  validateThread,
  validateThreads,
  findProvenanceGaps,
  assessDataHealth,
  STALE_AFTER_MS,
} from '../src/game/telemetry.js'
import { resolveGrants, allGrants, CAP_REGISTRY } from '../src/game/capability.js'
import {
  buildOutboxItems,
  buildTaskBrief,
  formatDataHealth,
  grantsForSelection,
  SPEND_RAIL,
  TASK_BRIEF_OPTIONS,
} from '../src/ui/starnet-patterns.js'

const NOW = 1_800_000_000_000
const good = {
  id: 'muse:agent:demo',
  title: 'Demo Agent',
  running: false,
  unread: false,
  hasError: false,
  lastActivityAt: NOW - 1000,
  createdAt: NOW - 100000,
  project: 'demo-stack',
  stack_id: 'demo-stack',
}

// ── telemetry: validation ────────────────────────────────────────────────

test('telemetry: a well-formed thread validates', () => {
  assert.deepEqual(validateThread(good), { ok: true, errors: [] })
})

test('telemetry: missing id / title fail, and non-objects fail', () => {
  assert.equal(validateThread({ ...good, id: '' }).ok, false)
  assert.equal(validateThread({ ...good, title: '  ' }).ok, false)
  assert.equal(validateThread({ ...good, id: undefined }).ok, false)
  assert.equal(validateThread(null).ok, false)
  assert.equal(validateThread('nope').ok, false)
  assert.match(validateThread({ title: 'x' }).errors.join(' '), /missing id/)
})

test('telemetry: mistyped optional fields fail', () => {
  assert.match(validateThread({ ...good, running: 'yes' }).errors.join(' '), /running/)
  assert.match(validateThread({ ...good, lastActivityAt: 'soon' }).errors.join(' '), /lastActivityAt/)
})

test('telemetry: validateThreads splits valid from invalid and counts', () => {
  const { valid, invalid, validCount, invalidCount } = validateThreads([good, { title: 'no id' }, good])
  assert.equal(validCount, 2)
  assert.equal(invalidCount, 1)
  assert.equal(valid.length, 2)
  assert.equal(invalid[0].errors.length > 0, true)
})

test('telemetry: provenance gaps — missing stamps are gaps, 0 is a gap too', () => {
  assert.deepEqual(findProvenanceGaps(good), [])
  assert.deepEqual(findProvenanceGaps({ ...good, lastActivityAt: undefined }), ['lastActivityAt'])
  assert.deepEqual(findProvenanceGaps({ ...good, createdAt: 0 }), ['createdAt'])
  assert.deepEqual(findProvenanceGaps({ ...good, project: '' }), ['project'])
  assert.deepEqual(findProvenanceGaps({ ...good, stack_id: null }), ['stack_id'])
  assert.equal(findProvenanceGaps(null).length > 0, true)
})

// ── telemetry: health assessment ─────────────────────────────────────────

test('telemetry: fresh clean scan is proven', () => {
  const h = assessDataHealth({ threads: [good], scannedAt: NOW, now: NOW })
  assert.equal(h.status, 'proven')
  assert.match(h.summary, /1 proven/)
})

test('telemetry: gaps / warnings / failed stacks make a fresh scan partial', () => {
  assert.equal(assessDataHealth({ threads: [good], scannedAt: NOW, gapCount: 2, now: NOW }).status, 'partial')
  assert.equal(assessDataHealth({ threads: [good], scannedAt: NOW, warnings: ['x'], now: NOW }).status, 'partial')
  assert.equal(assessDataHealth({ threads: [good], scannedAt: NOW, failedStacks: 1, now: NOW }).status, 'partial')
})

test('telemetry: dropped entries counted via invalidCount make a scan partial', () => {
  const h = assessDataHealth({ threads: [good], scannedAt: NOW, invalidCount: 3, now: NOW })
  assert.equal(h.status, 'partial')
  assert.equal(h.invalid, 3)
  assert.match(h.summary, /3 dropped/)
})

test('telemetry: an old scan is stale, and no scan is unknown', () => {
  const stale = assessDataHealth({ threads: [good], scannedAt: NOW - STALE_AFTER_MS - 1, now: NOW })
  assert.equal(stale.status, 'stale')
  assert.match(stale.summary, /STALE/)
  assert.equal(assessDataHealth({ threads: [], scannedAt: NOW, now: NOW }).status, 'unknown')
  assert.equal(assessDataHealth({ threads: [good], scannedAt: null, now: NOW }).status, 'unknown')
  assert.match(assessDataHealth({}).summary, /UNKNOWN/)
})

// ── capability: object = capability (display only) ───────────────────────

test('capability: HQ grants overview + attention; pond grants nothing', () => {
  const hq = resolveGrants('hq')
  assert.deepEqual(hq.map((g) => g.cap), ['team.overview', 'team.attention'])
  assert.deepEqual(resolveGrants('pond'), [])
  assert.deepEqual(resolveGrants('no-such-kind'), [])
})

test('capability: kill-switch drops a family and keeps the rest', () => {
  const grants = resolveGrants('hq', { killSwitch: ['team'] })
  assert.deepEqual(grants, [])
  const beacon = resolveGrants('distress-beacon', { killSwitch: ['world'] })
  assert.equal(beacon.length, 1)
  assert.equal(beacon[0].cap, 'attention.request')
  assert.equal(beacon[0].requiresConsent, true)
})

test('capability: every call returns fresh objects — mutating one call cannot corrupt the registry', () => {
  const first = resolveGrants('hq')
  first[0].cap = 'hacked'
  first.push({ cap: 'fake' })
  assert.deepEqual(resolveGrants('hq').map((g) => g.cap), ['team.overview', 'team.attention'])
  assert.equal(CAP_REGISTRY.hq.length, 2)
})

test('capability: allGrants covers every kind', () => {
  const caps = allGrants().map((g) => g.cap)
  assert.ok(caps.includes('team.overview'))
  assert.ok(caps.includes('attention.request'))
  assert.ok(caps.includes('world.navigate'))
})

// ── panel helpers: outbox / brief / spend / health ──────────────────────

const blocked = { ...good, id: 'b1', title: 'Blocked Bot', hasError: true, unread: false, createdAt: 100 }
const waiting = { ...good, id: 'w1', title: 'Waiting Bot', hasError: false, unread: true, createdAt: 50 }
const fine = { ...good, id: 'f1', title: 'Fine Bot', hasError: false, unread: false }

test('panel: outbox lists blocked first, then waiting, oldest first; fine bots excluded', () => {
  const items = buildOutboxItems([waiting, fine, blocked])
  assert.deepEqual(items.map((i) => i.id), ['b1', 'w1'])
  assert.equal(items[0].reason, 'Blocked — needs a decision')
  assert.equal(items[1].reason, 'Waiting on you')
  assert.deepEqual(buildOutboxItems([fine]), [])
  assert.deepEqual(buildOutboxItems([]), [])
})

test('panel: task brief asks one question about the first blocked item', () => {
  const brief = buildTaskBrief([waiting, blocked])
  assert.match(brief.question, /Blocked Bot/)
  assert.deepEqual(brief.options, [...TASK_BRIEF_OPTIONS])
  assert.match(brief.conceptNote, /Concept only/)
  assert.equal(buildTaskBrief([fine]), null)
  assert.equal(buildTaskBrief([]), null)
})

test('panel: spend rail is $0 / $0, disabled, reference only', () => {
  assert.equal(SPEND_RAIL.spent, 0)
  assert.equal(SPEND_RAIL.authorized, 0)
  assert.equal(SPEND_RAIL.enabled, false)
  assert.equal(SPEND_RAIL.referenceDailyCap, 25)
})

test('panel: formatDataHealth tolerates missing health and passes summaries through', () => {
  assert.match(formatDataHealth(null), /UNKNOWN/)
  assert.equal(formatDataHealth({ summary: '3 proven · scanned 5s ago' }), '3 proven · scanned 5s ago')
  assert.match(formatDataHealth({ status: 'stale', ageMs: 99999999, valid: 1, invalid: 0, gaps: 0 }), /STALE/)
})

test('panel: selection grants — blocked selection adds the distress-beacon grants', () => {
  const plain = grantsForSelection(null).map((g) => g.cap)
  assert.deepEqual(plain, ['agent.status'])
  const blockedGrants = grantsForSelection({ status: 'blocked' }).map((g) => g.cap)
  assert.deepEqual(blockedGrants, ['agent.status', 'attention.request'])
  assert.deepEqual(grantsForSelection({ status: 'working' }).map((g) => g.cap), ['agent.status'])
})
