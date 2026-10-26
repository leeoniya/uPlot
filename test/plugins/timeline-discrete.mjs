import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import '../../scripts/instrument.mjs';
import uPlot from '../../src/uPlot.js';
import { distr, SPACE_BETWEEN } from '../../demos/lib/distr.js';

const html = await readFile(new URL('../../demos/timeline-discrete.html', import.meta.url), 'utf8');
const source = html.slice(html.indexOf('const { round'), html.indexOf('function makeChart'));
const timelinePlugin = new Function('uPlot', 'distr', 'SPACE_BETWEEN', source + '\nreturn timelinePlugin;')(uPlot, distr, SPACE_BETWEEN);

describe('timeline/discrete hover', () => {
	let u;

	afterEach(() => u?.destroy());

	async function mount(data, options = {}) {
		const plugin = timelinePlugin({
			mode: 1, count: data.length - 1,
			fill: () => 'red', stroke: () => 'red',
			...options,
		});

		u = new uPlot({
			width: 800,
			height: 300,
			scales: { x: { time: false } },
			axes: [{}, {}],
			series: data.map((_, i) => ({ label: String(i), width: 4, value: (u, value) => value })),
			plugins: [plugin],
		}, data, document.body);
		await Promise.resolve();
	}

	function hover(x, si = 1) {
		u.cursor.left = u.valToPos(x, 'x');
		return u.cursor.dataIdx(u, si, u.valToIdx(x));
	}

	const timeline = () => [
		[0, 1, 2, 3, 4, 5, 6, 7, 8],
		[undefined, 'a', undefined, undefined, null, undefined, 'b', undefined, undefined],
		[null, null, 'c', undefined, undefined, undefined, undefined, undefined, undefined],
	];

	it('finds independent lane spans, gaps, and the final open span in either direction', async () => {
		await mount(timeline());
		for (const [x, expected] of [[.5, null], [1.2, 1], [3.8, 1], [4, null], [5.8, null], [6, 6], [7.8, 6], [3.5, 1], [.5, null]])
			assert.equal(hover(x) ?? null, expected, `x=${x}`);

		u.setCursor({ left: u.valToPos(3, 'x'), top: 5 });
		assert.deepEqual(u.legend.idxs.slice(1), [1, 2]);
		const box = u.cursor.points.bbox(u, 1);
		assert.equal(box.left, Math.round((Math.round(u.valToPos(1, 'x', true)) - u.bbox.left) / uPlot.pxRatio));
		assert.equal(box.width, Math.round((Math.round(u.valToPos(4, 'x', true)) - Math.round(u.valToPos(1, 'x', true))) / uPlot.pxRatio));
		assert.ok(u.cursor.points.bbox(u, 2).top > box.top);
	});

	it('updates the legend time through the same text node across cursor moves', async () => {
		await mount(timeline());
		const cell = u.root.querySelector('.u-series:first-child .u-value');
		const text = cell.firstChild;
		assert.equal(text.nodeType, Node.TEXT_NODE);

		for (const x of [1.1, 1.2, 3.8, 5, 7]) {
			u.setCursor({ left: u.valToPos(x, 'x'), top: 5 });
			assert.equal(cell.firstChild, text);
			assert.equal(cell.childNodes.length, 1);
			assert.equal(text.data, x.toFixed(2));
		}
	});


	it('reuses the rectangle and does not re-scan active spans or gaps', async () => {
		await mount(timeline());
		let reads = 0;
		u.data[1] = new Proxy(u.data[1], {
			get(target, key) {
				if (/^\d+$/.test(String(key)))
					reads++;
				return target[key];
			},
		});

		for (const [start, end] of [[1.2, 3.8], [4.2, 5.8]]) {
			hover(start);
			assert.ok(reads > 0);
			reads = 0;
			hover(end);
			assert.equal(reads, 0);
		}

		hover(2);
		const box = u.cursor.points.bbox(u, 1);
		hover(7);
		assert.equal(u.cursor.points.bbox(u, 1), box);
		assert.equal(box.didx, 6);
	});

	it('refreshes cached spans and geometry after data, scale, and size changes', async () => {
		await mount(timeline());
		assert.equal(hover(3), 1);
		const data = timeline();
		data[1][2] = 'new';
		u.setData(data);
		await Promise.resolve();
		assert.equal(hover(3), 2);
		u.setScale('x', { min: 2.5, max: 7.5 });
		u.setSize({ width: 1000, height: 400 });
		await Promise.resolve();
		assert.equal(hover(3), 2);
		const box = u.cursor.points.bbox(u, 1);
		assert.equal(box.left, Math.round((Math.round(u.valToPos(2, 'x', true)) - u.bbox.left) / uPlot.pxRatio));
		u.setSeries(1, { show: false });
		await Promise.resolve();
		assert.equal(hover(3), null);
		u.setSeries(1, { show: true });
		await Promise.resolve();
		assert.equal(hover(3), 2);
		u.cursor.left = -10;
		assert.equal(u.cursor.dataIdx(u, 1, 0), null);
		assert.equal(u.cursor.points.bbox(u, 1).width, 0);
	});

	for (const align of [-1, 0, 1]) {
		it(`checks matrix bounds and reuses the rectangle with alignment ${align}`, async () => {
			await mount([[0, 1, 2, 3], ['a', null, 'b', 'c']], { mode: 2, size: [.9, Infinity], align });
			const shift = align * .7;
			assert.equal(hover(2 + shift), 2);
			const box = u.cursor.points.bbox(u, 1);
			assert.equal(hover(1 + shift) ?? null, null);
			assert.equal(hover(2 + (align == 0 ? .49 : -align * .1)) ?? null, null);
			assert.equal(hover(align == -1 ? 3 + shift : shift), align == -1 ? 3 : 0);
			assert.equal(u.cursor.points.bbox(u, 1), box);
		});
	}
});
