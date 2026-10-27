import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';

const data = [[0, 1, 2], [10, 20, 30], [40, 50, 60], [70, 80, 90]];
const labels = ['Time', 'Alpha', 'Beta', 'Gamma'];
const frame = async () => { await Promise.resolve(); await new Promise(requestAnimationFrame); };
const rows = legend => [...legend.querySelectorAll('tbody tr')];
const rowLabels = legend => rows(legend).map(row => row.querySelector('.u-label').textContent);
const cells = row => [...row.querySelectorAll('td')].map(cell => cell.textContent);
const legendNode = u => u.root.querySelector('.u-legend');
const sideClasses = ['u-top', 'u-rgt', 'u-btm', 'u-lft'];

function assertPosition(u, legend, side) {
	assert.equal(u.root.hasAttribute('data-legend-side'), false);
	assert.deepEqual(sideClasses.filter(name => u.root.classList.contains(name)), []);
	if (legend != null) {
		assert.equal(legend.tagName, 'TABLE');
		assert.equal(legend.hasAttribute('data-legend-side'), false);
		assert.deepEqual(sideClasses.filter(name => legend.classList.contains(name)), [sideClasses[side ?? 2]]);
	}
}

const mouse = (target, type) => target.dispatchEvent(new MouseEvent(type, {
	bubbles: type == 'click', cancelable: true, button: 0,
}));

function trackOverlayRect(u, shifted) {
	const before = new DOMRect(101, 203, 400, 240);
	const after = new DOMRect(141, 233, 400, 240);
	let reads = 0;
	// Model a layout change from rendered DOM; do not infer geometry from HappyDOM.
	u.over.getBoundingClientRect = () => {
		reads++;
		return shifted() ? after : before;
	};
	return { before, after, get reads() { return reads; } };
}

function assertMouseRect(u, rects) {
	const expected = rects.after;
	for (const [i, clientX] of [300, 301, 302].entries()) {
		// No mouseenter or explicit syncRect: mousemove must use the render's invalidation.
		u.over.dispatchEvent(new MouseEvent('mousemove', {
			bubbles: true, cancelable: true, clientX, clientY: 320,
		}));
		assert.deepEqual([u.cursor.left, u.cursor.top], [clientX - expected.left, 320 - expected.top]);
		assert.equal(rects.reads, i == 0 ? 2 : 3, 'a synchronous value render invalidates the next event, while unchanged values reuse the rectangle');
	}
	assert.equal(u.rect === expected, true);
	assert.equal(rects.reads, 3);
}

