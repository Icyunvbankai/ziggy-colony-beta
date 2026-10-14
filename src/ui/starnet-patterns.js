/**
 * StarNet patterns panel (BETA ONLY, DISPLAY / CONCEPT ONLY).
 *
 * Three StarNet ideas, adapted to a visualization that must never act:
 *
 * 1. OUTBOX — items waiting on a decision, derived ONLY from the live
 *    snapshot (blocked threads, then threads waiting on you). No invented
 *    deliverables: an empty outbox says so. Approvals still happen in chat;
 *    this panel never acts, never approves, never sends anything.
 * 2. TASK BRIEF — ambiguity → one concrete question with options, StarNet's
 *    pattern for not silently guessing wrong. The options here are CONCEPT
 *    ONLY: clicking one shows that note and does nothing else. Nothing is
 *    wired to a real action, a real agent, or a real decision.
 * 3. SPEND RAIL — $0 spent, $0 authorized. Agents spend nothing by rule.
 *    The $25/day soft rail is StarNet's reference design, shown as a
 *    reference and explicitly NOT enabled. NEVER wire real spending,
 *    payments, accounts, or real agent control to this panel.
 *
 * The pure helpers (buildOutboxItems / buildTaskBrief / SPEND_RAIL /
 * formatDataHealth / grantsForSelection) carry the logic and are unit-tested.
 * The StarnetPatterns class is the thin DOM shell around them.
 */
import { resolveGrants } from '../game/capability.js'
import { formatDataHealthSummary } from '../game/telemetry.js'

/** The spend rail is a display. These numbers are the rule, not a ledger. */
export const SPEND_RAIL = Object.freeze({
  spent: 0,
  authorized: 0,
  /** StarNet's $25/day soft rail — reference design, NOT enabled. */
  referenceDailyCap: 25,
  enabled: false,
  rule: 'Agents spend nothing by rule.',
  referenceNote: '$25/day soft rail — StarNet reference design, NOT enabled.',
})

export const TASK_BRIEF_OPTIONS = Object.freeze([
  'Leave it blocked',
  'Escalate to Ziggy',
  'Mark it resolved in chat',
])

const CONCEPT_NOTE = 'Concept only — not wired to real actions.'

/**
 * Snapshot threads → outbox items waiting on a decision. Blocked first, then
 * waiting-on-you, oldest first within each group. Returns [] when nothing
 * waits — the panel says the outbox is empty, it never invents an item.
 */
export function buildOutboxItems(threads, now = Date.now()) {
  const items = []
  for (const thread of Array.isArray(threads) ? threads : []) {
    if (!thread || typeof thread !== 'object') continue
    if (thread.hasError) {
      items.push({
        id: thread.id,
        title: thread.title || '(untitled)',
        project: thread.project || 'unknown',
        reason: 'Blocked — needs a decision',
        severity: 0,
        createdAt: thread.createdAt ?? 0,
      })
    } else if (thread.unread) {
      items.push({
        id: thread.id,
        title: thread.title || '(untitled)',
        project: thread.project || 'unknown',
        reason: 'Waiting on you',
        severity: 1,
        createdAt: thread.createdAt ?? 0,
      })
    }
  }
  void now
  items.sort((a, b) => a.severity - b.severity || a.createdAt - b.createdAt)
  return items
}

/**
 * The first item needing a decision → one concrete question with options.
 * Returns null when nothing waits; the panel then shows the pattern as a
 * clearly-labeled template example instead of inventing a decision.
 */
export function buildTaskBrief(threads) {
  const items = buildOutboxItems(threads)
  if (!items.length) return null
  const item = items[0]
  return {
    item,
    question: `What should happen with “${item.title}”?`,
    options: [...TASK_BRIEF_OPTIONS],
    conceptNote: CONCEPT_NOTE,
  }
}

/** One honest line for the data-health section; tolerates a missing object. */
export function formatDataHealth(health) {
  if (!health || typeof health !== 'object') return 'UNKNOWN — no scan to prove state'
  if (typeof health.summary === 'string') return health.summary
  return formatDataHealthSummary(health)
}

/**
 * Display grants for the current selection: every selected agent shows its
 * tile grants; a blocked selection additionally shows the distress-beacon
 * grants. Display only — never permissions.
 */
export function grantsForSelection(selection) {
  const grants = resolveGrants('agent-tile')
  if (selection && selection.status === 'blocked') grants.push(...resolveGrants('distress-beacon'))
  return grants
}

function el(tag, cls, text) {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined) node.textContent = text
  return node
}

const MAX_OUTBOX_SHOWN = 10

