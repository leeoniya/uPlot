// Usage: node bench/double-mad.mjs [baseline-path relative to cwd]
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {cpus, release} from 'node:os';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';

if (process.argv.length > 3)
	throw new Error('Usage: node bench/double-mad.mjs [baseline-path relative to cwd]');

const load = path => Function(readFileSync(path, 'utf8') + '\nreturn {prepareDoubleMad, doubleMad};')();
const versions = [['current', load(new URL('../demos/lib/double-mad.js', import.meta.url))]];
if (process.argv[2])
	versions.unshift(['baseline', load(resolve(process.argv[2]))]);
const taxi = JSON.parse(readFileSync(new URL('../demos/data/taxi-trips.json', import.meta.url), 'utf8'));
const datasets = [['unsorted taxi', taxi], ['ascending taxi', taxi.slice().sort((a, b) => a - b)]];
const threshold = 3.5;
const batches = 7, warmMs = 50, batchMs = 30;
let sink;
const started = performance.now();

console.log(`Node ${process.version}; V8 ${process.versions.v8}; ${process.platform} ${release()} ${process.arch}`);
console.log(`CPU: ${cpus()[0]?.model ?? 'unknown'}; samples: ${taxi.length}; threshold: ${threshold}`);
console.log(`Warmup ${warmMs} ms/job; ${batches} batches targeting ${batchMs} ms; median ms/op (lower is better)`);

// Verify both orderings before any timing; input remains unchanged throughout.
if (versions.length === 2) {
	for (const [name, data] of datasets) {
		const [before, after] = versions.map(([, api]) => api.prepareDoubleMad(data));
		for (const key of ['median', 'leftMad', 'rightMad'])
			assert.equal(after[key], before[key], `${name}: ${key}`);
		assert.deepEqual(after.detect(threshold), before.detect(threshold), `${name}: labels`);
	}
	console.log('Baseline/current stats and labels match exactly for both datasets.');
}

function warm(job) {
	const start = performance.now();
	let count = 0;
	do {
		sink = job.run();
		count++;
	} while (performance.now() - start < warmMs);
	job.count = Math.max(1, Math.min(100000, Math.round(count * batchMs / (performance.now() - start))));
}

const rows = [];
for (const [dataset, data] of datasets) {
	for (const operation of ['prepare', 'detect']) {
		const jobs = versions.map(([version, api]) => {
			// This detector is prepared once, outside warmup and timed detect batches.
			const detector = operation === 'detect' ? api.prepareDoubleMad(data) : null;
			return {version, times: [], run: detector ? () => detector.detect(threshold) : () => api.prepareDoubleMad(data)};
		});
		jobs.forEach(warm);
		for (let batch = 0; batch < batches; batch++) {
			for (const job of batch % 2 ? jobs.slice().reverse() : jobs) {
				const start = performance.now();
				for (let i = 0; i < job.count; i++) sink = job.run();
				job.times.push((performance.now() - start) / job.count);
			}
		}
		for (const job of jobs) {
			job.times.sort((a, b) => a - b);
			rows.push({dataset, operation, version: job.version, 'ops/batch': job.count,
				'median ms/op': job.times[Math.floor(batches / 2)].toFixed(6)});
		}
	}
}
console.table(rows);
console.log(`Elapsed: ${((performance.now() - started) / 1000).toFixed(2)} s; result retained: ${sink != null}`);
