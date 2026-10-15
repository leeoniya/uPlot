// node scripts/bench-axis-overflow.mjs [baseline-ref]
// Compare cached-width overflow arithmetic only, not text measurement or full chart layout.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const baseline = process.argv[2] ?? 'f118e0a8';
const root = fileURLToPath(new URL('../', import.meta.url));
const source = execFileSync('git', ['--no-pager', 'show', baseline + ':src/axis.js'], { cwd: root, encoding: 'utf8' });
const updated = readFileSync(new URL('../src/axis.js', import.meta.url), 'utf8');
const helpers = source.slice(source.indexOf('function rotationCos('), source.indexOf('function labelHeight('));
const current = source.slice(source.indexOf('function axisOverflow('), source.indexOf('function autoPad(')).trim();
const combined = updated.slice(updated.indexOf('function axisOverflow('), updated.indexOf('function autoPad(')).trim();
assert.ok(current.includes('if (minWidth == null)') && !combined.includes('if (minWidth == null)'), 'expected separate baseline and combined current overflow loops');
const prelude = 'const { PI, abs, ceil, max, round, sin, cos } = Math;\n' + helpers;
const variants = [
	{ name: 'baseline', source: current, initialWidth: 'null' },
	{ name: 'combined', source: combined, initialWidth: '0' },
];
const scale = { dir: 1, valToPct: value => value / 49 };
const iterations = 50000;
const rounds = 25;
let checksum = 0;

function axes(rotate, hidden = false) {
	return Array.from({ length: 16 }, (_, set) => ({
		_rotate: rotate,
		font: ['12px sans-serif', 12],
		_labelValues: Array.from({ length: 50 }, (_, i) => hidden && i % 5 === 0 ? null : 'label-' + i),
		_labelWidths: Array.from({ length: 50 }, (_, i) => hidden && i % 5 === 0 ? 0 : 24 + ((i * 37 + set * 19) % 177) + .25),
		_splits: Array.from({ length: 50 }, (_, i) => i),
	}));
}

function runner(variant, full) {
	// Compile separate direct call sites so a shared polymorphic dispatch does not dominate the comparison.
	return new Function(prelude + variant.source + `
		return function(axes, scale, iterations) {
			const padding = [0, 8, 0, 8];
			let checksum = 0;
			for (let i = 0; i < iterations; i++) {
				const axis = axes[i & 15];
				padding[1] = padding[3] = 8;
				axisOverflow(axis, scale, 1, ${variant.initialWidth}, -42, 8, padding);
				${full ? `
				const minWidth = max(0, 900 + (i & 7) - 50 - ceil(padding[3]) - ceil(padding[1]));
				padding[1] = padding[3] = 8;
				axisOverflow(axis, scale, 1, minWidth, -42, 8, padding);
				padding[1] = ceil(padding[1]);
				padding[3] = ceil(padding[3]);` : ''}
				checksum += padding[1] + padding[3];
			}
			return checksum;
		};
	`)();
}

const implementations = variants.map(variant => new Function(prelude + variant.source + '\nreturn axisOverflow;')());
let comparisons = 0;
for (const rotate of [-90, -45, 0, 45, 90]) {
	for (const hidden of [false, true]) {
		for (const axis of axes(rotate, hidden)) {
			for (const dir of [-1, 1]) {
				for (const width of [0, 100, 320, 900]) {
					const results = implementations.map((fn, i) => {
						const padding = [0, 8, 0, 8];
						const scale = { dir, valToPct: value => value / 49 };
						fn(axis, scale, 1, i === 0 ? null : 0, -42, 8, padding);
						const bound = padding.slice();
						const minWidth = Math.max(0, width - 50 - Math.ceil(padding[3]) - Math.ceil(padding[1]));
						padding[1] = padding[3] = 8;
						fn(axis, scale, 1, minWidth, -42, 8, padding);
						return { bound, padding };
					});
					assert.deepEqual(results[0], results[1]);
					comparisons++;
				}
			}
		}
	}
}

const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const results = [];
for (const rotate of [0, -45, 90]) {
	for (const full of [false, true]) {
		const inputs = axes(rotate);
		const runners = variants.map(variant => runner(variant, full));
		for (let warm = 0; warm < 10; warm++) {
			for (const run of runners)
				checksum += run(inputs, scale, iterations);
		}
		const samples = [[], []];
		for (let round = 0; round < rounds; round++) {
			for (let position = 0; position < 2; position++) {
				const index = (round + position) % 2;
				const start = performance.now();
				checksum += runners[index](inputs, scale, iterations);
				samples[index].push((performance.now() - start) * 1000 / iterations);
			}
		}
		const before = median(samples[0]);
		const after = median(samples[1]);
		results.push({
			rotation: rotate,
			operation: full ? 'both scans' : 'preliminary scan',
			baselineUs: +before.toFixed(3),
			combinedUs: +after.toFixed(3),
			deltaUs: +(after - before).toFixed(3),
			changePct: +((after / before - 1) * 100).toFixed(1),
		});
	}
}
console.log(JSON.stringify({ runtime: process.version, baseline, labels: 50, iterations, rounds, comparisons, checksum, results }, null, 2));
