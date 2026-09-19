import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/legend.js', import.meta.url));
const generated = await readFile(new URL('../src/legend-ivi.js', import.meta.url), 'utf8');
const sourceHash = createHash('sha256').update(source).digest('hex');

if (!generated.includes(`// Source hash: ${sourceHash}\n`))
	throw new Error('src/legend-ivi.js is stale. Run `npm run build:legend`.');

console.log('check:legend: src/legend-ivi.js matches src/legend.js');
