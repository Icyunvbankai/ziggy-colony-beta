/**
 * BETA build switch + live-data endpoints.
 *
 * This file is the ONLY place that knows this copy is the beta. The beta reads
 * the SAME public published data as the live colony, at runtime, from the live
 * repo — it never writes to the live repo and never pushes its own snapshot.
 * If the live fetch fails (offline, Pages hiccup), the page falls back to the
 * bundled copy of that same public data in `beta-data/` (see api.js).
 */
export const BETA = true

export const BETA_LABEL = 'BETA'

/** Public raw base of the LIVE colony repo (read-only). */
export const LIVE_RAW_BASE =
  'https://raw.githubusercontent.com/Icyunvbankai/ziggy-colony/main/docs'

/** Bundled fallback copies of the live repo's public data, shipped with this build. */
export const FALLBACK_MANIFEST_URL = 'beta-data/threads/manifest.json'
export const FALLBACK_BUNDLE_URL = 'beta-data/threads.json'
export const FALLBACK_STATE_URL = 'beta-data/state.json'
