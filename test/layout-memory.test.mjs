import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'game', 'colony.js')

// Regression test for the 2026-10-14 outage: the tile-labels change replaced
// `const LAYOUT_MEMORY = 80` with `const TILE_LABEL_Y = ...`, deleting the
// constant that `_syncPlots` still referenced. Every poll then threw
// `ReferenceError: LAYOUT_MEMORY is not defined`, the toast showed it, stats
// never updated, and the colony rendered island-only with all pills at 0.
// No test exercised `setThreads`, so the suite passed with the defect shipped.
// This test fails if any UPPER_SNAKE identifier used in colony.js is not
// defined in-file, imported, or a known JS global.

const JS_GLOBALS = new Set([
  'Array', 'BigInt', 'Boolean', 'Date', 'Error', 'JSON', 'Map', 'Math', 'Number',
  'Object', 'Promise', 'RangeError', 'ReferenceError', 'RegExp', 'Set', 'String',
  'Symbol', 'TypeError', 'URL', 'WeakMap', 'WeakSet', 'console', 'document',
  'fetch', 'localStorage', 'performance', 'requestAnimationFrame', 'structuredClone',
  'window', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'Infinity', 'NaN', 'undefined', 'isFinite', 'isNaN', 'parseFloat', 'parseInt',
])

function stripped(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\\/])\/\/.*$/gm, '$1')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
}

test('LAYOUT_MEMORY is defined (regression: tile-labels change deleted it)', () => {
  const src = readFileSync(SRC, 'utf8')
  assert.match(src, /const\s+LAYOUT_MEMORY\s*=\s*\d+/, 'colony.js must define const LAYOUT_MEMORY')
})

test('every UPPER_SNAKE identifier used in colony.js is defined, imported, or a JS global', () => {
  const src = stripped(readFileSync(SRC, 'utf8'))
  const defined = new Set()
  for (const m of src.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=/g)) defined.add(m[1])
  for (const m of src.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)) defined.add(m[1])
  for (const m of src.matchAll(/class\s+([A-Za-z_$][\w$]*)\b/g)) defined.add(m[1])
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim()
      if (name) defined.add(name)
    }
  }
  for (const m of src.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from/g)) defined.add(m[1])
  for (const m of src.matchAll(/import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from/g)) defined.add(m[1])
  const used = new Set()
  for (const m of src.matchAll(/(?<![\w$.])[A-Z][A-Z0-9_]{2,}/g)) used.add(m[0])
  const missing = [...used].filter((name) => !defined.has(name) && !JS_GLOBALS.has(name))
  assert.deepEqual(missing, [], `undefined UPPER_SNAKE identifiers in colony.js: ${missing.join(', ')}`)
})