export class StarnetPatterns {
  constructor(root = document.body) {
    this.root = root
    this.button = el('button', 'starnet-fab', 'Outbox · Briefs · Spend')
    this.button.setAttribute('aria-expanded', 'false')
    this.panel = el('div', 'starnet-panel')
    this.panel.hidden = true
    this.button.addEventListener('click', () => {
      this.panel.hidden = !this.panel.hidden
      this.button.setAttribute('aria-expanded', String(!this.panel.hidden))
    })
    this.healthLine = el('div', 'starnet-line')
    this.outboxList = el('div', 'starnet-list')
    this.briefBox = el('div', 'starnet-brief')
    this.grantsBox = el('div', 'starnet-list')
    this._buildStatic()
    root.appendChild(this.button)
    root.appendChild(this.panel)
  }

  _buildStatic() {
    const title = el('div', 'starnet-title', 'StarNet patterns — display only')
    const sub = el('div', 'starnet-note', 'Concepts borrowed from StarNet. This panel never acts, never approves, never spends.')
    this.panel.appendChild(title)
    this.panel.appendChild(sub)
    this.panel.appendChild(el('div', 'starnet-heading', 'Data health — truthful telemetry'))
    this.panel.appendChild(this.healthLine)
    this.panel.appendChild(el('div', 'starnet-heading', 'Outbox — decisions waiting'))
    this.panel.appendChild(this.outboxList)
    this.panel.appendChild(el('div', 'starnet-heading', 'Task Brief — one question, with options'))
    this.panel.appendChild(this.briefBox)
    this.panel.appendChild(el('div', 'starnet-heading', 'Spend rail'))
    const rail = el('div', 'starnet-rail')
    const fill = el('div', 'starnet-rail-fill')
    rail.appendChild(fill)
    this.panel.appendChild(rail)
    this.panel.appendChild(el('div', 'starnet-line', `$0.00 spent · $0.00 authorized. ${SPEND_RAIL.rule}`))
    this.panel.appendChild(el('div', 'starnet-note', SPEND_RAIL.referenceNote))
    this.panel.appendChild(el('div', 'starnet-heading', 'Capability grants — what map objects stand for'))
    this.panel.appendChild(this.grantsBox)
    this.panel.appendChild(el('div', 'starnet-note', 'Display only — never permissions, never real actions.'))
  }

  update(threads = [], dataHealth = null, selection = null) {
    this.healthLine.textContent = formatDataHealth(dataHealth)

    this.outboxList.replaceChildren()
    const items = buildOutboxItems(threads)
    if (!items.length) {
      this.outboxList.appendChild(el('div', 'starnet-empty', 'Outbox empty — nothing needs a decision.'))
    } else {
      for (const item of items.slice(0, MAX_OUTBOX_SHOWN)) {
        const row = el('div', 'starnet-item')
        row.appendChild(el('div', 'starnet-item-title', item.title))
        row.appendChild(el('div', 'starnet-item-meta', `${item.project} · ${item.reason}`))
        this.outboxList.appendChild(row)
      }
      if (items.length > MAX_OUTBOX_SHOWN) {
        this.outboxList.appendChild(el('div', 'starnet-note', `+${items.length - MAX_OUTBOX_SHOWN} more waiting`))
      }
    }

    this.briefBox.replaceChildren()
    const brief = buildTaskBrief(threads)
    if (!brief) {
      this.briefBox.appendChild(el('div', 'starnet-note', 'Template example — not a real thread:'))
      this.briefBox.appendChild(el('div', 'starnet-line', 'What should happen with “Example: a blocked agent”?'))
      for (const option of TASK_BRIEF_OPTIONS) {
        const btn = el('button', 'starnet-brief-btn', option)
        btn.addEventListener('click', () => { this._showConceptNote() })
        this.briefBox.appendChild(btn)
      }
    } else {
      this.briefBox.appendChild(el('div', 'starnet-line', brief.question))
      for (const option of brief.options) {
        const btn = el('button', 'starnet-brief-btn', option)
        btn.addEventListener('click', () => { this._showConceptNote() })
        this.briefBox.appendChild(btn)
      }
    }

    this.grantsBox.replaceChildren()
    for (const grant of grantsForSelection(selection)) {
      const row = el('div', 'starnet-item')
      row.appendChild(el('div', 'starnet-item-title', grant.cap))
      row.appendChild(el('div', 'starnet-item-meta', `${grant.tool} · ${grant.scope} · ${grant.description}`))
      this.grantsBox.appendChild(row)
    }
  }

  _showConceptNote() {
    let note = this.briefBox.querySelector('.starnet-concept-note')
    if (!note) {
      note = el('div', 'starnet-concept-note', CONCEPT_NOTE)
      this.briefBox.appendChild(note)
    }
  }

  destroy() {
    this.button.remove()
    this.panel.remove()
  }
}
