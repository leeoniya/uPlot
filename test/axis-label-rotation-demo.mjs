import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import '../scripts/instrument.mjs';
import { withSeededRandom } from '../scripts/withSeededRandom.mjs';
import { createDemo } from '../demos/axis-label-rotation.js';
import { withBarTotals } from '../demos/lib/barTotals.js';
import { createBarControls } from '../demos/lib/barControls.js';

import { distr } from '../demos/lib/distr.js';

const html = await readFile(new URL('../demos/axis-label-rotation.html', import.meta.url), 'utf8');

describe('random label rotation demo', () => {
	const measureHook = Symbol.for('uplot.test.axisMeasure');
	let root, demo, u, measurements, originalOffscreenCanvas, originalResizeObserver, observers;
	const input = id => root.querySelector(`#${id}`);
	const stackingInputs = [
		['stacking-off', 'grouped'],
		['stacking-normal', 'value'],
		['stacking-percent', 'percent'],
	];
	const stacking = () => Array.from(root.querySelectorAll('input[name="stacking"]')).find(el => el.checked).value;

	function assertStackingMode(mode) {
		assert.equal(stacking(), mode);
		assert.equal(Array.from(root.querySelectorAll('input[name="stacking"]')).filter(el => el.checked).length, 1, 'stacking modes are mutually exclusive');
		for (const [id, value] of stackingInputs) {
			assert.equal(input(id).checked, value == mode);
			assert.equal(input(id).disabled, false, 'every stacking mode is directly selectable');
		}
	}

	async function selectStacking(mode) {
		await toggle(stackingInputs.find(([, value]) => value == mode)[0], true);
		assertStackingMode(mode);
	}

	beforeEach(async () => {
		root = document.createElement('div');
		root.innerHTML = html.match(/<main\b[^]*?<\/main>/)[0];
		document.body.appendChild(root);
		measurements = { x: [], y: [] };
		// Core contexts survive chart destruction and can originate in another test suite.
		globalThis[measureHook] = ({ text }) => {
			measurements[demo.plot.axes[1]._values?.includes(text) ? 'y' : 'x'].push(text);
		};
		originalResizeObserver = globalThis.ResizeObserver;
		observers = [];
		globalThis.ResizeObserver = class {
			constructor(callback) {
				this.callback = callback;
				this.observeCount = 0;
				this.disconnectCount = 0;
				observers.push(this);
			}
			observe(target) {
				this.target = target;
				this.observeCount++;
			}
			disconnect() {
				this.target = null;
				this.disconnectCount++;
			}
		};
		originalOffscreenCanvas = globalThis.OffscreenCanvas;
		globalThis.OffscreenCanvas = class {
			constructor(width, height) {
				this.width = width;
				this.height = height;
				this.ctx = {
					canvas: this,
					log: [],
					set font(value) { this.log.push(['font', value]); },
					get font() { return this.log.at(-1)[1]; },
					clearRect() {},
					fillRect() {},
					getImageData() {
						const data = {
													royalblue: [65, 105, 225, 255], darkorange: [255, 140, 0, 255],
													seagreen: [46, 139, 87, 255], orchid: [218, 112, 214, 255], crimson: [220, 20, 60, 255],
													lightgray: [211, 211, 211, 255], silver: [192, 192, 192, 255],
												}[this.fillStyle];
						assert.ok(data, `missing color fixture: ${this.fillStyle}`);
						return { data };
					},
					measureText(text) {
						globalThis[measureHook]?.({ text: String(text), font: this.font, ctx: this });
						return { width: String(text).length * parseFloat(this.font) / 2 };
					},
				};
			}
			getContext(type) {
				assert.equal(type, '2d');
				return this.ctx;
			}
		};
		await withSeededRandom(() => {
			demo = createDemo(root);
				u = demo.plot;
		});
		await Promise.resolve();
	});

	afterEach(() => {
		try {
			demo?.destroy();
			root?.remove();
		}
		finally {
			delete globalThis[measureHook];
			if (originalResizeObserver === undefined)
				delete globalThis.ResizeObserver;
			else
				globalThis.ResizeObserver = originalResizeObserver;
			observers = [];
			if (originalOffscreenCanvas === undefined)
				delete globalThis.OffscreenCanvas;
			else
				globalThis.OffscreenCanvas = originalOffscreenCanvas;
		}
	});

	const adjectives = new Set('Tiny Bright Quiet Swift Gentle Bold Silver Merry'.split(' '));
	const nouns = new Set('fox owl panda otter tiger robin badger raven'.split(' '));
	const verbs = new Set('runs jumps sings rests dances glides swims plays'.split(' '));
	const fullLabels = () => u.data[0];
	const labelWidth = label => String(label).length * parseFloat(u.axes[0].font[0]) / 2 / u.pxRatio;
	const longestWidth = () => Math.max(...u.axes[0]._values.map(labelWidth));

	const componentLabels = ['Value', 'Other value', 'Value 3', 'Value 4', 'Value 5'];
	const componentColors = ['royalblue', 'darkorange', 'seagreen', 'orchid', 'crimson'];

	function assertComponents(count, totals = false) {
		assert.equal(input('series-count').valueAsNumber, count);
		assert.equal(input('series-count-value').textContent, String(count));
		assert.equal(u.series.length, count + (totals ? 3 : 1));
		assert.equal(u.data.length, u.series.length);
		const components = u.series.slice(totals ? 3 : 1);
		assert.deepEqual(components.map(series => series.label), componentLabels.slice(0, count));
		assert.deepEqual(components.map(series => series.fill(u, 0)), componentColors.slice(0, count));
	}

	function assertDataShape(count = 2) {
		const [xs, ...columns] = u.data;
		assert.equal(columns.length, count);
		for (let i = 1; i < columns.length; i++) {
			assert.notEqual(columns[i - 1], columns[i]);
			assert.notDeepEqual(columns[i - 1], columns[i], 'independent random Y values');
		}
		assert.ok(xs.length >= 3 && xs.length <= 15, '3–15 items');
		assert.ok(xs.every(value => typeof value == 'string'), 'raw X values are label strings');

		const indices = Array.from({ length: xs.length }, (_, i) => i);
		assert.deepEqual(u._data[0], indices, 'contiguous internal X indices');
		for (const ys of columns) {
			assert.equal(ys.length, xs.length);
			assert.ok(ys.every(Number.isFinite));
			assert.ok(ys.every(y => y >= -1e7 && y < 3e7), 'Y values fit the magnitude, offset, and spread bounds');
			assert.ok(new Set(ys).size > 1, 'Y values have a nonzero spread');
		}
		for (const label of xs) {
			const words = label.split(' ');
			assert.ok(words.length >= 1 && words.length <= 3, `word count: ${label}`);
			assert.ok(nouns.has(words[words.length == 1 ? 0 : 1]), `noun: ${label}`);
			if (words.length > 1)
				assert.ok(adjectives.has(words[0]), `adjective: ${label}`);
			if (words.length == 3)
				assert.ok(verbs.has(words[2]), `verb: ${label}`);
		}
		assert.equal(u.scales.x.distr, 2);
		const { min, max } = u.scales.x;
		let firstCenter;
		distr(xs.length, input('group-width').valueAsNumber / 100, Number(input('distribution').value), 0, (_, off, size) => {
			firstCenter = off + size / 2;
		});
		assert.ok(Math.abs(-min / (max - min) - firstCenter) < 1e-12);
		assert.ok(Math.abs((xs.length - 1 - min) / (max - min) - (1 - firstCenter)) < 1e-12);
		assert.deepEqual(u.axes[0]._splits, indices, 'ticks follow the current X indices');
	}

	function assertReadout() {
		const longest = u.axes[0]._values.reduce((a, b) => labelWidth(b) > labelWidth(a) ? b : a);
		assert.ok(input('stats').textContent.startsWith(`Items: ${u.data[0].length} | Longest label: ${longest} (${labelWidth(longest).toFixed(1)}px) |`));
	}

	const rects = seriesIdx => u.series[seriesIdx]._paths.fill.log
		.filter(entry => entry[0] == 'rect').flatMap(entry => entry.slice(1));

	function valueTexts() {
		const log = u.ctx.log;
		const texts = log.slice(log.findLastIndex(entry => entry[0] == 'clearRect'))
			.filter(entry => entry[0] == 'fillText').flatMap(entry => entry.slice(1).map(args => String(args[0])));
		// Axis text shares the canvas log and is drawn before the bar values.
		for (const axis of u.axes) {
			for (const label of axis._values) {
				const index = texts.indexOf(String(label));
				if (index != -1)
					texts.splice(index, 1);
			}
		}
		return texts;
	}

	function assertValueTexts(enabled) {
		const texts = valueTexts();
		if (!enabled)
			assert.deepEqual(texts, [], 'only axis text is drawn when values are disabled');
		else if (stacking() == 'percent') {
			assert.equal(texts.length, 6, 'each visible segment has a value');
			assert.ok(texts.every(text => /^\d+(\.\d+)?%$/.test(text)), 'percent mode draws formatted shares');
		}
		else if (stacking() == 'value')
			assert.deepEqual(texts.sort(), ['13', '13', '13', '26', '26', '26', '39', '39', '39'], 'draws segment values and one accumulated total per category');
		else {
			assert.ok(texts.length > 0, 'draws values that fit the space beyond the bars');
			assert.ok(texts.every(text => text == '13' || text == '26'));
			for (const text of ['13', '26'])
				assert.ok(texts.filter(value => value == text).length <= 3);
		}
	}

	function assertBars() {
		for (let si = 1; si < u.series.length; si++) {
			if (!u.series[si].show)
				continue;
			const bars = rects(si);
			assert.equal(bars.length, u.data[0].length);
			for (const [x, y, width, height] of bars) {
				assert.ok([x, y, width, height].every(Number.isFinite));
				assert.ok(width >= 0 && height >= 0);
				assert.ok(u.scales.x.ori == 0 ? width > 0 : height > 0, 'category width stays positive; tiny values can round to zero');
				assert.ok(x >= u.bbox.left - 1 && x + width <= u.bbox.left + u.bbox.width + 1);
				assert.ok(y >= u.bbox.top - 1 && y + height <= u.bbox.top + u.bbox.height + 1);
			}
		}
	}

	function assertGroupGeometry() {
		const horizontal = u.scales.x.ori == 1;
		const pos = horizontal ? 1 : 0, size = horizontal ? 3 : 2;
		const origin = horizontal ? u.bbox.top : u.bbox.left;
		const span = horizontal ? u.bbox.height : u.bbox.width;
		const slots = stacking() == 'grouped' ? u.series.length - 1 : 1;
		const bars = u.series.slice(1).map((_, i) => rects(i + 1));
		distr(u.data[0].length, input('group-width').valueAsNumber / 100, Number(input('distribution').value), null, (i, off, width) => {
			for (let si = 0; si < bars.length; si++) {
				distr(slots, input('bar-width').valueAsNumber / 100, Number(input('bar-distribution').value), slots == 1 ? 0 : si, (_, barOff, barSize) => {
					const expectedPos = origin + (off + barOff * width) * span;
					assert.ok(Math.abs(bars[si][i][pos] - expectedPos) <= 1, `series ${si + 1}, group ${i}: distributed position`);
					assert.ok(Math.abs(bars[si][i][size] - barSize * width * span) <= 1, `series ${si + 1}, group ${i}: bar width`);
				});
			}
		});
		assertBars();
	}

	async function change(id, value, event) {
		input(id).value = String(value);
		input(id).dispatchEvent(new Event(event));
		await Promise.resolve();
	}

	async function selectCount(count) {
		await change('series-count', count, 'input');
		u = demo.plot;
	}

	async function toggle(id, checked) {
		if (!checked && (id == 'horizontal' || id == 'middle-ellipsis')) {
			id = id == 'horizontal' ? 'vertical' : 'end-ellipsis';
			checked = true;
		}
		input(id).checked = checked;
		input(id).dispatchEvent(new Event('change'));
		u = demo.plot;
		await Promise.resolve();
	}

	async function resize(width, height, observer = observers.at(-1)) {
		// Deliver even after disconnect to exercise the production callback's guard.
		observer.callback([{ target: input('plot'), contentRect: { width, height } }], observer);
		await Promise.resolve();
	}

	async function assertLegendMount() {
		await new Promise(requestAnimationFrame);
		const legend = input('chart-legend').querySelector('table.u-legend');
		assert.ok(legend, 'the native legend table is mounted outside the chart slot');
		assert.equal(legend.parentElement, input('chart-legend'));
		assert.equal(root.querySelectorAll('table.u-legend').length, 1, 'one live legend after rebuild');
		assert.equal(input('plot').querySelector('.u-legend'), null);
		assert.equal(legend.querySelectorAll('.u-series').length, u.series.length);
	}

	function hoverBar() {
		const [x, y, width, height] = rects(1)[1];
		u.over.dispatchEvent(new MouseEvent('mouseenter'));
		u.setCursor({
			left: (x + width / 2 - u.bbox.left) / u.pxRatio,
			top: (y + height / 2 - u.bbox.top) / u.pxRatio,
		});
	}

	function assertHoverMode(mode) {
		const group = mode == 'group';
		assert.deepEqual(u.cursor.idxs, [1, 1, group ? 1 : null]);
		assert.deepEqual(u.legend.values.map(value => value._), ['B', '13', group ? '26' : '--']);
		const band = u.under.querySelector('.u-bar-group-hover');
		if (group) {
			assert.ok(band, 'group highlight is behind the canvas in u.under');
			assert.notEqual(band.style.display, 'none');
			const dimension = u.scales.x.ori == 1 ? 'width' : 'height';
			assert.ok(band.style[dimension] == '100%' || Math.abs(parseFloat(band.style[dimension]) - u.bbox[dimension] / u.pxRatio) < .01,
				'group highlight spans the full numeric dimension');
			for (const si of [1, 2])
				assert.equal(u.cursor.points.bbox(u, si).width, 0, 'group mode has no cursor-point highlights');
		}
		else if (band)
			assert.equal(band.style.display, 'none');
	}

	function setYData(value) {
		u.setData([u.data[0], ...[1, 2].map(si => u.data[0].map((_, i) => value(i, si)))]);
	}

	function assertLabelSpacing(spacing, labels = fullLabels()) {
		const axis = u.axes[0];
		const stride = spacing === 0 ? 1 : Math.max(1, Math.ceil(axis._found[0]));
		const indices = labels.map((_, i) => i).filter(i => i % stride === 0);
		assert.deepEqual(axis._splits, indices, 'ticks honor the core-selected increment');
		assert.deepEqual(axis.ticks.filter(u, axis._splits, 0, axis._space, 1), indices);
		assert.deepEqual(axis._values, indices.map(i => labels[i]), 'unselected categories have no label entries');
		assert.deepEqual(axis._labelWidths, axis._values.map(labelWidth));
		assertReadout();
		assert.equal(input('label-spacing-value').textContent, `${spacing}px`);
	}

	function assertTruncated(labels, limit, middle) {
		assert.equal(u.axes[0]._values.length, labels.length);
		for (const [i, full] of labels.entries()) {
			const shown = u.axes[0]._values[i];
			if (full.length <= limit)
				assert.equal(shown, full, 'short labels stay unchanged');
			else {
				assert.equal(shown.length, limit);
				const parts = shown.split('…');
				assert.equal(parts.length, 2, 'one ellipsis');
				assert.ok(full.startsWith(parts[0]));
				assert.ok(full.endsWith(parts[1]));
				assert.equal(parts[1].length, middle ? Math.floor((limit - 1) / 2) : 0);
			}
		}
		assert.deepEqual(u.data[0], labels, 'raw X data retains every full label');

		assertReadout();
	}

	function labelExtents(width = longestWidth()) {
		const axis = u.axes[0];
		const radians = Math.abs(axis._rotate) * Math.PI / 180;
		const near = axis.font[1] / u.pxRatio / 2 * Math.sin(radians);
		const far = width * Math.cos(radians) + near;
		return axis._rotate == 0 ? { left: width / 2, right: width / 2 }
			: axis._rotate > 0 ? { left: far, right: near } : { left: near, right: far };
	}

	function assertPadding() {
		const { left, right } = labelExtents();
		for (const [side, extent] of [[3, left], [1, right]]) {
			const axisSpace = u.axes.reduce((space, axis) => space + (axis._show && axis.side == side
				? Math.max(0, axis._size + (axis.label != null ? axis.labelSize : 0)) : 0), 0);
			for (const [i, label] of u.axes[0]._values.entries()) {
				const center = u.valToPos(u.axes[0]._splits[i], 'x', true) / u.pxRatio;
				const available = side == 3 ? center : u.width - center;
				const bounds = labelExtents(labelWidth(label));
				assert.ok(available >= (side == 3 ? bounds.left : bounds.right) + 8 - .5 / u.pxRatio,
					`label ${i} clearance on side ${side}`);
			}
			assert.ok(u._padding[side] >= 8);
			assert.ok(u._padding[side] <= Math.max(8, Math.ceil(8 + extent - axisSpace)), 'bar inset never increases padding');
		}
	}

	function assertYAxis() {
		const axis = u.axes[1];
		const scale = u.scales.y;
		assert.equal(scale.axis, 1);
		assert.deepEqual([axis._splits[0], axis._splits.at(-1)], [scale.min, scale.max], 'Y tick endpoints match scale bounds');
		assert.ok(scale.min <= Math.min(0, ...u.data.slice(1).flat()));
		assert.ok(scale.max >= Math.max(0, ...u.data.slice(1).flat()));
		const labels = axis._values.filter(label => label != null);
		const width = Math.max(0, ...labels.map(label => String(label).length * parseFloat(axis.font[0]) / 2 / u.pxRatio));
		assert.equal(axis._size, Math.ceil(width + axis.ticks.size + axis.gap), 'Y size measures formatted labels');
		assert.deepEqual(measurements.y.slice(-labels.length), labels, 'Y measurements use formatted labels');
		assertPadding();
	}

	async function rotate(degrees) {
		input('rotation').value = String(degrees);
		input('rotation').dispatchEvent(new Event('input'));
		await Promise.resolve();
		assert.equal(u.axes[0]._rotate, degrees);
		assert.equal(input('rotation-value').textContent, `${degrees}°`);
	}

	it('groups controls into labeled sections with separate label and control columns', () => {
		const groups = [
			['Geometry', ['stacking-off', 'stacking-normal', 'stacking-percent', 'vertical', 'horizontal', 'distribution', 'group-width', 'bar-distribution', 'bar-width']],
			['Axis labels', ['rotation', 'label-spacing', 'max-length', 'end-ellipsis', 'middle-ellipsis']],
			['Rendering', ['show-values', 'show-totals', 'hover-bar', 'hover-group']],
			['Data', ['series-count', 'randomize', 'copy-link']],
		];
		const sections = root.querySelectorAll('.controls fieldset');
		assert.equal(sections.length, groups.length);
		groups.forEach(([name, ids], i) => {
			assert.equal(sections[i].querySelector('legend').textContent, name);
			for (const id of ids) {
				const control = input(id);
				assert.equal(control.closest('fieldset'), sections[i]);
				const row = control.closest('.control-row');
				assert.equal(row.children.length, 2);
				assert.ok(row.firstElementChild.textContent.trim());
				assert.ok(row.lastElementChild.contains(control));
				if (control.tagName != 'BUTTON')
					assert.ok(control.labels.length > 0, `${id} keeps its accessible label`);
			}
		});
		for (const [distribution, width, name] of [
			['distribution', 'group-width', 'Group'],
			['bar-distribution', 'bar-width', 'Bar'],
		]) {
			const row = input(distribution).closest('.control-row');
			assert.equal(input(width).closest('.control-row'), row);
			assert.equal(row.firstElementChild.textContent, `${name} layout/width`);
			assert.equal(input(width).getAttribute('aria-label'), `${name} width`);
		}
		assert.equal(input('max-length').getAttribute('aria-describedby'), null);
		assert.equal(input('label-spacing').labels[0].textContent, 'Min spacing');
				assert.equal(input('max-length').labels[0].textContent, 'Max chars');
				assert.equal(input('rotation').labels[0].textContent, 'Rotation');
		assert.equal(input('label-spacing-value').getAttribute('for'), 'label-spacing');
		assert.equal(input('label-spacing-value').parentElement, input('label-spacing').parentElement);
		assert.equal(input('series-count').labels[0].textContent, 'Series');
		assert.equal(input('series-count').type, 'range');
		assert.deepEqual(['min', 'max', 'step', 'value'].map(attr => input('series-count').getAttribute(attr)), ['1', '5', '1', '2']);
		assert.equal(input('series-count').defaultValue, '2');
		assert.equal(input('series-count').disabled, false);
		assert.equal(input('series-count-value').tagName, 'OUTPUT');
		assert.equal(input('series-count-value').getAttribute('for'), 'series-count');
		assert.equal(input('series-count-value').parentElement, input('series-count').parentElement);
		assertComponents(2);
	});

	it('uses labeled orientation and ellipsis radios with truncation off by default', async () => {
		for (const [group, label, choices] of [
			['orientation', 'Bars orientation', [['vertical', 'vertical'], ['horizontal', 'horizontal']]],
			['ellipsis', 'Ellipsis', [['end-ellipsis', 'end'], ['middle-ellipsis', 'middle']]],
		]) {
			assert.equal(input(group).getAttribute('role'), 'radiogroup');
			assert.equal(input(group).getAttribute('aria-labelledby'), `${group}-label`);
			assert.equal(input(`${group}-label`).textContent.trim(), label);
			assert.equal(input(group).querySelectorAll('input').length, choices.length);
			for (const [i, [id, value]] of choices.entries()) {
				assert.ok(input(group).contains(input(id)));
				assert.equal(input(id).type, 'radio');
				assert.equal(input(id).name, group);
				assert.equal(input(id).value, value);
				assert.equal(input(id).defaultChecked, i == 0);
				assert.equal(input(id).checked, i == 0);
				assert.equal(input(id).disabled, false);
			}
			for (const [selected] of [choices[1], choices[0]]) {
				await toggle(selected, true);
				for (const [id] of choices)
					assert.equal(input(id).checked, id == selected, `${group} choices are mutually exclusive`);
			}
		}
		assert.equal(input('max-length').type, 'range');
		assert.deepEqual(['min', 'max', 'step', 'value'].map(attr => input('max-length').getAttribute(attr)), ['0', '20', '1', '0']);
		assert.equal(input('max-length').valueAsNumber, 0);
		assert.equal(input('max-length').disabled, false);
		assert.equal(input('max-length-value').textContent, 'Off');
		assert.deepEqual(u.axes[0]._values, fullLabels());
	});

	it('keeps the native legend in a separate row of the resizable chart', async () => {
		assert.deepEqual(Array.from(input('chart-resize').children, el => el.id), ['plot', 'chart-legend']);
		await assertLegendMount();
		assert.equal(observers.length, 1);
		assert.equal(observers[0].target, input('plot'), 'observe the chart slot, not the wrapper or legend');
		assert.equal(observers[0].observeCount, 1);
		assert.equal(observers[0].disconnectCount, 0);
	});

	it('floors observed CSS sizes and ignores nonpositive, nonfinite, and unchanged dimensions', async () => {
		u.setPxRatio(2);
		await Promise.resolve();
		const calls = [];
		const setSize = u.setSize;
		u.setSize = size => { calls.push(size); return setSize(size); };
		await resize(u.width, u.height);
		assert.deepEqual(calls, [], 'the first notification at the current size does nothing');
		for (const [width, height] of [
			[0, 600], [800, 0], [0, 0], [-1, 600], [800, -1], [.9, 600], [800, .9],
			[NaN, 600], [800, NaN], [Infinity, 600], [800, Infinity], [-Infinity, 600], [800, -Infinity],
		])
			await resize(width, height);
		assert.deepEqual(calls, [], 'invalid sizes never reach setSize');
		assert.deepEqual([u.width, u.height], [1200, 500]);
		await resize(800.9, 600.8);
		assert.deepEqual(calls, [{ width: 800, height: 600 }], 'floor CSS dimensions without multiplying by DPR');
		assert.deepEqual([u.width, u.height], [800, 600]);
		await resize(800, 600);
		await resize(800.1, 600.2);
		await resize(0, 0);
		await resize(800.9, 600.8);
		assert.equal(calls.length, 1, 'duplicates remain ignored after a zero-size notification');
		await resize(801.2, 600.9);
		await resize(801.9, 601.2);
		assert.deepEqual(calls.slice(1), [{ width: 801, height: 600 }, { width: 801, height: 601 }], 'either dimension can change independently');
	});

	it('reads initial chart-slot dimensions in either orientation and falls back when not laid out', async () => {
		const data = structuredClone(u.data);
		for (const horizontal of [false, true]) {
			for (const [width, height, expected] of [[936, 412, [936, 412]], [0, 0, [1200, 500]]]) {
				const previousObserver = observers.at(-1);
				demo.destroy();
				assert.equal(previousObserver.disconnectCount, 1);
				input(horizontal ? 'horizontal' : 'vertical').checked = true;
				Object.defineProperties(input('plot'), {
					clientWidth: { configurable: true, value: width },
					clientHeight: { configurable: true, value: height },
				});
				await withSeededRandom(() => {
					demo = createDemo(root);
					u = demo.plot;
				});
				await Promise.resolve();
				assert.deepEqual([u.width, u.height], expected);
				assert.equal(u.scales.x.ori, horizontal ? 1 : 0);
				assert.deepEqual(u.data, data);
				assert.equal(observers.at(-1).target, input('plot'));
				assert.equal(observers.at(-1).observeCount, 1);
				await resize(777, 333, previousObserver);
				assert.deepEqual([u.width, u.height], expected, 'a destroyed controller cannot resize a new demo on the same root');
			}
		}
	});

	it('resizes only the current plot after orientation, stacking, and totals rebuilds', async () => {
		const observer = observers[0];
		for (const [id, checked] of [
			['horizontal', true], ['stacking-normal', true], ['stacking-percent', true],
			['stacking-off', true], ['show-totals', true], ['horizontal', false], ['show-totals', false],
		]) {
			const previous = u;
			const dimensions = [u.width, u.height];
			await toggle(id, checked);
			assert.notEqual(u, previous);
			assert.deepEqual([u.width, u.height], dimensions);
			assert.equal(observers.length, 1, 'rebuilds reuse the controller observer');
			assert.equal(observer.observeCount, 1);
			assert.equal(observer.disconnectCount, 0);
			previous.setSize = () => assert.fail('observer must not resize a replaced plot');
			const current = u;
			const setSize = u.setSize;
			let sizes = 0;
			u.setSize = size => { sizes++; return setSize(size); };
			await resize(...dimensions);
			assert.equal(sizes, 0, 'a same-size rebuild does not require an observer resize');
			await resize(dimensions[0] - 13.2, dimensions[1] + 7.9);
			assert.equal(demo.plot, current);
			assert.equal(sizes, 1);
			assert.deepEqual([u.width, u.height], [dimensions[0] - 14, dimensions[1] + 7]);
			await assertLegendMount();
		}
	});

	it('requests a data-reset rebuild at the current dimensions on each Series input', async () => {
		demo.destroy();
		const plot = { width: 913, height: 417 };
		const calls = [];
		const controls = createBarControls(root, {
			getPlot: () => plot,
			getControls: () => assert.fail('Series input must rebuild, not update rendering controls'),
			rebuild: (...args) => calls.push(args),
			regenerate: () => assert.fail('Series input must not choose a new seed'),
		});
		try {
			await change('series-count', 5, 'input');
			assert.deepEqual(calls, [[{ width: 913, height: 417 }, true]]);
			assert.equal(input('series-count-value').textContent, '5');
			plot.width = 721;
			plot.height = 389;
			await change('series-count', 1, 'input');
			assert.deepEqual(calls[1], [{ width: 721, height: 389 }, true]);
			assert.equal(calls.length, 2);
			assert.equal(input('series-count-value').textContent, '1');
		}
		finally {
			controls.destroy();
		}
	});

	it('regenerates counts 1–5 from the same seed and preserves every existing column prefix', async () => {
		const initial = structuredClone(u.data);
		await selectCount(5);
		const generated = structuredClone(u.data);
		assert.deepEqual(generated.slice(0, 3), initial, 'the original categories and first two components do not change');
		u.setPxRatio(2);
		await resize(923, 431);
		for (const count of [1, 2, 3, 4, 5, 2]) {
			const previous = u;
			const dimensions = [u.width, u.height, u.pxRatio];
			let destroyed = 0;
			previous.hooks.destroy.push(() => destroyed++);
			await selectCount(count);
			assert.notEqual(u, previous);
			assert.equal(destroyed, 1, 'one rebuild per input event');
			assert.equal(previous.root.isConnected, false);
			assert.equal(input('plot').querySelectorAll('.uplot').length, 1);
			assert.deepEqual([u.width, u.height, u.pxRatio], dimensions);
			assertComponents(count);
			assertDataShape(count);
			assert.deepEqual(u.data, generated.slice(0, count + 1), 'count changes discard custom data and restart the same seeded generator');
			assertGroupGeometry();
			const current = u, data = u.data;
			const original = structuredClone(data);
			previous.setSize = () => assert.fail('resize must not target a replaced plot');
			await resize(u.width - 7, u.height + 3);
			assert.equal(demo.plot, current);
			assert.equal(u.data, data);
			assert.deepEqual(data, original);
			assertComponents(count);
			assert.equal(observers.length, 1);
			assert.equal(observers[0].observeCount, 1);
			const custom = [['Custom A', 'Custom B', 'Custom C'], ...Array.from({ length: count }, (_, i) => [i + 1, i + 2, i + 3])];
			u.setData(custom);
			await Promise.resolve();
			assert.equal(u.data, custom, 'setData still accepts the chosen number of columns');
		}
		await selectCount(5);
		assert.deepEqual(u.data, generated, 'shrinking and growing recover even the previously removed components');
		await assertLegendMount();
	});

	it('preserves dynamic components through orientation, native stacks, totals, and visibility changes', async () => {
		await resize(947, 463);
		for (const count of [1, 3, 5]) {
			await selectCount(count);
			const raw = [['Positive', 'Negative', 'Mixed'], ...Array.from({ length: count }, (_, i) => [i + 1, -2 * (i + 1), (i % 2 ? -1 : 1) * (i + 1)])];
			const original = structuredClone(raw);
			u.setData(raw);
			await Promise.resolve();
			assert.equal(u.data, raw);
			await toggle('horizontal', !input('horizontal').checked);
			assert.equal(u.data, raw);
			assertComponents(count);
			assertGroupGeometry();
			await toggle('show-totals', true);
			assertTotals(raw);
			assert.deepEqual([u.width, u.height], [947, 463]);
			const prepared = withBarTotals(raw);
			u.setData(prepared);
			await Promise.resolve();
			assert.equal(u.data, prepared, 'caller-supplied totals and all chosen components remain valid');
			const visible = Array(count + 1).fill(true);
			visible[count] = false;
			u.setSeries(count + 2, { show: false });
			assertTotals(raw, visible);
			await Promise.resolve();
			await toggle('horizontal', !input('horizontal').checked);
			assertTotals(raw, visible);
			assert.equal(u.series[count + 2].show, false);

			function assertStack(mode) {
				assertComponents(count);
				assert.deepEqual(u.data, original, 'native stacking leaves every raw column unchanged');
				assert.equal(input('show-totals').checked, true);
				assert.equal(input('show-totals').disabled, true);
				assert.deepEqual([u.width, u.height], [947, 463]);
				for (let di = 0; di < raw[0].length; di++) {
					const sums = [0, 0], accumulated = [0, 0];
					for (let si = 1; si <= count; si++) {
						if (visible[si])
							sums[raw[si][di] < 0 ? 1 : 0] += Math.abs(raw[si][di]);
					}
					for (let si = 1; si <= count; si++) {
						assert.equal(u.series[si].show, visible[si]);
						if (!visible[si])
							continue;
						const sign = raw[si][di] < 0 ? 1 : 0;
						const divisor = mode == 'percent' ? sums[sign] : 1;
						assert.ok(Math.abs(u._base[si][di] - accumulated[sign] / divisor) < 1e-12, `component ${si} shares the native stack baseline`);
						accumulated[sign] += raw[si][di];
						assert.ok(Math.abs(u._data[si][di] - accumulated[sign] / divisor) < 1e-12, `component ${si} enters the native ${mode} stack`);
					}
				}
			}

			for (const mode of ['value', 'percent']) {
				await selectStacking(mode);
				assertStack(mode);
				visible[count] = true;
				u.setSeries(count, { show: true });
				await Promise.resolve();
				assertStack(mode);
				assertGroupGeometry();
				visible[count] = false;
				u.setSeries(count, { show: false });
				await Promise.resolve();
				assertStack(mode);
			}
			await selectStacking('grouped');
			assertTotals(raw, visible);
			assert.equal(u.series[count + 2].show, false);
			u.setSeries(count + 2, { show: true });
			await Promise.resolve();
			assertTotals(raw);
			await toggle('show-totals', false);
			assertComponents(count);
			assert.deepEqual(u.data, original);
			assert.deepEqual(raw, original);
		}
	});

	it('changes count with totals enabled or stacked without counting totals as components', async () => {
		await selectCount(5);
		const generated = structuredClone(u.data);
		function assertGeneratedTotals(count) {
			const raw = [u.data[0], ...u.data.slice(3)];
			assert.deepEqual(raw, generated.slice(0, count + 1));
			assertTotals(raw);
		}
		await toggle('show-totals', true);
		await selectCount(1);
		assertGeneratedTotals(1);
		await selectCount(5);
		assertGeneratedTotals(5);
		assert.equal(u.series.length, 8, 'five components plus category and two totals');
		await selectStacking('percent');
		await selectCount(3);
		assertComponents(3);
		assert.deepEqual(u.data, generated.slice(0, 4));
		assert.equal(input('show-totals').checked, true);
		assert.equal(input('show-totals').disabled, true);
		await selectStacking('grouped');
		assertGeneratedTotals(3);
		const current = u;
		input('randomize').click();
		await Promise.resolve();
		assert.equal(demo.plot, current);
		assert.notDeepEqual(u.data[0], generated[0]);
		assertTotals([u.data[0], ...u.data.slice(3)]);
	});

	it('reads an initial form count and ignores series queries outside the single-digit 1–5 contract', async () => {
		const originalUrl = window.location.href;
		try {
			for (const series of [null, '', '0', '6', '01', '1.0', '-1', '3x', ' 3']) {
				demo.destroy();
				const url = new URL('http://localhost/demos/axis-label-rotation.html?seed=initial-count');
				if (series != null)
					url.searchParams.set('series', series);
				window.happyDOM.setURL(url.href);
				input('series-count').value = '4';
				input('series-count-value').textContent = 'stale';
				demo = createDemo(root);
				u = demo.plot;
				await Promise.resolve();
				assertComponents(4);
				assertDataShape(4);
			}
		}
		finally {
			window.happyDOM.setURL(originalUrl);
		}
	});

	it('shows reproducible random data and keeps it unchanged while rotating or copying its URL', async () => {
		assertDataShape();
		const labels = fullLabels();
		const data = u.data;
		assert.deepEqual(u.axes[0]._values, labels);
		assert.equal(input('randomize').textContent, 'Randomize data');

		for (const degrees of [-90, -45, 0, 45, 90]) {
			await rotate(degrees);
			assert.equal(u.data, data);
			assert.deepEqual(u.axes[0]._values, labels);
			assert.deepEqual(fullLabels(), labels);
			assert.equal(measurements.x.length, labels.length);
			assertReadout();
		}

		const originalUrl = window.location.href;
		const clipboard = window.navigator.clipboard;
		const writeText = clipboard.writeText;
		const prompt = window.prompt;
		let copiedUrl, fallbackUrl;
		clipboard.writeText = async url => { copiedUrl = url; };
		window.prompt = (message, url) => { fallbackUrl = url; };
		try {
			window.happyDOM.setURL('http://localhost/demos/axis-label-rotation.html?other=keep&series=5#plot');
			const status = input('copy-status').firstChild;
			const copy = async () => {
				input('copy-link').click();
				await Promise.resolve();
				return copiedUrl;
			};
			const initialUrl = await copy();
			assert.equal(input('copy-status').firstChild, status);
			assert.equal(status.data, 'Link copied.');
			assert.equal(u.data, data, 'copy does not regenerate data');
			assert.equal(new URL(initialUrl).searchParams.get('other'), 'keep');
			assert.equal(new URL(initialUrl).hash, '#plot');
			assert.notEqual(new URL(initialUrl).searchParams.get('seed'), null);
			assert.equal(new URL(initialUrl).searchParams.has('series'), false, 'default count removes a stale series query');

			const load = async url => {
				demo.destroy();

				window.happyDOM.setURL(url);
				const series = new URL(url).searchParams.get('series');
				const count = Number(series ?? 2);
				input('series-count').value = series == null ? '2' : String(count == 1 ? 5 : 1);
				input('series-count-value').textContent = 'stale';
				demo = createDemo(root);
				u = demo.plot;
				await Promise.resolve();
				assertComponents(count);
			};
			await load(initialUrl);
			assert.deepEqual(u.data, data, 'initial data replays from its copied URL');
			await selectCount(5);
			const beforeRandomize = u.data;
			const current = u;
			input('randomize').click();
			await Promise.resolve();
			assert.equal(demo.plot, current, 'randomize keeps the chosen-count plot');
			assertComponents(5);
			assertDataShape(5);
			for (let si = 0; si < u.data.length; si++) {
				assert.notEqual(u.data[si], beforeRandomize[si]);
				assert.notDeepEqual(u.data[si], beforeRandomize[si], `randomize regenerates column ${si}`);
			}
			const randomized = structuredClone(u.data);
			const randomizedUrl = await copy();
			assert.equal(new URL(randomizedUrl).searchParams.get('series'), '5');
			assert.notEqual(randomizedUrl, initialUrl);
			assert.notDeepEqual(randomized, data);
			await toggle('horizontal', true);
			await selectStacking('value');
			assert.equal(await copy(), randomizedUrl, 'rebuilds preserve the seed');
			await load(randomizedUrl);
			assert.deepEqual(u.data, randomized, 'randomized labels and all five value series replay exactly');
			for (const count of [1, 3, 4, 2, 5]) {
				await selectCount(count);
				assert.deepEqual(u.data, randomized.slice(0, count + 1));
				const shared = await copy();
				const url = new URL(shared);
				assert.equal(url.searchParams.get('series'), count == 2 ? null : String(count));
				assert.equal(url.searchParams.get('seed'), new URL(randomizedUrl).searchParams.get('seed'), 'count changes keep the randomized seed');
				assert.equal(url.searchParams.get('other'), 'keep');
				assert.equal(url.hash, '#plot');
				await load(shared);
				assert.deepEqual(u.data, randomized.slice(0, count + 1), `count ${count} roundtrips every column and overrides the prepopulated form`);
			}

			const explicitDefault = new URL(randomizedUrl);
			explicitDefault.searchParams.set('series', '2');
			await load(explicitDefault.href);
			assert.deepEqual(u.data, randomized.slice(0, 3), 'an explicit series=2 also overrides the form before initialization');
			assert.equal(new URL(await copy()).searchParams.has('series'), false);

			for (const seed of ['', '0', 'fox & owl/🦊']) {
				const url = new URL(randomizedUrl);
				url.searchParams.set('seed', seed);
				await load(url.href);
				const expected = structuredClone(u.data);
				const shared = await copy();
				assert.equal(new URL(shared).searchParams.get('seed'), seed);
				await load(shared);
				assert.deepEqual(u.data, expected);
			}

			let resolveCopy;
			clipboard.writeText = () => new Promise(resolve => { resolveCopy = resolve; });
			input('copy-link').click();
			await selectCount(1);
			assert.equal(input('copy-status').textContent, '', 'count changes clear the previous copy status');
			resolveCopy();
			await Promise.resolve();
			assert.equal(input('copy-status').textContent, '', 'an old count copy cannot report success after the count changes');
			clipboard.writeText = async url => { copiedUrl = url; };
			await copy();
			assert.equal(input('copy-status').textContent, 'Link copied.', 'a new copy can report success for the current count');
			assert.equal(new URL(copiedUrl).searchParams.get('series'), '1');

			clipboard.writeText = async () => { throw new Error('Permission denied'); };
			await copy();
			assert.equal(fallbackUrl, copiedUrl);
			assert.match(input('copy-status').textContent, /Clipboard unavailable/);
			fallbackUrl = null;
			clipboard.writeText = undefined;
			await copy();
			assert.equal(fallbackUrl, copiedUrl, 'missing clipboard API offers manual copy');

			let reject;
			clipboard.writeText = () => new Promise((resolve, fail) => { reject = fail; });
			input('copy-link').click();
			demo.destroy();
			fallbackUrl = null;
			reject(new Error('Permission denied'));
			await Promise.resolve();
			assert.equal(fallbackUrl, null, 'pending clipboard work does nothing after destroy');
		}
		finally {
			clipboard.writeText = writeText;
			window.prompt = prompt;
			window.happyDOM.setURL(originalUrl);
		}
	});

	it('reserves the rotated label bounds at DPR 1 and 2', async () => {
		for (const ratio of [1, 2]) {
			u.setPxRatio(ratio);
			await Promise.resolve();
			for (const degrees of [-90, -45, -1, 0, 1, 45, 90]) {
				await rotate(degrees);
				const axis = u.axes[0];
				const radians = -degrees * Math.PI / 180;
				const cos = Math.cos(radians);
				const sin = Math.sin(radians);
				const width = longestWidth();
				const height = axis.font[1] / ratio;
				const x0 = degrees > 0 ? -width : degrees < 0 ? 0 : -width / 2;
				const y0 = degrees == 0 ? 0 : -height / 2;
				const corners = [x0, x0 + width].flatMap(x => [y0, y0 + height].map(y => [x * cos - y * sin, x * sin + y * cos]));
				const maxY = Math.max(...corners.map(p => p[1]));
				assertPadding();
				assert.ok(axis._size >= axis.ticks.size + axis.gap + maxY - 1e-9);
				assert.ok(u.bbox.height / ratio > 300);
				if (degrees == 0) {
					assert.equal(axis._size, axis.ticks.size + axis.gap + height);
				}
			}
		}
	});

	it('credits only visible axis space without feedback or new measurements', async () => {
		await rotate(33);
		// Make the first label's overhang exceed its distributed group inset.
		u.setSize({ width: Math.ceil(u.data[0].length * labelExtents(labelWidth(u.axes[0]._values[0])).left), height: u.height });
		await Promise.resolve();
		const withAxis = u._padding[3];
		assertPadding();
		u.redraw(false, true);
		await Promise.resolve();
		assert.equal(u._padding[3], withAxis);

		u.axes[1].show = false;
		u.redraw(false, true);
		await Promise.resolve();
		assertPadding();
		assert.ok(u._padding[3] > withAxis);
		u.axes[1].show = true;
		u.redraw(false, true);
		await Promise.resolve();
		assert.equal(u._padding[3], withAxis);
		assertPadding();
		assert.equal(measurements.x.length, u.data[0].length);
	});

	it('uses individual label positions instead of reserving the longest label at both edges', async () => {
		const reducedSides = new Set();
		await withSeededRandom(async () => {
			for (let sample = 0; sample < 32; sample++) {
				input('randomize').click();
				await Promise.resolve();
				const measured = measurements.x.length;
				for (const width of [400, 1200]) {
					u.setSize({ width, height: 500 });
					await Promise.resolve();
					for (const degrees of [-10, 9]) {
						await rotate(degrees);
						assertPadding();
						const { left, right } = labelExtents();
						const axisWidth = u.axes[1]._size;
						const minWidth = Math.max(0, width - axisWidth - Math.max(8, Math.ceil(8 + left - axisWidth)) - Math.max(8, Math.ceil(8 + right)));
						const edgeSpace = minWidth * -u.scales.x.min / (u.scales.x.max - u.scales.x.min);
						for (const [side, extent, space] of [[3, left, axisWidth], [1, right, 0]]) {
							const previousPad = Math.max(8, Math.ceil(8 + extent - space - edgeSpace));
							assert.ok(u._padding[side] <= previousPad);
							if (previousPad - u._padding[side] >= 10)
								reducedSides.add(side);
						}
						const before = u._padding.slice();
						u.redraw(false, true);
						await Promise.resolve();
						assert.deepEqual(u._padding, before);
					}
				}
				assert.equal(measurements.x.length, measured, 'rotation and resize reuse individual widths');
			}
		});
		assert.deepEqual([...reducedSides].sort(), [1, 3]);
	});

	it('credits the distributed group inset without width feedback', async () => {
		setYData((i, si) => 10 + i * 17 * si);
		// Leave enough group-center space to absorb the longest label's overhang.
		const firstCenter = -u.scales.x.min / (u.scales.x.max - u.scales.x.min);
		u.setSize({ width: Math.ceil((longestWidth() + 20) / firstCenter + u.axes[1]._size), height: 500 });
		for (const degrees of [0, 50]) {
			await rotate(degrees);
			assert.equal(u._padding[3], 8);
			assert.equal(u._padding[1], 8);
		}

		for (const width of [400, 800, 1200]) {
			u.setSize({ width, height: 500 });
			await Promise.resolve();
			for (const degrees of [-50, -1, 0, 1, 50]) {
				await rotate(degrees);
				assertPadding();
				const before = u._padding.slice();
				u.redraw(false, true);
				await Promise.resolve();
				assert.deepEqual(u._padding, before);
			}
		}
		assert.equal(measurements.x.length, u.data[0].length);
	});

	it('resizes the chart slot without replacing the plot, data, or label measurements', async () => {
		const data = u.data;
		const width = u.width;
		const counts = new Set();
		const current = u;
		assert.equal(u.height, 500);
		for (const degrees of [0, 90, -90]) {
			await rotate(degrees);
			for (const height of [200, 500, 900]) {
				await resize(width, height);
				assert.equal(demo.plot, current);
				assert.equal(u.height, height);
				assert.equal(u.width, width);
				assert.equal(u.data, data);
				assert.equal(u.axes[0]._rotate, degrees);
				assert.ok(u.bbox.height > 0);
				assertYAxis();
				counts.add(u.axes[1]._splits.length);
			}
		}
		assert.ok(counts.size > 1, 'height changes the Y tick count');
		assert.equal(measurements.x.length, u.data[0].length);
	});

	it('changes group and bar distribution and width live without replacing the chart or data', async () => {
		assert.deepEqual(Array.from(input('distribution').options, option => [option.value, option.textContent]), [
			['1', 'Space between'], ['2', 'Space around'], ['3', 'Space evenly'],
		]);
		assert.equal(input('distribution').value, '2');
		assert.deepEqual(['min', 'max', 'step', 'value'].map(attr => input('group-width').getAttribute(attr)), ['1', '100', '1', '60']);
		assert.equal(input('group-width-value').textContent, '60%');
		assert.deepEqual(Array.from(input('bar-distribution').options, option => [option.value, option.textContent]), [
			['1', 'Space between'], ['2', 'Space around'], ['3', 'Space evenly'],
		]);
		assert.equal(input('bar-distribution').value, '2');
		assert.deepEqual(['min', 'max', 'step', 'value'].map(attr => input('bar-width').getAttribute(attr)), ['1', '100', '1', '100']);
		assert.equal(input('bar-width-value').textContent, '100%');
		assertGroupGeometry();
		const data = u.data;
		const original = structuredClone(data);

		for (const horizontal of [false, true]) {
			if (horizontal)
				await toggle('horizontal', true);
			for (const mode of ['grouped', 'value', 'percent']) {
				await selectStacking(mode);
				const current = u;
				const measured = measurements.x.length;
				const dimensions = [u.width, u.height];
				for (const [id, value, event] of [
					['distribution', 1, 'change'], ['distribution', 3, 'change'], ['distribution', 2, 'change'],
					['group-width', 25, 'input'], ['group-width', 80, 'input'], ['group-width', 100, 'input'], ['group-width', 60, 'input'],
					['bar-width', 50, 'input'], ['bar-distribution', 1, 'change'], ['bar-distribution', 3, 'change'],
					['bar-distribution', 2, 'change'], ['bar-width', 100, 'input'],
				]) {
					const before = [rects(1), rects(2)];
					await change(id, value, event);
					assert.equal(demo.plot, current, `${id} does not rebuild`);
					assert.equal(current.root.isConnected, true);
					assert.equal(u.data, data);
					assert.deepEqual(data, original, 'controls never mutate the data');
					assert.deepEqual([u.width, u.height], dimensions);
					if (id != 'bar-distribution')
						assert.notDeepEqual([rects(1), rects(2)], before, `${id} changes rendered geometry`);
					assert.equal(input('group-width-value').textContent, `${input('group-width').value}%`);
					assert.equal(input('bar-width-value').textContent, `${input('bar-width').value}%`);
					assert.equal(measurements.x.length, measured, 'geometry changes reuse label measurements');
					assertDataShape();
					assertGroupGeometry();
					assertReadout();
					if (!horizontal)
						assertPadding();
				}
			}
			await selectStacking('grouped');
		}
	});

	it('defaults minimum label spacing to zero and shows every label', () => {
		assert.equal(input('label-spacing').type, 'range');
		assert.deepEqual(['min', 'max', 'step', 'value'].map(attr => input('label-spacing').getAttribute(attr)), ['0', '300', '5', '0']);
		assert.equal(input('label-spacing').valueAsNumber, 0);
		assertLabelSpacing(0);
	});

	it('changes minimum label spacing live and sizes selected labels without replacing the plot or data', async () => {
		u.setData([
			['First label', 'The longest label needs space only when selected', 'C', 'D', 'E', 'F', 'G', 'Last label'],
			[13, 14, 15, 16, 17, 18, 19, 20],
			[26, 27, 28, 29, 30, 31, 32, 33],
		]);
		await Promise.resolve();
		const data = u.data;
		const original = structuredClone(data);
		const layout = () => structuredClone({
			size: [u.width, u.height],
			xRange: [u.scales.x.min, u.scales.x.max],
			internalData: u._data,
		});
		for (const horizontal of [false, true]) {
			await toggle('horizontal', horizontal);
			for (const mode of ['grouped', 'value', 'percent']) {
				await selectStacking(mode);
				for (const ratio of [1, 2]) {
					u.setPxRatio(ratio);
					await Promise.resolve();
					const current = u;
					const before = layout();
					for (const spacing of [150, 300, 5, 0]) {
						await change('label-spacing', spacing, 'input');
						assert.equal(demo.plot, current, 'spacing does not rebuild');
						assert.equal(current.root.isConnected, true);
						assert.equal(u.data, data);
						assert.deepEqual(u.data, original);
						assert.deepEqual(layout(), before, 'spacing preserves chart size, category range, and data');
						assertLabelSpacing(spacing);
						if (spacing == 300) {
							assert.ok(!u.axes[0]._splits.includes(1), 'exercise an unselected longest label');
							assert.ok(!u.axes[0]._values.includes(data[0][1]));
						}
						const measured = measurements.x.length;
						u.redraw(false, true);
						await Promise.resolve();
						assert.equal(measurements.x.length, measured, 'unchanged selection reuses core widths');
					}
				}
			}
		}
	});

	it('preserves minimum label spacing through orientation, stacking, and totals rebuilds', async () => {
		u.setData([
			['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
			[13, 14, 15, 16, 17, 18, 19, 20],
			[26, 27, 28, 29, 30, 31, 32, 33],
		]);
		await Promise.resolve();
		const data = u.data;
		const original = structuredClone(data);
		for (const spacing of [300, 0]) {
			await change('label-spacing', spacing, 'input');
			for (const [id, checked] of [
				['show-totals', true], ['horizontal', true], ['stacking-normal', true], ['stacking-percent', true],
				['stacking-off', true], ['horizontal', false], ['show-totals', false],
			]) {
				const previous = u;
				await toggle(id, checked);
				assert.notEqual(u, previous);
				assert.equal(previous.root.isConnected, false);
				assert.equal(root.querySelectorAll('#plot .uplot').length, 1);
				const totals = stacking() == 'grouped' && input('show-totals').checked;
				assert.equal(u.data.length, totals ? 5 : 3);
				assert.equal(u.data[0], data[0]);
				assert.deepEqual(u.data.slice(totals ? 3 : 1), data.slice(1));
				assert.deepEqual(data, original);
				assert.equal(input('label-spacing').valueAsNumber, spacing);
				assertLabelSpacing(spacing);
			}
		}
	});

	it('initializes minimum label spacing and its readout from a prepopulated form', async () => {
		const original = structuredClone(u.data);
		demo.destroy();
		input('horizontal').checked = true;
		input('label-spacing').value = '300';
		input('label-spacing-value').textContent = 'stale';
		await withSeededRandom(() => {
			demo = createDemo(root);
			u = demo.plot;
		});
		await Promise.resolve();
		assert.deepEqual(u.data, original);
		assert.equal(input('label-spacing').valueAsNumber, 300);
		assertLabelSpacing(300);
		assert.ok(u.axes[0]._values.length < u.data[0].length, 'initial options select fewer ticks without an input event');
		await change('label-spacing', 0, 'input');
		assertLabelSpacing(0);
	});

	it('toggles value drawing live without replacing the chart or data', async () => {
		assert.equal(input('show-values').type, 'checkbox');
		assert.equal(input('show-values').checked, false);
		assert.equal(input('show-values').defaultChecked, false);
		u.setData([['A', 'B', 'C'], [13, 13, 13], [26, 26, 26]]);
		await Promise.resolve();
		const data = u.data;
		const original = structuredClone(data);
		assertValueTexts(false);

		for (const horizontal of [false, true]) {
			await toggle('horizontal', horizontal);
			for (const mode of ['grouped', 'value', 'percent']) {
				await selectStacking(mode);
				const current = u;
				const dimensions = [u.width, u.height];
				const geometry = [rects(1), rects(2)];
				for (const enabled of [true, false, true, false]) {
					const before = u.ctx.log.length;
					await toggle('show-values', enabled);
					assert.equal(u, current, 'show values does not rebuild');
					assert.equal(current.root.isConnected, true);
					assert.equal(u.data, data);
					assert.deepEqual(data, original);
					assert.deepEqual([u.width, u.height], dimensions);
					assert.deepEqual([rects(1), rects(2)], geometry);
					assert.ok(u.ctx.log.slice(before).some(entry => entry[0] == 'clearRect'), 'toggle redraws the canvas');
					assertValueTexts(enabled);
				}
			}
		}
	});

	it('preserves value drawing through orientation, stack, and percent rebuilds', async () => {
		u.setData([['A', 'B', 'C'], [13, 13, 13], [26, 26, 26]]);
		await Promise.resolve();
		const data = u.data;
		const original = structuredClone(data);
		for (const enabled of [true, false]) {
			await toggle('show-values', enabled);
			for (const [id, checked] of [
				['horizontal', true], ['stacking-normal', true], ['stacking-percent', true], ['horizontal', false],
				['stacking-normal', true], ['stacking-off', true], ['stacking-percent', true], ['stacking-off', true],
			]) {
				const previous = u;
				await toggle(id, checked);
				assert.notEqual(u, previous);
				assert.equal(previous.root.isConnected, false);
				assert.equal(root.querySelectorAll('#plot .uplot').length, 1);
				assert.equal(u.data, data);
				assert.deepEqual(data, original);
				assert.equal(input('show-values').checked, enabled);
				assertValueTexts(enabled);
			}
		}
	});

	it('reads initially checked show values without a change event', async () => {
		demo.destroy();
		input('show-values').checked = true;
		await withSeededRandom(() => {
			demo = createDemo(root);
			u = demo.plot;
		});
		await Promise.resolve();
		u.setData([['A', 'B', 'C'], [13, 13, 13], [26, 26, 26]]);
		await Promise.resolve();
		assert.equal(input('show-values').checked, true);
		assertValueTexts(true);
		await toggle('show-values', false);
		assertValueTexts(false);
	});

	it('switches hover mode synchronously without replacing or redrawing the chart or data', async () => {
		assert.equal(input('hover-mode').getAttribute('role'), 'radiogroup');
		assert.equal(input('hover-mode').getAttribute('aria-labelledby'), 'hover-label');
		assert.equal(input('hover-label').textContent, 'Hover');
		for (const mode of ['bar', 'group']) {
			const radio = input(`hover-${mode}`);
			assert.equal(radio.type, 'radio');
			assert.equal(radio.name, 'hover-mode');
			assert.equal(radio.value, mode);
			assert.equal(radio.labels[0].textContent.trim(), mode == 'bar' ? 'Bar' : 'Group');
			assert.equal(radio.checked, mode == 'bar');
		}
		u.setData([['A', 'B', 'C'], [13, 13, 13], [26, 26, 26]]);
		await change('bar-width', 50, 'input');
		const data = u.data;
		const original = structuredClone(data);
		for (const horizontal of [false, true]) {
			if (horizontal)
				await toggle('horizontal', true);
			const current = u;
			const geometry = [rects(1), rects(2)];
			const paths = u.series.slice(1).map(series => series._paths);
			hoverBar();
			assertHoverMode('bar');
			const before = u.ctx.log.length;
			let redraws = 0;
			u.hooks.draw.push(() => redraws++);
			for (const mode of ['group', 'bar', 'group']) {
				input(`hover-${mode}`).click();
				assert.equal(input('hover-bar').checked, mode == 'bar');
				assert.equal(input('hover-group').checked, mode == 'group');
				assertHoverMode(mode);
				await Promise.resolve();
				assert.equal(demo.plot, current);
				assert.equal(u.data, data);
				assert.deepEqual(data, original);
				assert.deepEqual([rects(1), rects(2)], geometry);
				assert.ok(paths.every((path, i) => path === u.series[i + 1]._paths));
				assert.equal(redraws, 0, 'hover mode does not redraw');
				assert.equal(u.ctx.log.length, before, 'hover mode does not touch the canvas');
			}
			const band = u.under.querySelector('.u-bar-group-hover');
			const category = u.valToPos(1, 'x');
			const numeric = u.valToPos(6, 'y');
			u.setCursor(horizontal ? { left: numeric, top: category } : { left: category, top: numeric });
			assertHoverMode('group');
			await toggle('hover-bar', true);
			assert.deepEqual(u.cursor.idxs, [null, null, null], 'the category center is a gap between bars');
			assert.equal(band.style.display, 'none');
			await toggle('hover-group', true);
			assertHoverMode('group');
			u.over.dispatchEvent(new MouseEvent('mouseleave'));
			assert.equal(band.style.display, 'none', 'leaving the plot hides the group highlight');
			await toggle('hover-bar', true);
		}
	});

	it('preserves hover mode through orientation, stack, and percent rebuilds', async () => {
		u.setData([['A', 'B', 'C'], [13, 13, 13], [26, 26, 26]]);
		await Promise.resolve();
		const data = u.data;
		const original = structuredClone(data);
		for (const mode of ['group', 'bar']) {
			await toggle(`hover-${mode}`, true);
			for (const [id, checked] of [
				['horizontal', true], ['stacking-normal', true], ['stacking-percent', true], ['horizontal', false],
				['stacking-normal', true], ['stacking-off', true], ['stacking-percent', true], ['stacking-off', true],
			]) {
				const previous = u;
				await toggle(id, checked);
				assert.notEqual(u, previous);
				assert.equal(previous.root.isConnected, false);
				assert.equal(root.querySelectorAll('#plot .uplot').length, 1);
				assert.equal(input(`hover-${mode}`).checked, true);
				assert.equal(u.data, data);
				assert.deepEqual(data, original);
				const band = u.under.querySelector('.u-bar-group-hover');
				if (band)
					assert.equal(band.style.display, 'none', 'a rebuilt plot starts without a hover');
				hoverBar();
				assertHoverMode(mode);
			}
		}
	});

	it('reads an initial group hover selection without a change event', async () => {
		demo.destroy();
		input('hover-group').checked = true;
		await withSeededRandom(() => {
			demo = createDemo(root);
			u = demo.plot;
		});
		await Promise.resolve();
		u.setData([['A', 'B', 'C'], [13, 13, 13], [26, 26, 26]]);
		await Promise.resolve();
		assert.equal(input('hover-group').checked, true);
		const band = u.under.querySelector('.u-bar-group-hover');
		assert.ok(band);
		assert.equal(band.style.display, 'none');
		u.setCursor({ left: u.valToPos(1, 'x'), top: u.valToPos(6, 'y') });
		assert.equal(band.style.display, 'none', 'a cursor position alone does not show the band before mouseenter');
		hoverBar();
		assertHoverMode('group');
		await toggle('hover-bar', true);
		assertHoverMode('bar');
	});

	it('preserves group and bar distribution and width through orientation, stack, and percent rebuilds', async () => {
		const data = u.data;
		const original = structuredClone(data);
		for (const [distribution, width] of [[2, 35], [3, 80]]) {
			await change('distribution', distribution, 'change');
			await change('group-width', width, 'input');
			await change('bar-distribution', distribution, 'change');
			await change('bar-width', 50, 'input');
			for (const [id, checked] of [
				['horizontal', true], ['stacking-normal', true], ['stacking-percent', true], ['horizontal', false],
				['stacking-normal', true], ['stacking-off', true], ['stacking-percent', true], ['stacking-off', true],
			]) {
				const previous = u;
				await toggle(id, checked);
				assert.notEqual(u, previous);
				assert.equal(previous.root.isConnected, false);
				assert.equal(root.querySelectorAll('#plot .uplot').length, 1);
				assert.equal(u.data, data);
				assert.deepEqual(data, original);
				assert.equal(input('distribution').value, String(distribution));
				assert.equal(input('group-width').valueAsNumber, width);
				assert.equal(input('group-width-value').textContent, `${width}%`);
				assert.equal(input('bar-distribution').value, String(distribution));
				assert.equal(input('bar-width').valueAsNumber, 50);
				assert.equal(input('bar-width-value').textContent, '50%');
				assertDataShape();
				assertGroupGeometry();
				assertReadout();
			}
		}
	});

	it('rebuilds orientations at the same dimensions while preserving data, truncation, and rotation', async () => {
		assert.deepEqual([u.width, u.height], [1200, 500]);
		assert.equal(input('horizontal').checked, false);
		assert.equal(input('vertical').checked, true);
		assert.equal(input('rotation').disabled, false);
		assert.equal(input('rotation').value, '45');
		assert.equal(input('rotation-value').textContent, '45°');
		u.setPxRatio(2);
		await rotate(-30);
		await change('max-length', 8, 'input');

		for (const middle of [false, true]) {
			await toggle('middle-ellipsis', middle);

			for (const horizontal of [true, false]) {
				const previous = u;
				const data = u.data;
				const original = structuredClone(data);
				const dimensions = [u.width, u.height];
				let destroyed = 0;
				previous.hooks.destroy.push(() => destroyed++);
				await toggle('horizontal', horizontal);

				assert.notEqual(u, previous);
				assert.equal(destroyed, 1, 'destroy the replaced plot exactly once');
				assert.equal(previous.root.isConnected, false);
				assert.equal(root.querySelectorAll('#plot .uplot').length, 1, 'one live chart after each rebuild');
				assert.equal(input('plot').querySelector('.uplot'), u.root);
				assert.equal(u.data, data, 'orientation preserves the exact data reference');
				assert.deepEqual([u.width, u.height], dimensions, 'orientation preserves both plot dimensions');
				assert.equal(u.pxRatio, 2);
				assert.equal(u.scales.x.ori, horizontal ? 1 : 0);
				assert.equal(u.scales.y.ori, horizontal ? 0 : 1);
				assert.equal(u.axes[0]._rotate, horizontal ? 0 : -30);
				assert.equal(input('rotation').disabled, horizontal);
				assert.equal(input('rotation-value').textContent, horizontal ? '0°' : '-30°');
				if (!horizontal)
					assert.equal(input('rotation').value, '-30', 'restore the remembered vertical rotation');
				assert.equal(input('horizontal').checked, horizontal);
				assert.equal(input('vertical').checked, !horizontal);
				assert.equal(input('max-length').disabled, false);
				assert.equal(input('middle-ellipsis').checked, middle);
				assert.equal(input('max-length').value, '8');
				assertTruncated(data[0], 8, middle);

				const current = u;
				const setSize = u.setSize;
				const setData = u.setData;
				let sizes = 0, randomizations = 0;
				u.setSize = (...args) => { sizes++; return setSize(...args); };
				u.setData = (...args) => { randomizations++; return setData(...args); };
				const resized = horizontal ? [960, 540] : [1100, 700];
				await resize(...resized);
				assert.equal(demo.plot, current, 'resizing does not rebuild');
				assert.equal(sizes, 1, 'one resize handler after repeated rebuilds');
				assert.deepEqual([u.width, u.height], resized);
				assert.equal(u.data, data);

				await withSeededRandom(async () => {
					input('randomize').click();
					u = demo.plot;
					await Promise.resolve();
				});
				assert.equal(u, current, 'randomization acts on the current plot');
				assert.equal(randomizations, 1, 'one randomize handler after repeated rebuilds');
				assert.notEqual(u.data, data);
				assert.deepEqual(data, original, 'controls do not mutate the data saved before destroy');
				assertDataShape();
				assertTruncated(fullLabels(), 8, middle);
				assert.equal(u.axes[0]._rotate, horizontal ? 0 : -30);

				input('max-length').value = '4';
				input('max-length').dispatchEvent(new Event('input'));
				u = demo.plot;
				await Promise.resolve();
				assertTruncated(fullLabels(), 4, middle);
				input('max-length').value = '8';
				input('max-length').dispatchEvent(new Event('input'));
				u = demo.plot;
				await Promise.resolve();
				assertTruncated(fullLabels(), 8, middle);
			}
		}
		await rotate(60);
		assertPadding();
	});

	it('selects mutually exclusive grouped, value, and percent modes at the same size in both orientations', async () => {
		assert.equal(input('stacking').getAttribute('role'), 'radiogroup');
		assert.equal(input('stacking').getAttribute('aria-labelledby'), 'stacking-label');
		assert.ok(input('stacking-label').textContent.trim());
		assert.equal(input('stacking').querySelectorAll('input').length, 3);
		for (const [id, value] of stackingInputs) {
			assert.ok(input('stacking').contains(input(id)));
			assert.equal(input(id).type, 'radio');
			assert.equal(input(id).name, 'stacking');
			assert.equal(input(id).value, value);
			assert.equal(input(id).defaultChecked, value == 'grouped');
		}
		assertStackingMode('grouped');
		const data = [['A long category', 'Another category', 'Last category'], [2, 4, 6], [6, 8, 10]];
		const original = structuredClone(data);
		u.setData(data);
		u.setPxRatio(2);
		await rotate(-30);
		await change('max-length', 8, 'input');
		await toggle('middle-ellipsis', true);

		function assertMode(mode, horizontal) {
			assertStackingMode(mode);
			assert.equal(u.data, data);
			assert.deepEqual(data, original, 'stacking never changes raw data');
			assert.equal(u.pxRatio, 2);
			assert.equal(u.axes[0]._rotate, horizontal ? 0 : -30);
			assert.equal(input('rotation').value, '-30');
			assert.equal(input('rotation').disabled, horizontal);
			assert.deepEqual([u.width, u.height], [1200, 500]);
			assert.equal(input('max-length').disabled, false);
			assert.equal(input('middle-ellipsis').checked, true);
			assert.equal(input('max-length').value, '8');
			assertTruncated(data[0], 8, true);
			assertGroupGeometry();
			const a = rects(1), b = rects(2);
			const pos = horizontal ? 1 : 0, size = horizontal ? 3 : 2;
			for (let i = 0; i < data[0].length; i++) {
				if (mode == 'grouped')
					assert.ok(a[i][pos] + a[i][size] <= b[i][pos] + 1 || b[i][pos] + b[i][size] <= a[i][pos] + 1, 'grouped bars do not overlap beyond device-pixel rounding');
				else {
					assert.equal(a[i][pos], b[i][pos], 'stack members share a category position');
					assert.equal(a[i][size], b[i][size], 'stack members share a category width');
				}
				const total = data[1][i] + data[2][i];
				assert.equal(u._data[1][i], mode == 'percent' ? data[1][i] / total : data[1][i]);
				assert.equal(u._data[2][i], mode == 'percent' ? 1 : mode == 'value' ? total : data[2][i]);
				u.setLegend({ idx: i });
				assert.deepEqual(u.legend.values.map(value => value._), data.map(column => String(column[i])), 'legend shows full labels and raw values');
			}
			if (mode == 'percent') {
				assert.deepEqual([u.scales.y.min, u.scales.y.max], [0, 1]);
				assert.deepEqual(u.axes[1]._values, u.axes[1]._splits.map(value => `${Math.round(value * 100)}%`));
			}
			else {
				assert.equal(u.scales.y.min, 0, 'soft-zero baseline');
				assert.ok(u.scales.y.max >= (mode == 'value' ? 16 : 10));
				assert.deepEqual([u.axes[1]._splits[0], u.axes[1]._splits.at(-1)], [u.scales.y.min, u.scales.y.max], 'tick-aware bounds');
				assert.ok(u.axes[1]._values.every(value => !String(value).includes('%')));
			}
		}

		for (const horizontal of [false, true, false]) {
			if (input('horizontal').checked != horizontal)
				await toggle('horizontal', horizontal);
			assertMode('grouped', horizontal);
			for (const mode of ['value', 'percent', 'grouped', 'percent', 'value', 'grouped']) {
				const previous = u;
				const dimensions = [u.width, u.height];
				let destroyed = 0;
				previous.hooks.destroy.push(() => destroyed++);
				await selectStacking(mode);
				assert.notEqual(u, previous);
				assert.equal(destroyed, 1, 'one rebuild per radio change');
				assert.equal(previous.root.isConnected, false);
				assert.equal(root.querySelectorAll('#plot .uplot').length, 1);
				assert.deepEqual([u.width, u.height], dimensions);
				assertMode(mode, horizontal);
			}
		}
	});

	for (const [id, mode] of stackingInputs) {
		it(`reads initially checked ${mode} stacking without a change event and preserves it on orientation rebuild`, async () => {
			demo.destroy();
			input(id).checked = true;
			await withSeededRandom(() => {
				demo = createDemo(root);
				u = demo.plot;
			});
			await Promise.resolve();
			const data = [['A', 'B', 'C'], [2, 2, 2], [6, 6, 6]];
			u.setData(data);
			await Promise.resolve();
			for (const horizontal of [false, true]) {
				if (horizontal)
					await toggle('horizontal', true);
				assertStackingMode(mode);
				assert.equal(u.scales.x.ori, horizontal ? 1 : 0);
				assert.equal(u.data, data);
				assert.deepEqual(u._data.slice(1), mode == 'percent'
					? [[.25, .25, .25], [1, 1, 1]]
					: mode == 'value' ? [[2, 2, 2], [8, 8, 8]] : data.slice(1));
				assert.equal(u.axes[1]._values.every(value => String(value).endsWith('%')), mode == 'percent');
				assertGroupGeometry();
			}
		});
	}

	function assertTotals(raw, visible) {
		const count = raw.length - 1;
		assertComponents(count, true);
		assert.deepEqual(u.data, withBarTotals(raw, visible));
		assert.equal(u.data[0], raw[0]);
		for (let si = 1; si <= count; si++)
			assert.equal(u.data[si + 2], raw[si]);
		assert.deepEqual(u.series.map(series => series.label), ['Item', 'Positive total', 'Negative total', ...componentLabels.slice(0, count)]);
		assert.deepEqual(u.series.slice(1, 3).map(series => series.fill(u, 0)), ['lightgray', 'silver']);
	}

	it('toggles external totals at the same size with full group widths behind component bars', async () => {
		assert.equal(input('show-totals').checked, false);
		assert.equal(input('show-totals').disabled, false);
		const raw = [['A', 'B', 'C'], [2, -4, 3], [6, -2, -1]];
		const original = structuredClone(raw);
		u.setData(raw);
		await change('group-width', 75, 'input');
		await change('bar-width', 60, 'input');
		await change('bar-distribution', 3, 'change');
		await change('distribution', 1, 'change');
		for (const horizontal of [false, true]) {
			await toggle('horizontal', horizontal);
			const previous = u;
			const dimensions = [u.width, u.height, u.pxRatio];
			let destroyed = 0;
			u.hooks.destroy.push(() => destroyed++);
			await toggle('show-totals', true);
			assert.notEqual(u, previous);
			assert.equal(destroyed, 1);
			assert.deepEqual([u.width, u.height, u.pxRatio], dimensions);
			assertTotals(raw);
			const pos = horizontal ? 1 : 0, size = horizontal ? 3 : 2;
			const origin = horizontal ? u.bbox.top : u.bbox.left;
			const span = horizontal ? u.bbox.height : u.bbox.width;
			distr(3, .75, 1, null, (di, off, width) => {
				for (const si of [1, 2]) {
					if (u.data[si][di] == null)
						continue;
					const index = u.data[si].slice(0, di).filter(value => value != null).length;
					const rect = rects(si)[index];
					assert.ok(Math.abs(rect[pos] - (origin + off * span)) <= 1, 'total starts at group edge');
					assert.ok(Math.abs(rect[size] - width * span) <= 1, 'total spans the group');
				}
				for (const si of [3, 4]) {
					distr(2, .6, 3, si - 3, (_, barOff, barSize) => {
						assert.ok(Math.abs(rects(si)[di][pos] - (origin + (off + barOff * width) * span)) <= 1);
						assert.ok(Math.abs(rects(si)[di][size] - barSize * width * span) <= 1, 'totals do not occupy component slots');
					});
				}
			});
			const order = [];
			(u.hooks.drawSeries ??= []).push((plot, si) => order.push(si));
			u.redraw();
			await Promise.resolve();
			assert.deepEqual(order, [1, 2, 3, 4], 'native draw order puts totals behind components');
			await toggle('show-totals', false);
			assert.equal(u.series.length, 3);
			assert.deepEqual(u.data, raw);
			assert.equal(u.data[1], raw[1]);
			assert.equal(u.data[2], raw[2]);
			assert.deepEqual([u.width, u.height, u.pxRatio], dimensions);
		}
		assert.deepEqual(raw, original);
	});

	it('uses current external setData columns for totals, visibility changes, and rebuilds', async () => {
		await toggle('show-totals', true);
		const raw = [['New A', 'New B', 'New C'], [20, -40, 30], [60, -20, -10]];
		const prepared = withBarTotals(raw);
		u.setData(prepared);
		await Promise.resolve();
		assert.equal(u.data, prepared, 'setData remains a normal core method');
		assertTotals(raw);
		assert.ok(u.scales.y.max >= 80 && u.scales.y.min <= -60);
		const updates = [];
		const setData = u.setData;
		u.setData = (data, reset) => {
			updates.push(reset);
			setData(data, reset);
		};
		u.setSeries(3, { show: false });
		assertTotals(raw, [true, false, true]);
		assert.deepEqual(updates, [false], 'totals change synchronously before the pending autoscale');
		await Promise.resolve();
		assert.ok(u.scales.y.max >= 60 && u.scales.y.max < 80);
		assert.ok(u.scales.y.min <= -20 && u.scales.y.min > -40);
		u.setSeries(3, { show: false });
		u.setSeries(4, { focus: true });
		u.setSeries(null, { focus: true });
		u.setSeries(3, { focus: false });
		u.setSeries(1, { show: false });
		u.setSeries(2, { show: false });
		await Promise.resolve();
		assert.deepEqual(updates, [false], 'focus, unchanged visibility, and total visibility do not sum');
		await toggle('horizontal', true);
		assertTotals(raw, [true, false, true]);
		assert.deepEqual(u.series.slice(1).map(series => series.show), [false, false, false, true]);
		u.setSeries(null, { show: false });
		assertTotals(raw, [true, false, false]);
		await Promise.resolve();
		u.setSeries(null, { show: true });
		assertTotals(raw);
		await Promise.resolve();
		await toggle('show-totals', false);
		assert.deepEqual(u.data, raw, 'rebuild extracts raw columns from the current plot, not initial data');
	});

	it('ignores retained visibility hooks from a plot replaced by a different data layout', async () => {
		await toggle('show-totals', true);
		const previous = u;
		const onSeries = previous.hooks.setSeries[0];
		await toggle('show-totals', false);
		const data = u.data;
		const updates = [];
		previous.setData = (...args) => updates.push(args);
		onSeries(previous, 3, { show: false });
		onSeries(previous, null, { show: true });
		onSeries(previous, null, { focus: true });
		assert.deepEqual(updates, [], 'retained hooks cannot update a destroyed plot');
		assert.equal(u.data, data);
		assert.equal(u.data.length, 3);
	});

	it('does not recompute totals on hover, resize, rotation, or rendering controls', async () => {
		await toggle('show-totals', true);
		const raw = [['A', 'B', 'C'], [13, 13, 13], [26, 26, 26]];
		u.setData(withBarTotals(raw));
		await Promise.resolve();
		const prepared = u.data;
		let updates = 0;
		u.hooks.setData.push(() => updates++);
		hoverBar();
		await resize(u.width, 600);
		await rotate(-30);
		await toggle('show-values', true);
		await toggle('hover-group', true);
		await change('bar-width', 70, 'input');
		assert.equal(u.data, prepared);
		assert.equal(updates, 0);
	});

	it('omits totals from stacks while retaining checkbox and series visibility preferences', async () => {
		const raw = [['A', 'B', 'C'], [2, -4, 3], [6, -2, -1]];
		u.setData(raw);
		u.setSeries(1, { show: false });
		await toggle('show-totals', true);
		assertTotals(raw, [true, false, true]);
		u.setSeries(1, { show: false });
		await Promise.resolve();
		for (const mode of ['value', 'percent']) {
			await selectStacking(mode);
			assert.equal(input('show-totals').disabled, true);
			assert.equal(input('show-totals').checked, true);
			assert.equal(u.series.length, 3);
			assert.deepEqual(u.data, raw);
			assert.equal(u.series[1].show, false);
			assert.deepEqual(u._data[2], mode == 'value' ? raw[2] : [1, -1, -1]);
			await toggle('horizontal', mode == 'value');
			assert.equal(u.series.length, 3);
			await selectStacking('grouped');
			assert.equal(input('show-totals').disabled, false);
			assertTotals(raw, [true, false, true]);
			assert.deepEqual(u.series.slice(1).map(series => series.show), [false, true, false, true]);
		}
	});

	it('prepares randomized totals from visible raw components without replacing the plot', async () => {
		await toggle('show-totals', true);
		u.setSeries(4, { show: false });
		await Promise.resolve();
		const current = u;
		await withSeededRandom(async () => {
			for (let i = 0; i < 3; i++) {
				const previous = u.data;
				input('randomize').click();
				await Promise.resolve();
				assert.equal(demo.plot, current);
				assert.notEqual(u.data[0], previous[0]);
				assert.notEqual(u.data[3], previous[3]);
				assert.notEqual(u.data[4], previous[4]);
				assertTotals([u.data[0], ...u.data.slice(3)], [true, true, false]);
				assert.equal(u.series[4].show, false);
			}
		});
		await toggle('show-totals', false);
		assertDataShape();
		assert.equal(u.series[2].show, false);
	});

	for (const [id, mode] of stackingInputs) {
		it(`reads an initially checked totals preference in ${mode} mode`, async () => {
			demo.destroy();
			input('show-totals').checked = true;
			input(id).checked = true;
			await withSeededRandom(() => {
				demo = createDemo(root);
				u = demo.plot;
			});
			await Promise.resolve();
			assert.equal(input('show-totals').disabled, mode != 'grouped');
			assert.equal(u.data.length, mode == 'grouped' ? 5 : 3);
			const raw = mode == 'grouped' ? [u.data[0], ...u.data.slice(3)] : u.data;
			await selectStacking('grouped');
			assertTotals(raw);
		});
	}

	it('normalizes positive and negative stacks natively and preserves visibility across mode changes', async () => {
		const data = [['Positive', 'Negative', 'Mixed'], [2, -4, 3], [6, -2, -1]];
		u.setData(data);
		await selectStacking('percent');
		assert.deepEqual([u.scales.y.min, u.scales.y.max], [-1, 1]);
		assert.deepEqual(u._base[2], [.25, -2 / 3, 0]);
		assert.deepEqual(u._data[2], [1, -1, -1]);
		assert.equal(u.data, data);
		u.setSeries(1, { show: false });
		await Promise.resolve();
		assert.deepEqual(u._data[2], [1, -1, -1]);
		assert.deepEqual(u._base[2], [0, 0, 0]);
		await toggle('horizontal', true);
		assert.equal(u.series[1].show, false);
		await selectStacking('value');
		assert.equal(u.series[1].show, false);
		assert.deepEqual(u._data[2], data[2]);
		await selectStacking('grouped');
		assert.equal(u.series[1].show, false);
		u.setSeries(1, { show: true });
		await Promise.resolve();
		await selectStacking('value');
		assert.deepEqual(u._data[2], [8, -6, -1]);
		await selectStacking('percent');
		await withSeededRandom(async () => {
			input('randomize').click();
			await Promise.resolve();
		});
		assertDataShape();
		assert.notEqual(u.data, data);
		assert.ok(u._data.slice(1).flat().every(value => Math.abs(value) <= 1 + 1e-12));
		assert.ok(u.axes[1]._values.every(value => value.endsWith('%')));
		u.setData([['Negative'], [-2], [-6]]);
		await Promise.resolve();
		assert.deepEqual([u.scales.y.min, u.scales.y.max], [-1, 0]);
		u.setData([['Zero'], [0], [0]]);
		await Promise.resolve();
		assert.deepEqual([u.scales.y.min, u.scales.y.max], [0, 1]);
		assert.deepEqual(u._data.slice(1), [[0], [0]]);
	});

	it('destroys the current rebuilt chart and removes every UI control listener', async () => {
		await selectCount(5);
		await rotate(-45);
		for (const horizontal of [true, false, true])
			await toggle('horizontal', horizontal);
		await assertLegendMount();
		const current = u;
		const data = u.data;
		const original = structuredClone(data);
		const dimensions = [u.width, u.height];
		const counts = [measurements.x.length, measurements.y.length];
		const readouts = ['rotation-value', 'label-spacing-value', 'group-width-value', 'bar-width-value', 'max-length-value', 'series-count-value', 'copy-status', 'stats'];
		const text = readouts.map(id => input(id).textContent);
		const disabledIds = ['rotation', 'max-length', 'end-ellipsis', 'middle-ellipsis', 'vertical', 'horizontal', 'show-totals', 'series-count', ...stackingInputs.map(([id]) => id)];
		const disabled = disabledIds.map(id => input(id).disabled);
		let destroyed = 0;
		u.hooks.destroy.push(() => destroyed++);
		const removed = [];
		const listenerTypes = [
			['rotation', 'input'], ['label-spacing', 'input'], ['vertical', 'change'], ['horizontal', 'change'],
			...stackingInputs.map(([id]) => [id, 'change']),
			['show-values', 'change'], ['show-totals', 'change'], ['hover-bar', 'change'], ['hover-group', 'change'], ['distribution', 'change'], ['group-width', 'input'],
			['bar-distribution', 'change'], ['bar-width', 'input'],
			['randomize', 'click'], ['max-length', 'input'], ['end-ellipsis', 'change'], ['middle-ellipsis', 'change'],
			['series-count', 'input'], ['copy-link', 'click'],
		];
		for (const [id] of listenerTypes) {
			const el = input(id);
			const remove = el.removeEventListener.bind(el);
			el.removeEventListener = (type, handler, options) => {
				removed.push([id, type]);
				return remove(type, handler, options);
			};
		}
		const observer = observers[0];
		demo.destroy();
		assert.deepEqual(removed.sort(), listenerTypes.slice().sort());
		assert.equal(observer.disconnectCount, 1);
		assert.equal(destroyed, 1);
		assert.equal(current.root.isConnected, false);
		assert.equal(input('plot').querySelectorAll('.uplot').length, 0);

		const calls = [];
		for (const method of ['setData', 'setSize', 'redraw'])
			current[method] = () => calls.push(method);
		input('vertical').checked = true;
		input('show-values').checked = true;
		input('show-totals').checked = true;
		input('hover-group').checked = true;
		input('rotation').value = '75';
		input('label-spacing').value = '300';
		await resize(900, 800, observer);
		input('distribution').value = '3';
		input('group-width').value = '90';
		input('bar-distribution').value = '3';
		input('bar-width').value = '50';
		input('max-length').value = '4';
		input('series-count').value = '1';
		input('middle-ellipsis').checked = true;
		for (const [id, type] of listenerTypes) {
			if (input(id).type == 'radio')
				input(id).checked = true;
			input(id).dispatchEvent(new Event(type));
			u = demo.plot;
			await Promise.resolve();
		}
		await new Promise(requestAnimationFrame);
		assert.deepEqual(calls, [], 'controls and retained observer callbacks never call into the destroyed plot');
		assert.equal(input('chart-legend').querySelector('table'), null, 'destroy removes the externally mounted legend');
		assert.equal(input('plot').querySelectorAll('.uplot').length, 0, 'orientation and stacking cannot recreate a chart after teardown');
		assert.equal(demo.plot, null);
		assert.deepEqual(current.data, data.map(() => []));
		assert.equal(current._base, null);
		assert.ok(current.series.slice(1).every(s => s._paths === null && s.points._paths === null));
		demo.destroy();
		assert.deepEqual(data, original, 'destroy does not empty externally retained data arrays');
		assert.deepEqual([current.width, current.height], dimensions);
		assert.deepEqual([measurements.x.length, measurements.y.length], counts);
		assert.deepEqual(readouts.map(id => input(id).textContent), text, 'readouts remain unchanged');
		assert.deepEqual(disabledIds.map(id => input(id).disabled), disabled);
		assert.equal(destroyed, 1, 'control actions do not destroy the chart again');
		assert.deepEqual(removed.sort(), listenerTypes.slice().sort(), 'repeated destroy does not remove listeners again');
		assert.equal(observer.disconnectCount, 1, 'repeated destroy does not disconnect again');
	});

	it('releases the detached root when the destroyed demo is retained', async function() {
		if (!globalThis.gc)
			this.skip();
		await toggle('show-totals', true);
		const ref = new WeakRef(root);
		demo.destroy();
		root.remove();
		// A disconnected native observer is not retained by the browser; release the test registry too.
		observers = [];
		root = u = null;
		for (let i = 0; i < 3; i++) {
			await new Promise(setImmediate);
			globalThis.gc();
		}
		assert.equal(ref.deref(), undefined);
		assert.equal(demo.plot, null);
	});


	it('reuses X measurements until selected labels or pixel ratio changes', async () => {
		const count = u.data[0].length;
		assert.equal(measurements.x.length, count);
		for (const degrees of [-90, -45, 0, 45, 90])
			await rotate(degrees);
		u.setData([u.data[0], ...u.data.slice(1).map(ys => ys.map(y => y * 2))]);
		await Promise.resolve();
		assert.equal(measurements.x.length, count);

		await withSeededRandom(async () => {
			// The first seeded click can reproduce the initial labels; the next must change them.
			input('randomize').click();
			await Promise.resolve();
			const previous = fullLabels();
			const before = measurements.x.length;
			input('randomize').click();
			await Promise.resolve();
			assert.notDeepEqual(fullLabels(), previous);
			assert.equal(measurements.x.length, before + u.data[0].length);
			assert.deepEqual(measurements.x.slice(before), u.axes[0]._values);
		});

		let measured = measurements.x.length;
		u.setPxRatio(u.pxRatio == 1 ? 2 : 1);
		await Promise.resolve();
		measured += u.data[0].length;
		assert.equal(measurements.x.length, measured);

		await rotate(0);
		assert.equal(measurements.x.length, measured);
	});

	it('synchronizes initial truncation and ellipsis options with a prepopulated form', async () => {
		const data = u.data.map(values => values.slice());
		assert.ok(data[0].some(label => label.length > 4), 'exercise truncation');
		for (const middle of [false, true]) {
			for (const limit of [4, 0]) {
				demo.destroy();
				input('max-length').value = String(limit);
				input('max-length-value').textContent = 'stale';
				input(middle ? 'middle-ellipsis' : 'end-ellipsis').checked = true;
				await withSeededRandom(() => {
					demo = createDemo(root);
					u = demo.plot;
				});
				await Promise.resolve();

				assert.equal(input('max-length-value').textContent, limit == 0 ? 'Off' : String(limit));
				for (const id of ['max-length', 'end-ellipsis', 'middle-ellipsis'])
					assert.equal(input(id).disabled, false);
				assert.equal(input('middle-ellipsis').checked, middle);
				assert.equal(input('end-ellipsis').checked, !middle);
				if (limit == 0)
					assert.deepEqual(u.axes[0]._values, data[0]);
				else
					assertTruncated(data[0], limit, middle);
				assert.deepEqual(u.data, data, 'initial truncation preserves the original data');
			}
		}
	});

	it('measures truncated labels and supports end and middle ellipses', async () => {
		const data = u.data;
		const labels = fullLabels();
		const count = labels.length;
		assert.ok(labels.some(label => label.length > 8), 'exercise truncation');
		assert.ok(labels.some(label => label.length <= 8), 'exercise unchanged short labels');
		await rotate(0);
		assert.equal(input('max-length').disabled, false);
		assert.equal(input('end-ellipsis').disabled, false);
		assert.equal(input('middle-ellipsis').disabled, false);
		assert.equal(input('max-length-value').textContent, 'Off');
		await change('max-length', 8, 'input');
		assert.equal(input('max-length').disabled, false);
		assert.equal(input('middle-ellipsis').disabled, false);
		assert.equal(input('max-length-value').textContent, '8');
		assertTruncated(labels, 8, false);
		assert.deepEqual(measurements.x.slice(count), u.axes[0]._values);
		assertPadding();
		assert.equal(u._padding[1], 8);

		input('middle-ellipsis').checked = true;
		input('middle-ellipsis').dispatchEvent(new Event('change'));
		await Promise.resolve();
		assertTruncated(labels, 8, true);
		assert.equal(measurements.x.length, 3 * count);
		await rotate(90);
		assert.equal(measurements.x.length, 3 * count);
		assert.equal(u.axes[0]._size, Math.ceil(u.axes[0].ticks.size + u.axes[0].gap + longestWidth()));

		input('max-length').value = '4';
		input('max-length').dispatchEvent(new Event('input'));
		await Promise.resolve();
		assert.equal(input('max-length-value').textContent, '4');
		assertTruncated(labels, 4, true);
		assert.equal(measurements.x.length, 4 * count);

		await change('max-length', 0, 'input');
		assert.equal(input('max-length-value').textContent, 'Off');
		assert.equal(input('max-length').disabled, false);
		assert.equal(input('end-ellipsis').disabled, false);
		assert.equal(input('middle-ellipsis').disabled, false);
		assert.deepEqual(u.axes[0]._values, labels);
		assert.deepEqual(fullLabels(), labels);
		assert.equal(measurements.x.length, 5 * count);
		assert.equal(u.data, data);
	});

	it('keeps the cache when truncation controls do not change the labels', async () => {
		for (const limit of [20, 0]) {
			await change('max-length', limit, 'input');
			for (const middle of [true, false]) {
				await toggle('middle-ellipsis', middle);
				await rotate(0);
				assert.deepEqual(u.axes[0]._values, fullLabels());
				assert.equal(measurements.x.length, u.data[0].length);
				assert.equal(input('max-length-value').textContent, limit == 0 ? 'Off' : String(limit));
				for (const id of ['max-length', 'end-ellipsis', 'middle-ellipsis'])
					assert.equal(input(id).disabled, false);
			}
		}
	});

	it('supports one-to-three-character limits and re-enables the selected ellipsis after Off', async () => {
		const current = u;
		const data = u.data;
		for (const middle of [false, true]) {
			await change('max-length', 0, 'input');
			await toggle('middle-ellipsis', middle);
			assert.deepEqual(u.axes[0]._values, data[0], 'ellipsis selection while Off leaves full labels');
			for (const limit of [1, 2, 3]) {
				await change('max-length', limit, 'input');
				assert.equal(demo.plot, current);
				assert.equal(u.data, data);
				assert.equal(input('max-length-value').textContent, String(limit));
				assertTruncated(data[0], limit, middle);
			}
		}
	});

	it('fits edge bars within the expanded X range', () => {
		assertDataShape();
		assert.equal(u.series[1].fill(u, 1), 'royalblue');
				assert.equal(u.series[2].fill(u, 2), 'darkorange');
				assert.notEqual(u.series[1].label, u.series[2].label);
		assert.equal(u.series[1].width, 0);
		assert.equal(u.series[1].points.show(u, 1), false);
		assertBars();
	});

	it('sizes Y from formatted ticks across mixed-sign magnitudes without remeasuring X', async () => {
		await rotate(33);
		const sizes = [];
		for (const magnitude of [1e-4, 1, 1e8, 1e-4]) {
			const before = measurements.y.length;
			setYData((i, si) => (i - (u.data[0].length - 1) / 2) * magnitude * si);
			await Promise.resolve();
			assertYAxis();
			assert.ok(measurements.y.length > before, 'changed Y labels invalidate their cache');
			assert.equal(measurements.x.length, u.data[0].length, 'Y data changes preserve the X cache');
			sizes.push(u.axes[1]._size);

			const measured = measurements.y.length;
			const labels = u.axes[1]._values.slice();
			u.redraw(false, true);
			await Promise.resolve();
			assert.deepEqual(u.axes[1]._values, labels);
			assert.equal(measurements.y.length, measured, 'unchanged Y labels stay cached across layout');
			assert.equal(measurements.x.length, u.data[0].length);
			assertYAxis();
		}
		assert.ok(new Set(sizes).size > 1, 'Y width adapts to formatted label lengths');
		assert.equal(sizes[0], sizes.at(-1), 'returning to small values restores the original width');
	});

	it('retains a zero baseline for positive and negative Y data', async () => {
		for (const sign of [1, -1]) {
			setYData((i, si) => sign * (i + 1) * 1e-4 * si);
			await Promise.resolve();
			assertYAxis();
			assert.equal(sign > 0 ? u.scales.y.min : u.scales.y.max, 0);
			assert.equal(measurements.x.length, u.data[0].length);
		}
	});

	it('invalidates the Y measurement cache for DPR changes', async () => {
		setYData((i, si) => (i - (u.data[0].length - 1) / 2) * si);
		await Promise.resolve();
		assertYAxis();
		let before = measurements.y.length;

		u.setPxRatio(u.pxRatio == 1 ? 2 : 1);
		await Promise.resolve();
		assert.ok(measurements.y.length > before, 'DPR changes invalidate Y measurements');
		assert.equal(measurements.x.length, 2 * u.data[0].length);
		assertYAxis();
		const measured = measurements.y.length;
		u.redraw(false, true);
		await Promise.resolve();
		assert.equal(measurements.y.length, measured);
		assert.equal(measurements.x.length, 2 * u.data[0].length);
	});

	it('randomizes labels, counts, and Y magnitudes while preserving rotation and clipping', async () => {
		const counts = new Set();
		const wordCounts = new Set();
		const magnitudes = new Set();
		const peaks = [];
		const spreads = [];
		const minima = [];
		await rotate(-30);
		await withSeededRandom(async () => {
			for (let i = 0; i < 128; i++) {
				const previous = u.data;
				const labels = fullLabels();
				const before = measurements.x.length;
				input('randomize').click();
				await Promise.resolve();
				assertDataShape();
				assert.notEqual(u.data, previous);
				assert.notEqual(u.data[0], previous[0], 'fresh X labels');
				assert.notEqual(u.data[1], previous[1], 'fresh first Y values');
								assert.notEqual(u.data[2], previous[2], 'fresh second Y values');
				if (i > 0) {
					assert.notDeepEqual(fullLabels(), labels, 'fresh full labels');
					assert.notDeepEqual(u.data[1], previous[1], 'new first Y values');
										assert.notDeepEqual(u.data[2], previous[2], 'new second Y values');
				}
				const changed = labels.length != u.data[0].length || fullLabels().some((label, j) => label != labels[j]);
				assert.equal(measurements.x.length, before + (changed ? u.data[0].length : 0));
				assert.deepEqual(u.axes[0]._values, fullLabels());
				assert.equal(u.axes[0]._rotate, -30);
				assertReadout();
				assertYAxis();
				assertBars();
				counts.add(u.data[0].length);
				fullLabels().forEach(label => wordCounts.add(label.split(' ').length));
				const peak = Math.max(...u.data[1].map(Math.abs));
				peaks.push(peak);
				magnitudes.add(Math.floor(Math.log10(peak)));
				spreads.push(Math.max(...u.data[1]) - Math.min(...u.data[1]));
				minima.push(Math.min(...u.data[1]));
			}
		});
		assert.ok(counts.has(3) && counts.has(15), 'observe both item-count endpoints');
		assert.ok(counts.size > 5, 'item counts vary');
		assert.deepEqual([...wordCounts].sort(), [1, 2, 3]);
		assert.ok(magnitudes.size > 5, 'Y magnitudes vary');
		assert.ok(Math.min(...peaks) <= 1e-4);
		assert.ok(Math.max(...peaks) >= 1e6);
		assert.ok(Math.max(...spreads) / Math.min(...spreads) > 1e8, 'Y spreads vary across magnitudes');
		assert.ok(minima.some(y => y < 0) && minima.some(y => y > 0), 'Y offsets vary');
	});

	it('retains end and middle truncation on randomization and restores full labels', async () => {
		await change('max-length', 8, 'input');
		await rotate(45);
		await withSeededRandom(async () => {
			for (const middle of [false, true]) {
				await toggle('middle-ellipsis', middle);
				let truncated = false;
				for (let i = 0; i < 16; i++) {
					const previous = u.axes[0]._values.slice();
					const before = measurements.x.length;
					input('randomize').click();
					await Promise.resolve();
					assertDataShape();
					const labels = fullLabels();
					truncated ||= labels.some(label => label.length > 8);
					assertTruncated(labels, 8, middle);
					assert.equal(input('middle-ellipsis').checked, middle);
					assert.equal(input('max-length').value, '8');
					assert.equal(input('max-length-value').textContent, '8');
					assert.equal(input('max-length').disabled, false);
					assert.equal(input('middle-ellipsis').disabled, false);
					assert.equal(u.axes[0]._rotate, 45);
					const changed = previous.length != labels.length || u.axes[0]._values.some((label, j) => label != previous[j]);
					assert.equal(measurements.x.length, before + (changed ? labels.length : 0));
					if (changed)
						assert.deepEqual(measurements.x.slice(before), u.axes[0]._values);
					assertYAxis();
					assertBars();
				}
				assert.ok(truncated, 'exercise truncated randomized labels');
			}
		});
		const labels = fullLabels();
		const data = u.data;
		await change('max-length', 0, 'input');
		assert.equal(input('max-length-value').textContent, 'Off');
		assert.deepEqual(u.axes[0]._values, labels, 'restore current full labels, not the initial labels');
		assert.deepEqual(fullLabels(), labels);
		assert.equal(u.data, data);
		assert.equal(input('max-length').disabled, false);
		assert.equal(input('end-ellipsis').disabled, false);
		assert.equal(input('middle-ellipsis').disabled, false);
		assertReadout();
	});
});