// HappyDOM does not lay out CSS grids or wrap text. These tests check DOM structure,
// configured styles, and chart-computed sizes, not physical legend placement or bounds.
describe('legend mode and side layout', () => {
	let plots;
	let hosts;

	beforeEach(() => {
		plots = new Set();
		hosts = [];
	});

	afterEach(() => {
		for (const u of plots)
			u.destroy();
		for (const host of hosts)
			host.remove();
	});

	async function plot({ legend = {}, multi = false, mode = 1, title, dom, hooks = {} } = {}) {
		const formats = [];
		const valueAt = (self, si, idx) => idx == null ? null :
			(mode == 1 ? self.data?.[si]?.[idx] : self.data?.[si]?.[1]?.[idx]);
		const u = new uPlot({
			width: 400, height: 240, pxRatio: 1, mode, title, dom,
			padding: [0, 0, 0, 0],
			axes: [{ show: false }, { show: false }],
			scales: { x: { time: false, range: [0, 2] }, y: { range: [0, 100] } },
			cursor: { focus: { prox: 1 } },
			focus: { alpha: 0.25 },
			legend,
			series: labels.map((label, si) => ({
				label,
				...(si > 0 && { stroke: ['red', 'green', 'blue'][si - 1], points: { show: false } }),
				value(self, value, index, idx) {
					formats.push(['value', index, idx]);
					const scalar = mode == 1 ? value : valueAt(self, index, idx);
					return scalar == null ? '--' : `${index == 0 ? 'x' : 'v'}=${scalar}`;
				},
				...(multi && si > 0 && {
					values(self, index, idx) {
						formats.push(['values', index, idx]);
						const value = valueAt(self, index, idx);
						return {
							Value: value == null ? '--' : `v=${value}`,
							Double: value == null ? '--' : `d=${2 * value}`,
						};
					},
				}),
			})),
			hooks: { setLegend: [], setSeries: [], setSize: [], ...hooks },
		}, mode == 1 ? data.map(values => values.slice()) :
			[null, ...data.slice(1).map(values => [data[0].slice(), values.slice()])], (self, init) => {
			plots.add(self);
			self.ctx.measureText = text => ({ width: String(text).length * 8 });
			document.body.appendChild(self.root);
			init();
		});
		await frame();
		formats.length = 0;
		return { u, formats };
	}

	it('declares a fixed grid on every root and assigns direct canvases to the plot area without changing inline styles', () => {
		const style = document.createElement('style');
		style.textContent = readFileSync(new URL('../src/uPlot.css', import.meta.url), 'utf8');
		document.head.appendChild(style);
		try {
			const rules = [...style.sheet.cssRules];
			const declaration = (selector, property) => rules
				.filter(rule => rule.selectorText?.split(',').some(part => part.trim().replace(/\s*>\s*/g, ' > ') == selector))
				.map(rule => rule.style.getPropertyValue(property).trim()).filter(Boolean).at(-1);
			assert.equal(declaration('.uplot', 'display'), 'grid');
			assert.equal(declaration('.uplot', 'grid-template-columns'), 'max-content auto max-content');
			assert.equal(declaration('.uplot', 'grid-template-areas').replace(/\s+/g, ' '), '"tit tit tit" ". top ." "lft plot rgt" ". btm ."');
			for (const [i, area] of ['top', 'rgt', 'btm', 'lft'].entries())
				assert.equal(declaration(`.uplot > .u-legend.${sideClasses[i]}`, 'grid-area'), area);
			assert.equal(declaration('.uplot > .u-title', 'grid-area'), 'tit');
			assert.equal(declaration('.uplot > .u-wrap', 'grid-area'), 'plot');
			assert.equal(declaration('.uplot > canvas', 'grid-area'), 'plot');
			assert.equal(rules.some(rule => rule.selectorText?.includes('data-legend-side')), false);
			assert.equal(declaration('.u-inline', 'display'), 'block');
			assert.equal(declaration('.u-inline *', 'display'), 'inline-block');
			assert.equal(declaration('.u-inline tr', 'margin-right'), '16px');
		}
		finally {
			style.remove();
		}
	});

	it('aligns table labels left and values and column headers right without changing inline legends', async () => {
		const style = document.createElement('style');
		style.textContent = readFileSync(new URL('../src/uPlot.css', import.meta.url), 'utf8');
		document.head.appendChild(style);
		try {
			for (const multi of [false, true]) {
				for (const mode of ['table', 'inline']) {
					const { u } = await plot({ multi, legend: { mode } });
					const legend = legendNode(u);
					for (const label of legend.querySelectorAll('tbody th'))
						assert.equal(getComputedStyle(label).textAlign, mode == 'table' ? 'left' : 'center');
					for (const value of legend.querySelectorAll('.u-value, thead th'))
						assert.equal(getComputedStyle(value).textAlign, mode == 'table' ? 'right' : 'center');
					for (const cell of legend.querySelectorAll('th, td'))
						assert.equal(getComputedStyle(cell).fontVariantNumeric == 'tabular-nums',
							mode == 'table' && cell.classList.contains('u-value'));
				}
			}
		}
		finally {
			style.remove();
		}
	});

	for (const multi of [false, true]) {
		for (const mode of [undefined, null, 'inline', 'table']) {
			it(`uses ${String(mode)} mode with ${multi ? 'multi-value' : 'scalar'} formatting`, async () => {
				const { u, formats } = await plot({ multi, legend: mode === undefined ? {} : { mode } });
				const legend = legendNode(u);
				const inline = mode == null ? !multi : mode == 'inline';
				assert.equal(u.legend.mode, mode ?? null);
				assert.equal(u.legend.side, 2);
				assert.equal(legend.classList.contains('u-inline'), inline);
				assert.equal(legend.querySelectorAll('thead').length, multi ? 1 : 0);
				assert.deepEqual([...legend.querySelectorAll('thead th')].map(cell => cell.textContent),
					multi ? ['', 'Value', 'Double'] : []);
				assert.deepEqual(rowLabels(legend), multi ? labels.slice(1) : labels);
				assertPosition(u, legend, 2);

				const snapshots = [];
				u.hooks.setLegend.push(self => snapshots.push({
					idx: self.legend.idx,
					idxs: self.legend.idxs.slice(),
					values: self.legend.values.map(value => value == null ? value : { ...value }),
					order: self.legend.order.slice(),
				}));
				u.setLegend({ idx: 1 });
				const expected = multi ? [
					{ Value: 'v=20', Double: 'd=40' },
					{ Value: 'v=50', Double: 'd=100' },
					{ Value: 'v=80', Double: 'd=160' },
				] : [{ _: 'x=1' }, { _: 'v=20' }, { _: 'v=50' }, { _: 'v=80' }];
				assert.equal(snapshots.length, 1, 'setLegend hooks run synchronously');
				assert.equal(snapshots[0].idx, 1);
				assert.deepEqual(snapshots[0].idxs, [1, 1, 1, 1]);
				assert.deepEqual(snapshots[0].order, [1, 2, 3]);
				assert.deepEqual(snapshots[0].values.slice(multi ? 1 : 0), expected);
				assert.deepEqual(u.legend.values.slice(multi ? 1 : 0), expected);
				assert.deepEqual(formats, (multi ? [1, 2, 3] : [0, 1, 2, 3])
					.map(si => [multi ? 'values' : 'value', si, 1]));
				await frame();
				assert.deepEqual(rows(legend).map(cells), expected.map(value => Object.values(value)));

				u.setLegend({ idx: null });
				await frame();
				assert.deepEqual(rows(legend).map(cells), expected.map(() => multi ? ['--', '--'] : ['--']));

				const initialClass = legend.className;
				u.legend.mode = inline ? 'table' : 'inline';
				u.setLegend({ idx: 0 });
				await frame();
				assert.equal(legendNode(u) === legend, true);
				assert.equal(legend.className, initialClass, 'mode is fixed at initialization');
				assert.deepEqual(cells(rows(legend)[0]), multi ? ['v=10', 'd=20'] : ['x=0']);
			});
		}
	}

	for (const multi of [false, true]) {
		it(`omits X in mode 2 with an explicit ${multi ? 'inline multi-value' : 'scalar table'} legend`, async () => {
			const { u } = await plot({ mode: 2, multi, legend: { mode: multi ? 'inline' : 'table' } });
			assert.equal(legendNode(u).classList.contains('u-inline'), multi);
			u.setLegend({ idxs: [null, 2, 0, 1] });
			await frame();
			assert.deepEqual(rowLabels(legendNode(u)), labels.slice(1));
			assert.deepEqual(rows(legendNode(u)).map(cells), multi ?
				[['v=30', 'd=60'], ['v=40', 'd=80'], ['v=80', 'd=160']] :
				[['v=30'], ['v=40'], ['v=80']]);
			assert.deepEqual(u.legend.order, [1, 2, 3]);
		});

		it(`keeps a nonlive table label-only with ${multi ? 'multi-value' : 'scalar'} formatters`, async () => {
			const { u, formats } = await plot({ multi, legend: { mode: 'table', live: false } });
			const legend = legendNode(u);
			assert.equal(legend.classList.contains('u-inline'), false);
			assert.deepEqual(rowLabels(legend), labels.slice(1));
			assert.equal(legend.querySelectorAll('thead, td').length, 0);
			u.setLegend({ idx: 1 });
			u.setSeries(2, { show: false });
			await frame();
			assert.equal(legend.querySelectorAll('thead, td').length, 0);
			assert.ok(rows(legend)[1].classList.contains('u-off'));
			assert.deepEqual(formats, []);
		});
	}

	for (const multi of [false, true]) {
		it(`preserves core indices, hooks, and interactions in a selected ${multi ? 'inline multi-value' : 'scalar table'} legend`, async () => {
			let end = 1;
			const { u } = await plot({ multi, legend: {
				mode: multi ? 'inline' : 'table', side: 3,
				filter: (self, si) => si != 2,
				sort: (self, a, b) => b - a,
				limit: () => [0, end],
			} });
			const original = u.series.slice();
			const hooks = [];
			u.hooks.setLegend.push(self => hooks.push({
				order: self.legend.order.slice(), count: self.legend.count,
				range: self.legend.range.slice(), idxs: self.legend.idxs.slice(),
			}));
			u.setLegend({ idxs: [2, 0, 1, 2] });
			assert.deepEqual(hooks, [{ order: [3], count: 2, range: [0, 1], idxs: [2, 0, 1, 2] }]);
			assert.deepEqual(u.legend.values.slice(1), multi ? [
				{ Value: 'v=10', Double: 'd=20' }, { Value: 'v=50', Double: 'd=100' }, { Value: 'v=90', Double: 'd=180' },
			] : [{ _: 'v=10' }, { _: 'v=50' }, { _: 'v=90' }]);
			await frame();
			const legend = legendNode(u);
			assert.deepEqual(rowLabels(legend), multi ? ['Gamma'] : ['Time', 'Gamma']);
			const gamma = rows(legend).at(-1);
			assert.deepEqual(cells(gamma), multi ? ['v=90', 'd=180'] : ['v=90']);

			end = 2;
			u.legend.sort = (self, a, b) => a - b;
			u.setLegend({});
			assert.deepEqual(u.legend.order, [1, 3]);
			await frame();
			assert.deepEqual(rowLabels(legend), multi ? ['Alpha', 'Gamma'] : ['Time', 'Alpha', 'Gamma']);
			assert.equal(rows(legend).at(-1) === gamma, true, 'reordering preserves the series row');
			original.forEach((series, si) => assert.equal(u.series[si] === series, true));

			const events = [];
			u.hooks.setSeries.push((self, si, opts) => events.push([si, { ...opts }]));
			mouse(gamma.querySelector('th'), 'mouseenter');

			assert.deepEqual(events.at(-1), [3, { focus: true }]);
			await frame();
			assert.equal(gamma.style.opacity, '');
			assert.equal(rows(legend).find(row => row.querySelector('.u-label').textContent == 'Alpha').style.opacity, '0.25');
			mouse(gamma.querySelector('th'), 'click');
			assert.equal(u.series[3].show, false);
			assert.deepEqual(events.at(-1), [3, { show: false }]);
			await frame();
			assert.ok(gamma.classList.contains('u-off'));
		});
	}

	for (const side of [0, 1, 2, 3, undefined]) {
		const name = side === undefined ? 'default bottom' : `side ${side}`;

		for (const change of ['membership', 'formatted text']) {
			it(`lazily invalidates the overlay rectangle after ${name} legend ${change} renders`, async () => {
				const { u } = await plot({ legend: { mode: 'table', ...(side !== undefined && { side }) } });
				u.setLegend({ idx: 0 });
				await frame();
				const legend = legendNode(u);
				const text = 'A longer formatted value: 30';
				const shifted = () => change == 'membership' ? rows(legend).length == 3 : cells(rows(legend)[1])[0].startsWith('A longer formatted value:');
				const rects = trackOverlayRect(u, shifted);
				u.syncRect();
				assert.equal(u.rect === rects.before, true, 'prime the old rectangle before the legend changes');
				assert.equal(rects.reads, 1);

				// Every side can shift the plot in the fixed grid; only the position class is init-only.
				u.legend.side = ((side ?? 2) + 1) % 4;
				if (change == 'membership')
					u.legend.filter = (self, si) => si != 3;
				else
					u.series[1].value = (self, value) => `A longer formatted value: ${value}`;
				u.setLegend({ idx: change == 'membership' ? 0 : 2 });
				assert.equal(shifted(), true, 'setLegend renders the changed DOM synchronously');
				assert.equal(rects.reads, 1, 'setLegend must not measure the overlay');
				if (change == 'membership')
					assert.deepEqual(rowLabels(legend), ['Time', 'Alpha', 'Beta']);
				else
					assert.equal(cells(rows(legend)[1])[0], text);
				assert.equal(rects.reads, 1, 'legend rendering must invalidate lazily without a geometry read');
				assertPosition(u, legend, side);
				assertMouseRect(u, rects);
			});
		}
	}

	for (const side of [0, 1, 2, 3, undefined]) {
		it(`lazily invalidates a rectangle cached before the initial ${side === undefined ? 'default bottom' : `side ${side}`} legend mount`, async () => {
			let rects;
			let mounts = 0;
			const { u } = await plot({
				legend: {
					mode: 'table', ...(side !== undefined && { side }),
					mount() {
						mounts++;
						assert.equal(rects.reads, 1, 'initial mount must not eagerly measure the overlay');
					},
				},
				hooks: {
					draw: [self => {
						if (rects != null)
							return;
						assert.equal(legendNode(self), null, 'initial drawing precedes the first legend render');
						rects = trackOverlayRect(self, () => legendNode(self) != null);
						self.syncRect();
						assert.equal(self.rect === rects.before, true);
						assert.equal(rects.reads, 1);
					}],
					ready: [self => {
						assert.deepEqual(rowLabels(legendNode(self)), labels, 'ready observes the mounted legend');
						assert.equal(rects.reads, 1, 'mount leaves the next geometry read deferred');
					}],
				},
			});
			assert.equal(mounts, 1);
			assert.deepEqual(rowLabels(legendNode(u)), labels);
			assert.equal(rects.reads, 1, 'the completed initial render must leave measurement deferred');
			assertMouseRect(u, rects);
		});
	}

	for (const side of [undefined, 0, 1, 2, 3]) {
		for (const [title, mode] of [[undefined, 'table'], ['Legend layout', 'table'], [undefined, 'inline'], ['Legend layout', 'inline']]) {
			it(`sets ${mode} side ${side ?? 'default bottom'} ${title ? 'with' : 'without'} a title and keeps configured wrap sizes on resize`, async () => {
				const { u } = await plot({ title, legend: { mode, ...(side !== undefined && { side }) } });
				const wrap = u.root.querySelector('.u-wrap');
				const legend = legendNode(u);
				const canvas = wrap.querySelector('canvas');
				const initialClass = legend.className;
				assertPosition(u, legend, side);
				assert.equal(u.legend.side, side ?? 2);
				assert.equal(legend.classList.contains('u-inline'), mode == 'inline');
				assert.equal(wrap.parentElement === u.root, true);
				assert.equal(legend.parentElement === u.root, true);
				assert.equal(u.root.querySelectorAll('.u-title').length, title ? 1 : 0);
				if (title) {
					assert.equal(u.root.querySelector('.u-title').textContent, title);
					assert.equal(u.root.querySelector('.u-title').parentElement === u.root, true);
				}
				assert.deepEqual([...u.root.children].map(node => node.classList[0]),
					title ? ['u-title', 'u-wrap', 'u-legend'] : ['u-wrap', 'u-legend']);

				const assertSize = (width, height) => {
					assert.deepEqual([u.width, u.height], [width, height]);
					assert.deepEqual([wrap.style.width, wrap.style.height], [`${width}px`, `${height}px`]);
					assert.deepEqual([canvas.width, canvas.height], [width, height]);
					assert.deepEqual({ ...u.bbox }, { left: 0, top: 0, width, height });
				};
				assertSize(400, 240);
				const sizes = [];
				u.hooks.setSize.push(self => sizes.push([self.width, self.height]));
				for (const [width, height] of [[620, 360], [180, 120]]) {
					u.setSize({ width, height });
					await frame();
					assertSize(width, height);
					assert.deepEqual(sizes.at(-1), [width, height]);
					assert.equal(legendNode(u) === legend, true);
					assertPosition(u, legend, side);
					assert.equal(legend.className, initialClass);
				}

				// Side is an initialization option, not a mutable layout directive.
				u.legend.side = ((side ?? 2) + 1) % 4;
				u.setLegend({ idx: 2 });
				u.setSize({ width: 420, height: 260 });
				await frame();
				assertSize(420, 260);
				assert.equal(legendNode(u) === legend, true);
				assertPosition(u, legend, side);
				assert.equal(legend.className, initialClass, 'side is fixed at initialization');
				assert.deepEqual(rows(legend).map(cells), [['x=2'], ['v=30'], ['v=60'], ['v=90']]);
			});
		}

		it(`updates and destroys a custom-mounted legend on side ${side}`, async () => {
			const host = document.createElement('div');
			const unrelated = document.createElement('span');
			host.appendChild(unrelated);
			document.body.appendChild(host);
			hosts.push(host);
			const mounts = [];
			const { u } = await plot({ title: 'Custom mount', hooks: { ready: [self => {
				assert.equal(legendNode(self), null);
				self.legend.side = ((side ?? 2) + 1) % 4;
			}] }, legend: {
				mode: 'table', ...(side !== undefined && { side }),
				mount(self, node) {
					assertPosition(self, node, side);
					assert.equal(node.classList.contains('u-inline'), false);
					assert.equal(node.parentElement === self.root, true);
					assert.deepEqual(rowLabels(node), labels);
					mounts.push(node);
					host.appendChild(node);
				},
			} });
			assert.equal(mounts.length, 1);
			const legend = mounts[0];
			const initialClass = legend.className;
			assertPosition(u, legend, side);
			assert.equal(legendNode(u), null);
			assert.equal(legend.parentElement === host, true);
			u.setLegend({ idx: 2 });
			u.setSize({ width: 500, height: 280 });
			await frame();
			assert.deepEqual(rows(legend).map(cells), [['x=2'], ['v=30'], ['v=60'], ['v=90']]);
			assert.equal(u.root.querySelector('.u-wrap').style.width, '500px');
			assertPosition(u, legend, side);
			assert.equal(legend.className, initialClass);
			assert.equal(mounts.length, 1);
			const header = rows(legend)[1].querySelector('th');
			u.setLegend({ idx: 0 });
			u.destroy();
			plots.delete(u);
			await frame();
			assert.equal(legend.isConnected, false);
			assert.equal(legend.parentNode, null);
			assert.equal(host.childNodes.length, 1);
			assert.equal(host.firstChild === unrelated, true);
			let events = 0;
			u.hooks.setSeries.push(() => events++);
			mouse(header, 'click');
			mouse(header, 'mouseenter');
			assert.equal(events, 0, 'destroy removes relocated legend listeners');
			assert.equal(mounts.length, 1, 'pending renders must not remount after destroy');
		});

		for (const [headless, title] of [[false, undefined], [false, 'No legend'], [true, undefined]]) {
			it(`does not set side ${side ?? 'default bottom'} on a ${headless ? 'headless chart' : 'hidden legend'} ${title ? 'with' : 'without'} a title`, async () => {
				let mounts = 0;
				const { u } = await plot({
					title, dom: headless ? { uplot: false } : undefined,
					legend: { mode: 'table', ...(side !== undefined && { side }), show: headless, mount: () => mounts++ },
				});
				assert.equal(u.legend.show, false);
				assert.equal(u.root instanceof HTMLCanvasElement, headless);
				const canvas = headless ? u.root : u.root.querySelector('canvas');
				assertPosition(u, null, side);
				assert.equal(legendNode(u), null);
				if (!headless && !title) {
					assert.equal(u.root.classList.contains('u-wrap'), true);
					assert.equal(u.root.querySelector('.u-wrap'), null);
					assert.equal(canvas.parentElement === u.root, true);
				}
				u.legend.side = ((side ?? 2) + 1) % 4;
				u.setLegend({ idx: 1 });
				u.setSize({ width: 450, height: 250 });
				await frame();
				assertPosition(u, null, side);
				assert.equal(legendNode(u), null);
				assert.equal(mounts, 0);
				assert.deepEqual([canvas.width, canvas.height], [450, 250]);
				if (!headless && !title) {
					assert.equal(canvas.parentElement === u.root, true);
					assert.deepEqual([u.root.style.width, u.root.style.height], ['450px', '250px']);
				}
			});
		}
	}
});
