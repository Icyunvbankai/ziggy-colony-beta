/**
 * BETA build switch + live-data endpoints.
 *
 * `BETA` is the FEATURE switch: topography, overlays, deck terraces, the
 * drifting day/night default — everything that makes this build the new colony
 * experience. `BETA_BRANDING` is the IDENTITY switch: the BETA banner/title
 * and reading data from the live repo instead of local files. The two are
 * separate so the new experience can be promoted to live (BETA on, branding
 * off) without the test-colony banner or the cross-repo data fetch.
 * This file is the ONLY place that knows this copy is the beta.
 */
export const BETA = true

/** Show the BETA banner/title and read data from the live repo. False on live. */
export const BETA_BRANDING = BETA

export const BETA_LABEL = 'BETA'

/** Public raw base of the LIVE colony repo (read-only). */
export const LIVE_RAW_BASE =
  'https://raw.githubusercontent.com/Icyunvbankai/ziggy-colony/main/docs'

/** Bundled fallback copies of the live repo's public data, shipped with this build. */
export const FALLBACK_MANIFEST_URL = 'beta-data/threads/manifest.json'
export const FALLBACK_BUNDLE_URL = 'beta-data/threads.json'
export const FALLBACK_STATE_URL = 'beta-data/state.json'
