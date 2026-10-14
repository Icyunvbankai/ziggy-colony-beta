/**
 * Object = capability (StarNet pattern, DISPLAY ONLY).
 *
 * In StarNet, placed objects are real tool grants: `resolveTools()` projects a
 * station layout onto the tools an agent may use this turn, fresh every turn,
 * with a kill-switch on top. The colony is a visualization, not a harness —
 * nothing here is a permission, nothing gates a real action, and nothing
 * triggers one. This module is the same mapping idea as an educational
 * display: "this object on the map stands for these capabilities."
 *
 * Pure function, no DOM, no network: `resolveGrants(kind, options)` returns a
 * fresh array every call. Unknown kinds grant nothing. The kill-switch drops
 * whole grant families from the display.
 *
 * HARD RULE: this must never be wired to real agent permissions, real
 * actions, spending, or accounts. If a future build ever gates real actions
 * from the map, that is a separate, explicitly authorized job — not this one.
 */

/**
 * Object kind → display grants. Each grant is a policy triple in StarNet's
 * shape: { cap, tool, scope } plus requiresConsent and a plain-language
 * description of what the object stands for.
 */
export const CAP_REGISTRY = {
  // One HQ building per stack: the stack's overview and attention list.
  hq: [
    { cap: 'team.overview', tool: 'roster.view', scope: 'stack', requiresConsent: false, description: 'See this stack\u2019s roster and status' },
    { cap: 'team.attention', tool: 'attention.list', scope: 'stack', requiresConsent: false, description: 'See which agents in this stack need a decision' },
  ],
  // An agent's own tile: that agent's status and claimed task.
  'agent-tile': [
    { cap: 'agent.status', tool: 'agent.view', scope: 'agent', requiresConsent: false, description: 'See this agent\u2019s status and current task' },
  ],
  // A home desk: where the agent works.
  'home-desk': [
    { cap: 'agent.workspace', tool: 'workspace.view', scope: 'agent', requiresConsent: false, description: 'See where this agent works' },
  ],
  // The spinning diamond over a working bot: the task it has claimed.
  'claim-marker': [
    { cap: 'task.claim', tool: 'task.view', scope: 'task', requiresConsent: false, description: 'See the task this agent has claimed' },
  ],
  // The tall red pillar over a blocked bot: why it is stuck. A decision here
  // needs Adrian, so the display marks it as requiring consent.
  'distress-beacon': [
    { cap: 'attention.request', tool: 'attention.view', scope: 'agent', requiresConsent: true, description: 'See why this agent is blocked — a decision here needs Adrian' },
  ],
  // Terrain itself: move the camera across the colony.
  terrain: [
    { cap: 'world.navigate', tool: 'map.view', scope: 'world', requiresConsent: false, description: 'Move the camera across the colony' },
  ],
  // The lander: return to the colony overview.
  lander: [
    { cap: 'world.overview', tool: 'map.view', scope: 'world', requiresConsent: false, description: 'Return to the colony overview' },
  ],
  // Water grants nothing. Ponds are scenery a bot wades through, not a tool.
  pond: [],
}

/** Grant families the kill-switch can drop from the display, by cap prefix. */
export const CAP_FAMILIES = ['team', 'agent', 'task', 'attention', 'world']

/**
 * Project an object kind onto its display grants, fresh every call.
 * - Unknown kinds grant nothing (never invent a grant).
 * - `killSwitch`: array of family names (see CAP_FAMILIES) to drop.
 * Returns a NEW array of NEW objects each call, so callers can mutate the
 * result without corrupting the registry.
 */
export function resolveGrants(objectKind, { killSwitch = [] } = {}) {
  const grants = CAP_REGISTRY[objectKind]
  if (!Array.isArray(grants)) return []
  const killed = new Set(Array.isArray(killSwitch) ? killSwitch : [])
  return grants
    .filter((grant) => !killed.has(grant.cap.split('.')[0]))
    .map((grant) => ({ ...grant }))
}

/** Every display grant across all kinds, for the panel's reference list. */
export function allGrants({ killSwitch = [] } = {}) {
  return Object.keys(CAP_REGISTRY).flatMap((kind) => resolveGrants(kind, { killSwitch }))
}
