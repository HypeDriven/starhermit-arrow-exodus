// Every client string is translated: each of the nine locales has every
// key the English table has, no empty or placeholder-mismatched strings, and
// every key the TypeScript client asks for by a literal exists.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { loadClassic } from './load.mjs';

const { LOCALES, STRINGS } = loadClassic('strings.js').AXStrings;
const EN = STRINGS['en-US'];
const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('the nine StarHermit locales', () => {
  assert.deepEqual([...LOCALES].sort(), ['de-DE', 'en-GB', 'en-US', 'es-419', 'es-ES', 'fr-CA', 'fr-FR', 'it-IT', 'pt-BR']);
});

test('every locale has every key, with the same placeholders', () => {
  for (const loc of LOCALES) {
    for (const k of Object.keys(EN)) {
      const s = STRINGS[loc][k];
      assert.ok(typeof s === 'string' && s.trim(), `${loc} lacks ${k}`);
      assert.equal(vars(s), vars(EN[k]), `${loc} ${k} placeholders`);
    }
  }
});

test('every literal key the client uses exists', () => {
  const dir = new URL('../src/', import.meta.url);
  const used = new Set();
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    for (const m of src.matchAll(/\bt\("([\w.-]+)"\s*[,)]/g)) used.add(m[1]);
    for (const m of src.matchAll(/"(cap\.\w+)"/g)) used.add(m[1]);
  }
  assert.ok(used.size > 40);
  for (const k of used) assert.ok(k in EN, `missing key ${k}`);
});
