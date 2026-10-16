import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';
import { generateHeatmapCells } from '../demos/lib/heatmapCellsData.js';
import { createDemo } from '../demos/heatmap-cells.js';
import { createDemo as createOriginalDemo } from '../demos/heatmap-sparse.js';

function rootFor(name) {
	const html = readFileSync(new URL(`../demos/${name}.html`, import.meta.url), 'utf8');
	const page = new DOMParser().parseFromString(html, 'text/html');
	const root = document.importNode(page.querySelector('#demo'), true);
	document.body.appendChild(root);
	return root;
}

function rectangles(u) {
	return u.ctx.log.slice(u.ctx.log.findLastIndex(entry => entry[0] == 'clearRect'))
		.filter(entry => entry[0] == 'fill').flatMap(entry => entry.slice(1))
		.flatMap(([path]) => path?.log?.filter(entry => entry[0] == 'rect').flatMap(entry => entry.slice(1)) ?? []);
}

function state(demo, root) {
	const u = demo.plot;
	return {
		data: u.data,
		scales: ['x', 'y'].map(key => [u.scales[key].min, u.scales[key].max, u.scales[key]._asinh]),
		rectangles: rectangles(u),
		status: root.querySelector('#status').textContent,
		legend: root.querySelector('#color-scale-label').textContent,
	};
}

