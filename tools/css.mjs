// Converts the UI's base style sheet (tools/ui-style.css) into the styles the
// game registers (assets/ui-style.json), with `starhermit css`; prints what it
// could not map. Run after editing the sheet, then `npm run package`:
//   STARHERMIT=/path/to/starhermit npm run css
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const exe = process.env.STARHERMIT;
if (!exe) { console.error('set STARHERMIT to the engine runtime (starhermit)'); process.exit(1); }
execFileSync(exe, ['css', 'tools/ui-style.css', '--path', 'tools/ui-style.css', '--out', 'assets/ui-style.json', '--font-size', '16'], { cwd: root, stdio: 'inherit' });
