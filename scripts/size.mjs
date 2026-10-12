// Bundle size report + budget check (plan §7): initial JS <= 200 KB brotli, total initial transfer <= 250 KB.
// "Initial" = index.html + everything it loads before first render (entry module, its static imports, CSS).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const BUDGET_JS = 200 * 1024;
const BUDGET_TOTAL = 250 * 1024;
const dist = 'dist';
const br = (buf) => brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
const html = readFileSync(`${dist}/index.html`);
const entry = html.toString().match(/<script type="module"[^>]*src="([^"]+)"/)[1];
const css = [...html.toString().matchAll(/<link rel="stylesheet"[^>]*href="([^"]+)"/g)].map((m) => m[1]);

// Static imports of a chunk (minified: import{...}from"./x.js" or import"./x.js").
function staticDeps(file, seen = new Set()) {
  if (seen.has(file)) return seen;
  seen.add(file);
  const src = readFileSync(`${dist}${file}`, 'utf8');
  for (const m of src.matchAll(/(?:^|[;}\s])import\s*(?:[\w${},*\s]+from\s*)?["'](\.\/[^"']+)["']/g)) {
    staticDeps(`/assets/${m[1].slice(2)}`, seen);
  }
  return seen;
}

const initial = [...staticDeps(entry)];
const rows = [];
let jsBr = 0;
let totalBr = br(html);
for (const f of readdirSync(`${dist}/assets`)) {
  const buf = readFileSync(`${dist}/assets/${f}`);
  const path = `/assets/${f}`;
  const isInitial = initial.includes(path) || css.includes(path);
  const b = br(buf);
  if (isInitial) {
    totalBr += b;
    if (f.endsWith('.js')) jsBr += b;
  }
  rows.push({ file: f, raw: statSync(`${dist}/assets/${f}`).size, gzip: gzipSync(buf, { level: 9 }).length, brotli: b, initial: isInitial });
}
rows.sort((a, b) => Number(b.initial) - Number(a.initial) || b.brotli - a.brotli);
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log('file'.padEnd(34), 'raw'.padStart(10), 'gzip'.padStart(10), 'brotli'.padStart(10), '  load');
for (const r of rows) {
  console.log(r.file.padEnd(34), kb(r.raw).padStart(10), kb(r.gzip).padStart(10), kb(r.brotli).padStart(10), r.initial ? '  initial' : '  deferred');
}
console.log(`\nindex.html ${kb(br(html))} brotli`);
console.log(`initial JS:       ${kb(jsBr)} brotli (budget ${kb(BUDGET_JS)})`);
console.log(`initial transfer: ${kb(totalBr)} brotli (budget ${kb(BUDGET_TOTAL)})`);
if (jsBr > BUDGET_JS || totalBr > BUDGET_TOTAL) {
  console.error('Over budget!');
  process.exit(1);
}
