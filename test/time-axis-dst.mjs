import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';
import { cases, day, flags, niceFlags, range, splits, checkSplits } from './helpers/time-axis-dst.mjs';

for (const ms of [1, 1e-3]) {
	describe(`daily time-axis DST boundaries (ms=${ms})`, () => {
		for (const example of cases) {
			for (const nice of niceFlags(example)) {
				const behavior = example.ticks ? 'exact ticks' : 'bounded output despite known limitation';
				it(`${example.name}: ${behavior}, ${JSON.stringify(nice)}`, () => {
					checkSplits(example, ms, nice);
				});
			}
		}

		const boundaryCases = cases.filter(example => example.days == null &&
			['America/Sao_Paulo', 'Australia/Lord_Howe', 'Asia/Kathmandu'].includes(example.zone));
		for (const example of boundaryCases) {
			const [min, max] = range(example);
			const boundary = Date.parse(example.ticks[2]);
			for (const [name, lo, hi] of [
				['ends just before the corrected tick', min, boundary - 1],
				['ends exactly on the corrected tick', min, boundary],
				['ends fifteen minutes after the corrected tick', min, boundary + 15 * 60e3],
				['starts exactly on the corrected tick', boundary, max],
				['starts just after the corrected tick', boundary + 1, max],
			]) {
				it(`${example.name}: ${name}`, () => {
					const clipped = {
						...example, min: new Date(lo).toISOString(), max: new Date(hi).toISOString(),
						ticks: example.ticks.filter(iso => Date.parse(iso) >= lo && Date.parse(iso) <= hi),
					};
					for (const nice of flags)
						checkSplits(clipped, ms, nice);
				});
			}
		}

		it('renders the Santiago change day once through the public tzDate option', async () => {
			const example = cases[0];
			const [min, max] = range(example).map(ts => ts * ms);
			const u = new uPlot({
				width: 900, height: 220, pxRatio: 1, ms,
				tzDate: ts => uPlot.tzDate(new Date(ts / ms), example.zone),
				cursor: { show: false }, legend: { show: false },
				series: [{}, { points: { show: false } }],
				scales: { x: { range: () => [min, max] } },
				axes: [{ incrs: [day * ms], values: '{M}/{D}' }],
			}, [[min, max], [0, 1]], document.body);
			try {
				await Promise.resolve();
				assert.equal(u.status, 1);
				assert.deepEqual(u.axes[0].nice, { dst: true, first: false });
				assert.deepEqual(u.axes[0]._splits, example.ticks.map(iso => Date.parse(iso) * ms));
				assert.deepEqual(u.axes[0]._values, example.ticks.map(iso => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`));
			}
			finally { u.destroy(); }
		});
	});

	describe(`daily time-axis accepted limitations (ms=${ms})`, () => {
		// Keep ideal expectations executable without requiring a general calendar resolver.
		// Termination and valid output are checked separately in ordinary passing tests.
		for (const example of cases.filter(example => example.limitation)) {
			it(example.name, { todo: example.limitation }, () => {
				const actual = splits(example, ms, { dst: true, first: example.first ?? false });
				assert.deepEqual(actual, example.ideal.map(iso => Date.parse(iso) * ms));
			});
		}
	});
}

describe('daily time-axis DST boundaries with native dates', () => {
	for (const zone of new Set(cases.map(example => example.zone).filter(Boolean))) {
		it(`native Date in ${zone}, both timestamp units and nice flags`, { timeout: 6000 }, () => {
			const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
				const { checkNative } = await import('./test/helpers/time-axis-dst.mjs');
				checkNative(process.env.TZ);
				console.log('native DST checks passed');
			`], {
				cwd: fileURLToPath(new URL('../', import.meta.url)),
				env: { ...process.env, TZ: zone, NODE_OPTIONS: '' },
				encoding: 'utf8', timeout: 5000,
			});
			assert.equal(output.trim(), 'native DST checks passed');
		});
	}
});
