// Loads the game's classic scripts (js/*.js, as starhermit:script loadClassic
// runs them) into one plain object standing in for the game's globalThis.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export function loadClassic(...files) {
  const ctx = { console };
  vm.createContext(ctx);
  for (const f of files) vm.runInContext(readFileSync(new URL('../js/' + f, import.meta.url), 'utf8'), ctx, { filename: f });
  return ctx;
}
