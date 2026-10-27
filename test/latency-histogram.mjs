import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';

const html = readFileSync(new URL('../demos/latency-heatmap.html', import.meta.url), 'utf8');
const samples = [5, 6, 8, 12, 18, 24, 32, 44, 58, 72, 95, 120, 151];

function loadHistogram() {
	const fixture = document.createElement('div');
	const controlsStart = html.indexOf('Bucket size:');
	fixture.innerHTML = html.slice(controlsStart, html.indexOf('<script>', controlsStart));
	document.body.append(fixture);
	const plots = [];
	const Plot = new Proxy(uPlot, {
		construct(target, args) {
			const u = Reflect.construct(target, args);
			plots.push(u);
			return u;
		},
	});
	const destroy = () => {
		plots.forEach(u => u.destroy());
		fixture.remove();
	};

	try {
		// Run the real aggregation helpers and histogram controls without the unrelated heatmap demos.
		const helpers = html.slice(html.indexOf('const isInt ='), html.indexOf('function aggEach'));
		const settings = html.slice(html.indexOf('let bucketIncr ='), html.indexOf('console.time("aggEach")'));
		const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
		new Function('uPlot', 'document', 'raw', 'console', helpers + settings + script)(Plot, {
			body: fixture,
			getElementById: id => fixture.querySelector('#' + id),
		}, [[0], [samples]], {time() {}, timeEnd() {}});
		return {plots, fixture, destroy};
	}
	catch (error) {
		destroy();
		throw error;
	}
}

function assertRange(u, size, offset) {
	const bucket = value => Math.floor((value - offset) / size) * size + offset;
	const min = bucket(samples[0]);
	const max = bucket(samples.at(-1)) + size;
	assert.deepEqual([u.scales.x.min, u.scales.x.max], [min, max]);
	assert.equal(u.axes[0]._splits[0], min);
	assert.equal(u.valToPos(min, 'x'), 0, 'first bucket boundary stays at the plot edge');
	const plotWidth = u.bbox.width / u.pxRatio;
	for (const split of u.axes[0]._splits) {
		assert.ok(split >= min && split <= max, `split ${split} is inside [${min}, ${max}]`);
		const position = u.valToPos(split, 'x');
		assert.ok(position >= 0 && position <= plotWidth + 1e-8, `split ${split} stays inside the plot`);
	}
}

describe('latency histogram controls', () => {
	for (const sizeFirst of [true, false]) {
		it(`keeps bucket ticks inside the updated X range (${sizeFirst ? 'size' : 'offset'} first)`, async () => {
			const f = loadHistogram();
			try {
				await Promise.resolve();
				assert.equal(f.plots.length, 2);
				f.plots.forEach(u => assertRange(u, 5, 0));

				const changes = sizeFirst
					? [['binsize', 7], ['binoffset', 17], ['binsize', 5], ['binoffset', 0]]
					: [['binoffset', 17], ['binsize', 7], ['binoffset', 0], ['binsize', 5]];
				let size = 5;
				let offset = 0;
				for (const [id, value] of changes) {
					const input = f.fixture.querySelector('#' + id);
					input.value = String(value);
					input.dispatchEvent(new Event('input', {bubbles: true}));
					await Promise.resolve();
					if (id == 'binsize')
						size = value;
					else
						offset = value;
					assertRange(f.plots[0], size, offset);
				}
			}
			finally { f.destroy(); }
		});
	}
});
