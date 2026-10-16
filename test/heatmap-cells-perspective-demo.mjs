import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../scripts/instrument.mjs';
import { generateHeatmapCells } from '../demos/lib/heatmapCellsData.js';
import { colorBoundary, palette } from '../demos/heatmap-cells-compare.js';
import { prepareData, colorGradient, viewerConfig, createDemo, timeColumn, bucketColumn, countColumn } from '../demos/heatmap-cells-perspective.js';

function frames() {
	return [{ schema: { meta: { type: 'other' } } }, {
		schema: { meta: { type: 'heatmap-cells' }, fields: [
			{ name: 'count' }, { name: 'yMax' }, { name: 'xMax', config: { interval: 60000 } }, { name: 'yMin' },
		] }, data: { values: [[17.25, 3.5, 29.75, 4.25], [8, 2, 8, 2], [240000, 60000, 60000, 120000], [4, 1, 4, 1]] },
	}];
}

function rootFor() {
	const html = readFileSync(new URL('../demos/heatmap-cells-perspective.html', import.meta.url), 'utf8');
	const page = new DOMParser().parseFromString(html, 'text/html');
	const root = document.importNode(page.querySelector('#demo'), true);
	document.body.appendChild(root);
	return root;
}

function mock(root, failAt) {
	const calls = [];
	const record = name => async (...args) => {
		calls.push([name, ...args]);
		if (name == failAt) throw new Error(`failed ${name}`);
	};
	const table = { update: record('update'), replace: record('replace'), delete: record('table.delete') };
	const client = {
		async table(...args) { await record('table')(...args); return table; },
		terminate: record('terminate'),
	};
	const viewer = root.querySelector('perspective-viewer');
	Object.assign(viewer, { load: record('load'), restore: record('restore'), flush: record('flush'), delete: record('viewer.delete') });
	return { calls, table, client, viewer, async worker() { await record('worker')(); return client; } };
}

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} ≈ ${b}`);
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe('Perspective heatmap cells demo', () => {
	it('uses sparse columnar input, centers the intervals, and keeps original counts', () => {
		const input = frames(), snapshot = structuredClone(input);
		const c = prepareData(input);
		assert.deepEqual(c.columns[timeColumn], [210000, 30000, 30000, 90000]);
		assert.deepEqual(c.columns[bucketColumn], [2.5, .5, 2.5, .5]);
		assert.equal(c.columns[countColumn], input[1].data.values[0]);
		assert.deepEqual([c.nx, c.ny], [4, 3]);
		assert.deepEqual(input, snapshot);
	});

	it('does not collapse missing positions when converting exponential bins to log2 centers', () => {
		const c = prepareData(frames());
		assert.equal(c.columns[bucketColumn][0] - c.columns[bucketColumn][1], 2);
		assert.equal(c.columns[timeColumn][0] - c.columns[timeColumn][3], 120000);
	});

	it('validates the input grid before starting a worker', async () => {
		const f = frames(); f[1].data.values[1][0] = 9;
		const root = rootFor(), api = mock(root);
		try {
			await assert.rejects(createDemo(root, f, api), /uniform/);
			assert.deepEqual(api.calls, []);
		}
		finally { root.remove(); }
	});

	it('maps every generated bucket to its numeric log2 center without creating missing cells', () => {
		const f = generateHeatmapCells();
		const frame = f.find(f => f.schema.meta?.type == 'heatmap-cells');
		const values = name => frame.data.values[frame.schema.fields.findIndex(f => f.name == name)];
		const xs = values('xMax'), lo = values('yMin'), hi = values('yMax');
		const interval = frame.schema.fields.find(f => f.name == 'xMax').config.interval;
		const minX = xs.reduce((a, b) => Math.min(a, b), Infinity);
		const maxX = xs.reduce((a, b) => Math.max(a, b), -Infinity);
		const minY = lo.reduce((a, b) => Math.min(a, b), Infinity);
		const maxY = hi.reduce((a, b) => Math.max(a, b), -Infinity);
		const c = prepareData(f);
		assert.ok(xs.length >= 225000 && xs.length <= 275000);
		assert.equal(c.times, xs);
		assert.equal(c.yMin, lo);
		assert.equal(c.yMax, hi);
		assert.equal(c.counts, values('count'));
		assert.equal(c.xSize, interval);
		assert.equal(c.columns[countColumn], values('count'));
		assert.equal(c.columns[timeColumn].length, xs.length);
		assert.equal(c.columns[bucketColumn].length, xs.length);
		assert.equal(new Set(c.columns[timeColumn]).size, new Set(xs).size);
		assert.equal(new Set(c.columns[bucketColumn]).size, new Set(lo).size);
		assert.equal(c.nx, Math.round((maxX - minX) / interval) + 1);
		assert.equal(c.ny, Math.round(Math.log(maxY / minY) / Math.log(hi[0] / lo[0])));
		for (let i = 0; i < c.times.length; i++) {
			assert.equal(c.columns[timeColumn][i], c.times[i] - c.xSize / 2);
			close(c.columns[bucketColumn][i], Math.log2(Math.sqrt(c.yMin[i] * c.yMax[i])));
			assert.equal(c.columns[countColumn][i], c.counts[i]);
		}
	});

	for (const mode of ['linear', 'sqrt', 'log']) {
		it(`uses native gradient stops for ${mode} without transforming counts`, () => {
			const min = .01, max = 1.4;
			const gradient = colorGradient(min, max, mode);
			const stops = Array.from(gradient.matchAll(/(rgb\([^)]+\)) ([\d.eE+-]+)%/g), m => ({ color: m[1], t: +m[2] / 100 }));
			assert.equal(stops.length, 64);
			assert.deepEqual(stops[0], { color: palette[0], t: 0 });
			assert.deepEqual(stops.at(-1), { color: palette.at(-1), t: 1 });
			for (let i = 0; i < 31; i++) {
				const v = colorBoundary((i + .5) / 31, min, max, mode);
				close(stops[1 + 2 * i].t, .5 + .5 * v / max);
				assert.equal(stops[1 + 2 * i].color, palette[i]);
				assert.equal(stops[2 + 2 * i].color, palette[i + 1]);
			}
			assert.equal(colorGradient(7, 7, mode), `linear-gradient(to right, ${palette[0]}, ${palette[0]})`);
		});
	}

	it('configures the built-in Heatmap with explicit numeric sorting and a count-only pivot', () => {
		const c = prepareData(frames()), config = viewerConfig(c, 'linear');
		assert.equal(config.plugin, 'Heatmap');
		assert.deepEqual(config.group_by, [timeColumn]);
		assert.deepEqual(config.split_by, [bucketColumn]);
		assert.deepEqual(config.columns, [countColumn]);
		assert.equal(config.aggregates[countColumn], 'sum');
		assert.deepEqual(config.sort, [[timeColumn, 'asc'], [bucketColumn, 'col asc']]);
		assert.equal(config.columns_config[countColumn].gradient, colorGradient(c.minCount, c.maxCount, 'linear'));
		assert.equal(config.plugin_config.legend_mode, 'none');
	});

	it('loads once, replaces rather than appends, changes native styles, and disposes in order', async () => {
		const root = rootFor(), api = mock(root);
		let demo;
		try {
			demo = await createDemo(root, frames(), api);
			assert.deepEqual(api.calls.map(c => c[0]), ['worker', 'table', 'update', 'load', 'restore', 'flush']);
			const data = api.calls.find(c => c[0] == 'update')[1];
			assert.equal(api.calls.find(c => c[0] == 'load')[1], api.client);
			assert.deepEqual(api.calls.find(c => c[0] == 'table')[1], { [timeColumn]: 'datetime', [bucketColumn]: 'float', [countColumn]: 'float' });
			root.querySelector('#set-data').click();
			assert.equal(root.querySelector('#set-data').disabled, true);
			await tick();
			assert.equal(api.calls.find(c => c[0] == 'replace')[1], data);
			assert.equal(api.calls.filter(c => c[0] == 'update').length, 1);
			const mode = root.querySelector('#color-scale');
			mode.value = 'sqrt'; mode.dispatchEvent(new Event('change'));
			await tick();
			const patch = api.calls.filter(c => c[0] == 'restore').at(-1)[1];
			assert.deepEqual(Object.keys(patch), ['columns_config']);
			assert.equal(root.querySelector('#color-scale-label').textContent, 'Count · √ scale');
			const h = root.querySelector('#height'); h.value = '720'; h.dispatchEvent(new Event('input'));
			assert.equal(root.querySelector('#plot').style.height, '720px');
			assert.equal(root.querySelector('#height-value').textContent, '720px');
			await demo.destroy();
			assert.deepEqual(api.calls.slice(-3).map(c => c[0]), ['viewer.delete', 'table.delete', 'terminate']);
			const count = api.calls.length;
			await demo.destroy();
			mode.dispatchEvent(new Event('change'));
			await tick();
			assert.equal(api.calls.length, count);
			assert.equal(root.querySelector('perspective-viewer'), null);
		}
		finally { await demo?.destroy(); root.remove(); }
	});

	it('waits for an outstanding update before deleting the view and table', async () => {
		const root = rootFor(), api = mock(root);
		let release;
		api.table.replace = () => new Promise(resolve => { release = resolve; });
		try {
			const demo = await createDemo(root, frames(), api);
			root.querySelector('#set-data').click(); await tick();
			const disposing = demo.destroy(); await tick();
			assert.equal(api.calls.some(c => c[0] == 'viewer.delete'), false);
			release(); await disposing;
			assert.deepEqual(api.calls.slice(-3).map(c => c[0]), ['viewer.delete', 'table.delete', 'terminate']);
			assert.equal(root.querySelector('#set-data').disabled, true);
		}
		finally { root.remove(); }
	});

	for (const stage of ['worker', 'table', 'update', 'load', 'restore', 'flush']) {
		it(`cleans up allocated resources if ${stage} fails`, async () => {
			const root = rootFor(), api = mock(root, stage);
			try {
				await assert.rejects(createDemo(root, frames(), api), new RegExp(`failed ${stage}`));
				const names = api.calls.map(c => c[0]);
				assert.ok(names.includes('viewer.delete'));
				assert.equal(names.includes('terminate'), stage != 'worker');
				assert.equal(names.includes('table.delete'), !['worker', 'table'].includes(stage));
				assert.equal(root.querySelector('#set-data').disabled, true);
			}
			finally { root.remove(); }
		});
	}
});
