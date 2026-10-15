import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../../scripts/instrument.mjs';
import { captureStep, getDemoSteps } from '../../scripts/demoSteps.mjs';
import groups from '../../demos/timezones-dst.js';

const hostZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
assert.equal(hostZone, process.env.TZ, 'host timezone must be set before importing uPlot');
globalThis.uPlot = (await import('../../src/uPlot.js')).default;

const transitions = [
	Date.parse('2024-03-10T08:00:00Z'),
	Date.parse('2024-03-31T01:00:00Z'),
	Date.parse('2024-10-27T01:00:00Z'),
	Date.parse('2024-11-03T07:00:00Z'),
].flatMap(ts => [ts / 1e3 - 3600, ts / 1e3, ts / 1e3 + 3600]);
const charts = [];

for (const { id, step } of getDemoSteps(groups)) {
	let plots;
	await captureStep({ render: async () => plots = await step.render() }, id, (actual, snapshotId) => {
		assert.equal(plots.length, 1);
		const expected = JSON.parse(readFileSync(new URL('../demos/timezones-dst/' + snapshotId + '.json', import.meta.url), 'utf8'));
		assert.deepEqual(actual, expected, hostZone + ' snapshot ' + snapshotId);

		const u = plots[0];
		const xs = u.data[0];
		const indices = new Set([0, Math.floor(xs.length / 2), xs.length - 1]);
		for (const ts of transitions) {
			const idx = xs.indexOf(ts);
			if (idx != -1)
				indices.add(idx);
		}
		const legend = [...indices].sort((a, b) => a - b).map(idx => {
			u.setLegend({ idx });
			return { ts: xs[idx], values: structuredClone(u.legend.values) };
		});
		charts.push({
			id,
			axes: u.axes.map(axis => ({ splits: axis._splits, values: axis._values })),
			scales: Object.fromEntries(Object.entries(u.scales).map(([key, scale]) => [key, [scale.min, scale.max]])),
			legend,
		});
	});
}

assert.equal(charts.length, 51, 'exercise every chart in the demo');
console.log(JSON.stringify({ hostZone, charts }));