describe('heatmap cells demo', () => {
	it('matches the original demo when given the same frames without the dashboard wrapper', async () => {
		const frames = [
			{ schema: { meta: { type: 'other' } } },
			{ schema: { meta: { type: 'heatmap-cells' }, fields: [
				{ name: 'count' }, { name: 'yMax' }, { name: 'xMax', config: { interval: 60000 } },
				{ name: 'yLayout' }, { name: 'yMin' },
			] }, data: { values: [[1, 2, 3, 4], [2, 4, 2, 8], [60000, 60000, 120000, 120000], [0, 0, 0, 0], [1, 2, 1, 4]] } },
		];
		const roots = [rootFor('heatmap-sparse'), rootFor('heatmap-cells')];
		const demos = [];
		try {
			demos.push(createOriginalDemo(roots[0], { panels: [{ targets: [{ rawFrameContent: JSON.stringify(frames) }] }] }));
			demos.push(createDemo(roots[1], frames));
			await Promise.resolve();
			assert.deepEqual(state(demos[1], roots[1]), state(demos[0], roots[0]));
			for (const [id, value] of [['color-scale', 'sqrt'], ['color-scale', 'log'], ['y-scale', 'asinh'], ['y-scale', 'linear'], ['y-scale', 'log']]) {
				for (const root of roots) {
					const select = root.querySelector(`#${id}`);
					select.value = value;
					select.dispatchEvent(new Event('change'));
				}
				await Promise.resolve();
				assert.deepEqual(state(demos[1], roots[1]), state(demos[0], roots[0]));
			}
			for (const root of roots) {
				const signed = root.querySelector('#signed-data');
				signed.checked = true;
				signed.dispatchEvent(new Event('change'));
			}
			await Promise.resolve();
			assert.deepEqual(state(demos[1], roots[1]), state(demos[0], roots[0]));
		}
		finally {
			demos.forEach(demo => demo.destroy());
			roots.forEach(root => root.remove());
		}
	});

	for (const [seconds, label] of [[60, 'one-minute'], [1200, '20-minute'], [30, '30-second'], [90, '90-second'], [.5, '0.5-second']]) {
		it(`labels ${seconds}-second intervals accurately`, async () => {
			const frames = [{ schema: { meta: { type: 'heatmap-cells' }, fields: [
				{ name: 'xMax', config: { interval: seconds * 1000 } },
				{ name: 'yMin' }, { name: 'yMax' }, { name: 'count' },
			] }, data: { values: [[seconds * 1000, seconds * 2000], [1, 1], [2, 2], [3, 4]] } }];
			const root = rootFor('heatmap-cells');
			let demo;
			try {
				demo = createDemo(root, frames);
				await Promise.resolve();
				assert.equal(root.querySelector('#status').textContent,
					`2 cells · 2 ${label} intervals · log₂ Y · uniform-grid hover · no densification or exemplars`);
				if (seconds == 60) {
					const u = demo.plot;
					assert.deepEqual(u.axes[0].values(u, [0, null, 60]), ['00:00', null, '00:01']);
					u.setCursor({ left: u.valToPos(30, 'x'), top: u.valToPos(1.5, 'y') });
					assert.equal(root.querySelector('#hover').textContent, '00:00:00–00:01:00 UTC · Y: 1–2 s · Count: 3');
				}
			}
			finally { demo?.destroy(); root.remove(); }
		});
	}

	for (const xGapProbability of [.5, 1]) {
		it(`keeps generated column gaps empty through zoom and setData (p=${xGapProbability})`, async function() {
			this.timeout(15000);
			const options = { seed: 1, columns: 16, start: 0, interval: 60000 };
			const frames = generateHeatmapCells({ ...options, xGapProbability });
			const source = frames[0].data.values;
			const full = generateHeatmapCells(options)[0].data.values;
			const present = new Set(source[0]);
			const missing = Array.from({ length: options.columns }, (_, col) => col)
				.filter(col => !present.has((col + 1) * options.interval));
			assert.deepEqual(missing, xGapProbability == .5 ? [1, 2, 9, 10, 14] : Array.from({ length: 14 }, (_, i) => i + 1));
			assert.deepEqual(source, full.map(values => values.filter((_, i) => present.has(full[0][i]))));
			const root = rootFor('heatmap-cells');
			let demo;
			try {
				demo = createDemo(root, frames);
				await Promise.resolve();
				const u = demo.plot;
				assert.deepEqual([u.scales.x.min, u.scales.x.max], [0, 960]);
				assert.ok(root.querySelector('#status').textContent.startsWith(`${source[0].length.toLocaleString()} cells · 16 one-minute intervals`));

				function check() {
					const { left, top, width, height } = u.bbox;
					const px = v => Math.max(left, Math.min(left + width, Math.round(u.valToPos(v, 'x', true))));
					const py = v => Math.max(top, Math.min(top + height, Math.round(u.valToPos(v, 'y', true))));
					// Project source bounds independently of the plugin's grid and color-grouped paths.
					const boxes = source[0].map((time, id) => {
						const x = px(time / 1000 - 60), y = py(source[2][id]);
						return { id, rect: [x, y, px(time / 1000) - x, py(source[1][id]) - y] };
					}).filter(({ rect: [, , w, h] }) => w > 0 && h > 0);
					const drawn = rectangles(u);
					const compare = (a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b));
					assert.deepEqual(drawn.slice().sort(compare), boxes.map(b => b.rect).sort(compare));
					const hit = (x, y, expected) => {
						u.setCursor({ left: (x - left) / u.pxRatio, top: (y - top) / u.pxRatio });
						assert.equal(u.cursor.dataIdx(u, 1), expected, `canvas (${x}, ${y})`);
					};
					const matches = (x, y) => boxes.filter(({ rect: [l, t, w, h] }) => x >= l && x <= l + w && y >= t && y <= t + h);
					let shared = 0, fallback = 0;
					for (const { id, rect: [x, y, w, h] } of boxes) {
						hit(x + w / 2, y + h / 2, id);
						// Rounded canvas bounds are inclusive; the last matching source wins.
						for (const delta of [-.25, 0, .25]) {
							for (const [qx, qy] of [[x + delta, y + h / 2], [x + w + delta, y + h / 2],
								[x + w / 2, y + delta], [x + w / 2, y + h + delta]]) {
								if (qx >= left && qx <= left + width && qy >= top && qy <= top + height)
									hit(qx, qy, matches(qx, qy).at(-1)?.id ?? null);
							}
						}
						const edge = matches(x + w, y + h / 2);
						if (edge.some(b => source[0][b.id] > source[0][id])) {
							assert.ok(edge.at(-1).id > id, 'later column wins the shared edge');
							shared++;
						}
						if (missing.includes(source[0][id] / options.interval) && x + w < left + width) {
							hit(x + w, y + h / 2, id);
							hit(x + w + .25, y + h / 2, null);
							fallback++;
						}
					}
					if (xGapProbability == .5) assert.ok(shared > 0, 'probed shared edges of retained columns');
					if (u.scales.x.min == 0 || xGapProbability == .5) assert.ok(fallback > 0, 'earlier cell still hits at an edge bordering a gap');
					let gaps = 0;
					for (const col of missing) {
						if (col * 60 < u.scales.x.min || (col + 1) * 60 > u.scales.x.max) continue;
						const l = px(col * 60), r = px((col + 1) * 60);
						assert.ok(drawn.every(([x, , w]) => x + w <= l || x >= r), `no paint inside column ${col}`);
						// Use occupied ungapped buckets so misses cannot be explained by sparse Y rows.
						full[0].forEach((time, i) => {
							if (time == (col + 1) * options.interval)
								hit((l + r) / 2, (py(full[1][i]) + py(full[2][i])) / 2, null);
						});
						gaps++;
					}
					assert.ok(gaps > 1, 'probed multiple absent columns');
				}

				check();
				u.setScale('x', { min: 7 * 60, max: 16 * 60 });
				await Promise.resolve();
				check();
				root.querySelector('#set-data').click();
				await Promise.resolve();
				check();
			}
			finally { demo?.destroy(); root.remove(); }
		});
	}

	it('renders all generated source cells with the existing controls', async function() {
		this.timeout(15000);
		const frames = generateHeatmapCells();
		const frame = frames.find(f => f.schema.meta?.type == 'heatmap-cells');
		const values = name => frame.data.values[frame.schema.fields.findIndex(f => f.name == name)];
		const root = rootFor('heatmap-cells');
		let demo;
		try {
			demo = createDemo(root, frames);
			await Promise.resolve();
			const u = demo.plot, xs = values('xMax');
			assert.ok(xs.length >= 225000 && xs.length <= 275000);
			const interval = frame.schema.fields.find(f => f.name == 'xMax').config.interval;
			const minX = xs.reduce((a, b) => Math.min(a, b), Infinity);
			const maxX = xs.reduce((a, b) => Math.max(a, b), -Infinity);
			const minY = values('yMin').reduce((a, b) => Math.min(a, b), Infinity);
			const maxY = values('yMax').reduce((a, b) => Math.max(a, b), -Infinity);
			assert.deepEqual(u.data[1].map(facet => facet.length), [xs.length, xs.length, xs.length, xs.length]);
			assert.equal(u.data[1][1], values('yMin'));
			assert.equal(u.data[1][2], values('yMax'));
			assert.equal(u.data[1][3], values('count'));
			assert.deepEqual(u.data[1][0], xs.map(x => x / 1000));
			assert.deepEqual([u.scales.x.min, u.scales.x.max], [minX / 1000 - interval / 1000, maxX / 1000]);
			assert.deepEqual([u.scales.y.min, u.scales.y.max], uPlot.rangeLog(minY, maxY, 2, true));
			assert.ok(root.querySelector('#status').textContent.startsWith(`${xs.length.toLocaleString()} cells · 2569 20-minute intervals`));
			const start = u.scales.x.min, end = u.scales.x.max;
			const splits = [start, null, end];
			const dates = splits.map(v => v == null ? null : new Date(v * 1000).toISOString().slice(5, 10));
			assert.deepEqual(u.axes[0].values(u, splits), dates);
			for (const control of root.querySelectorAll('select, input, button')) assert.equal(control.disabled, false);
			const drawn = rectangles(u);
			assert.ok(drawn.length > 0);
			const [x, y, w, h] = drawn[Math.floor(drawn.length / 2)];
			u.setCursor({ left: (x + w / 2 - u.bbox.left) / u.pxRatio, top: (y + h / 2 - u.bbox.top) / u.pxRatio });
			assert.notEqual(u.cursor.dataIdx(u, 1), null);
			root.querySelector('#set-data').click();
			await Promise.resolve();
			assert.deepEqual(rectangles(u), drawn);
			for (const span of [86400, 86399, 3600]) {
				u.setScale('x', { min: start, max: start + span });
				await Promise.resolve();
				const visibleSplits = [start, null, start + span];
				assert.deepEqual(u.axes[0].values(u, visibleSplits), visibleSplits.map(v => v == null ? null :
					new Date(v * 1000).toISOString().slice(...(span >= 86400 ? [5, 10] : [11, 16]))));
			}
			u.setScale('x', { min: start, max: end });
			await Promise.resolve();
			assert.deepEqual(u.axes[0].values(u, splits), dates);
		}
		finally { demo?.destroy(); root.remove(); }
	});
});
