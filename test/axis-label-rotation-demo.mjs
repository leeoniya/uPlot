import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import '../scripts/instrument.mjs';
import { withSeededRandom } from '../scripts/withSeededRandom.mjs';
import { createDemo } from '../demos/axis-label-rotation.js';

const html = await readFile(new URL('../demos/axis-label-rotation.html', import.meta.url), 'utf8');

describe('random label rotation demo', () => {
	let root, demo, u, measurements, originalOffscreenCanvas;
	const input = id => root.querySelector(`#${id}`);

	beforeEach(async () => {
		root = document.createElement('div');
		root.innerHTML = html.match(/<main\b[^]*?<\/main>/)[0];
		document.body.appendChild(root);
		measurements = { x: [], y: [] };
		originalOffscreenCanvas = globalThis.OffscreenCanvas;
		globalThis.OffscreenCanvas = class {
			constructor() {
				this.ctx = {
					measureText(text) {
						measurements[demo.plot.axes[1]._values?.includes(text) ? 'y' : 'x'].push(text);
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
			root.remove();
		}
		finally {
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

	function assertDataShape() {
		const [xs, ys] = u.data;
		assert.ok(xs.length >= 3 && xs.length <= 15, '3–15 items');
		assert.ok(xs.every(value => typeof value == 'string'), 'raw X values are label strings');

		const indices = Array.from({ length: xs.length }, (_, i) => i);
		assert.deepEqual(u._data[0], indices, 'contiguous internal X indices');
		assert.equal(ys.length, xs.length);
		assert.ok(ys.every(Number.isFinite));
		assert.ok(ys.every(y => y >= -1e7 && y < 3e7), 'Y values fit the magnitude, offset, and spread bounds');
		assert.ok(new Set(ys).size > 1, 'Y values have a nonzero spread');
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
		assert.deepEqual([u.scales.x.min, u.scales.x.max], [-.5, xs.length - .5]);
		assert.deepEqual(u.axes[0]._splits, indices, 'ticks follow the current X indices');
	}

	function assertReadout() {
		const longest = u.axes[0]._values.reduce((a, b) => labelWidth(b) > labelWidth(a) ? b : a);
		assert.ok(input('stats').textContent.startsWith(`Items: ${u.data[0].length} | Longest label: ${longest} (${labelWidth(longest).toFixed(1)}px) |`));
	}

	function assertBars() {
		const rects = u.series[1]._paths.fill.log.filter(entry => entry[0] == 'rect').flatMap(entry => entry.slice(1));
		assert.equal(rects.length, u.data[0].length);
		for (const [x, , width] of rects) {
			assert.ok(width > 0);
			assert.ok(x >= u.bbox.left);
			assert.ok(x + width <= u.bbox.left + u.bbox.width);
		}
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
				const center = u.valToPos(i, 'x', true) / u.pxRatio;
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
		assert.ok(scale.min <= Math.min(0, ...u.data[1]));
		assert.ok(scale.max >= Math.max(0, ...u.data[1]));
		const labels = axis._values.filter(label => label != null);
		const width = Math.max(0, ...labels.map(label => String(label).length * parseFloat(axis.font[0]) / 2 / u.pxRatio));
		assert.equal(axis._size, Math.ceil(width + axis.ticks.size + axis.gap + 8), 'Y size measures formatted labels');
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

	it('shows random full labels and keeps the same data while rotating', async () => {
		assertDataShape();
		const labels = fullLabels();
		const data = u.data;
		assert.deepEqual(u.axes[0]._values, labels);
		assert.equal(input('randomize').textContent, 'Randomize data');
		assert.match(root.textContent, /legend keeps the full label/i);
		for (const degrees of [-90, -45, 0, 45, 90]) {
			await rotate(degrees);
			assert.equal(u.data, data);
			assert.deepEqual(u.axes[0]._values, labels);
			assert.deepEqual(fullLabels(), labels);
			assert.equal(measurements.x.length, labels.length);
			assertReadout();
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
				assert.ok(axis._size >= axis.ticks.size + axis.gap + maxY + 8 - 1e-9);
				assert.ok(u.bbox.height / ratio > 300);
				if (degrees == 0) {
					assert.equal(axis._size, axis.ticks.size + axis.gap + height + 8);
				}
			}
		}
	});

	it('credits only visible axis space without feedback or new measurements', async () => {
		await rotate(33);
		// Make the first label's overhang exceed its half-category inset.
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
						const halfSlot = minWidth / (2 * u.data[0].length);
						for (const [side, extent, space] of [[3, left, axisWidth], [1, right, 0]]) {
							const previousPad = Math.max(8, Math.ceil(8 + extent - space - halfSlot));
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

	it('credits the half-category inset without width feedback', async () => {
		u.setData([u.data[0], u.data[0].map((_, i) => 10 + i * 17)]);
		// Leave enough half-slot space to absorb the longest label's overhang.
		u.setSize({ width: Math.ceil(2 * (u.data[0].length + 1) * (longestWidth() + 20) + u.axes[1]._size), height: 500 });
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

	it('changes chart height without replacing data or remeasuring labels', async () => {
		const data = u.data;
		const width = u.width;
		const counts = new Set();
		assert.equal(u.height, 500);
		assert.equal(input('height-value').textContent, '500px');
		for (const degrees of [0, 90, -90]) {
			await rotate(degrees);
			for (const height of [200, 500, 900]) {
				input('height').value = String(height);
				input('height').dispatchEvent(new Event('input'));
				await Promise.resolve();
				assert.equal(u.height, height);
				assert.equal(u.width, width);
				assert.equal(input('height-value').textContent, `${height}px`);
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

	it('rebuilds orientations with compact horizontal dimensions while preserving data, truncation, and rotation', async () => {
		assert.deepEqual([u.width, u.height], [1200, 500]);
		assert.equal(input('horizontal').checked, false);
		assert.equal(input('height-label').textContent, 'Chart height');
		assert.equal(input('rotation').disabled, false);
		assert.equal(input('rotation').value, '45');
		assert.equal(input('rotation-value').textContent, '45°');
		u.setPxRatio(2);
		await rotate(-30);
		input('max-length').value = '8';
		input('truncate').checked = true;
		input('truncate').dispatchEvent(new Event('change'));
		u = demo.plot;
		await Promise.resolve();

		for (const middle of [false, true]) {
			input('middle-ellipsis').checked = middle;
			input('middle-ellipsis').dispatchEvent(new Event('change'));
			u = demo.plot;
			await Promise.resolve();

			for (const horizontal of [true, false]) {
				const previous = u;
				const data = u.data;
				const dimensions = horizontal ? [u.height, u.width / 4] : [u.height * 4, u.width];
				let destroyed = 0;
				previous.hooks.destroy.push(() => destroyed++);
				input('horizontal').checked = horizontal;
				input('horizontal').dispatchEvent(new Event('change'));
				u = demo.plot;
				await Promise.resolve();

				assert.notEqual(u, previous);
				assert.equal(destroyed, 1, 'destroy the replaced plot exactly once');
				assert.equal(previous.root.isConnected, false);
				assert.equal(root.querySelectorAll('#plot .uplot').length, 1, 'one live chart after each rebuild');
				assert.equal(input('plot').querySelector('.uplot'), u.root);
				assert.equal(u.data, data, 'orientation preserves the exact data reference');
				assert.deepEqual([u.width, u.height], dimensions, 'swap dimensions and scale the category dimension for the new orientation');
				assert.equal(u.pxRatio, 2);
				assert.equal(u.scales.x.ori, horizontal ? 1 : 0);
				assert.equal(u.scales.y.ori, horizontal ? 0 : 1);
				assert.equal(u.axes[0]._rotate, horizontal ? 0 : -30);
				assert.equal(input('rotation').disabled, horizontal);
				assert.equal(input('rotation-value').textContent, horizontal ? '0°' : '-30°');
				if (!horizontal)
					assert.equal(input('rotation').value, '-30', 'restore the remembered vertical rotation');
				assert.equal(input('height-label').textContent, horizontal ? 'Chart width' : 'Chart height');
				assert.equal(input('height').value, String(horizontal ? u.width : u.height));
				assert.equal(input('height-value').textContent, `${horizontal ? u.width : u.height}px`);
				assert.equal(input('truncate').checked, true);
				assert.equal(input('middle-ellipsis').checked, middle);
				assert.equal(input('max-length').value, '8');
				assertTruncated(data[0], 8, middle);

				const current = u;
				const setSize = u.setSize;
				const setData = u.setData;
				let sizes = 0, randomizations = 0;
				u.setSize = (...args) => { sizes++; return setSize(...args); };
				u.setData = (...args) => { randomizations++; return setData(...args); };
				input('height').value = horizontal ? '640' : '700';
				input('height').dispatchEvent(new Event('input'));
				u = demo.plot;
				await Promise.resolve();
				assert.equal(u, current, 'resizing does not rebuild');
				assert.equal(sizes, 1, 'one resize handler after repeated rebuilds');
				assert.deepEqual([u.width, u.height], horizontal ? [640, dimensions[1]] : [dimensions[0], 700]);
				assert.equal(input('height-value').textContent, horizontal ? '640px' : '700px');
				assert.equal(u.data, data);

				await withSeededRandom(async () => {
					input('randomize').click();
					u = demo.plot;
					await Promise.resolve();
				});
				assert.equal(u, current, 'randomization acts on the current plot');
				assert.equal(randomizations, 1, 'one randomize handler after repeated rebuilds');
				assert.notEqual(u.data, data);
				assert.equal(previous.data, data, 'controls do not mutate the replaced plot');
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

	it('destroys the current rebuilt chart and removes every UI control listener', async () => {
		await rotate(-45);
		for (const horizontal of [true, false, true]) {
			input('horizontal').checked = horizontal;
			input('horizontal').dispatchEvent(new Event('change'));
			u = demo.plot;
			await Promise.resolve();
		}
		const current = u;
		const data = u.data;
		const dimensions = [u.width, u.height];
		const labels = u.axes[0]._values.slice();
		const counts = [measurements.x.length, measurements.y.length];
		const readouts = ['rotation-value', 'height-value', 'height-label', 'max-length-value', 'stats'];
		const text = readouts.map(id => input(id).textContent);
		const disabled = ['rotation', 'max-length', 'middle-ellipsis'].map(id => input(id).disabled);
		let destroyed = 0;
		u.hooks.destroy.push(() => destroyed++);
		demo.destroy();
		assert.equal(destroyed, 1);
		assert.equal(current.root.isConnected, false);
		assert.equal(input('plot').querySelectorAll('.uplot').length, 0);

		const calls = [];
		for (const method of ['setData', 'setSize', 'redraw'])
			current[method] = () => calls.push(method);
		input('horizontal').checked = false;
		input('rotation').value = '75';
		input('height').value = '800';
		input('truncate').checked = true;
		input('max-length').value = '4';
		input('middle-ellipsis').checked = true;
		for (const [id, type] of [
			['horizontal', 'change'], ['rotation', 'input'], ['height', 'input'],
			['truncate', 'change'], ['max-length', 'input'], ['middle-ellipsis', 'change'], ['randomize', 'click'],
		]) {
			input(id).dispatchEvent(new Event(type));
			u = demo.plot;
			await Promise.resolve();
		}
		assert.deepEqual(calls, [], 'controls never call into the destroyed plot');
		assert.equal(input('plot').querySelectorAll('.uplot').length, 0, 'orientation cannot recreate a chart after teardown');
		assert.equal(current.data, data);
		assert.deepEqual([current.width, current.height], dimensions);
		assert.deepEqual(current.axes[0]._values, labels);
		assert.deepEqual([measurements.x.length, measurements.y.length], counts);
		assert.deepEqual(readouts.map(id => input(id).textContent), text, 'readouts remain unchanged');
		assert.deepEqual(['rotation', 'max-length', 'middle-ellipsis'].map(id => input(id).disabled), disabled);
		assert.equal(destroyed, 1, 'control actions do not destroy the chart again');
	});

	it('reuses X measurements until labels, font, or pixel ratio changes', async () => {
		const count = u.data[0].length;
		assert.equal(measurements.x.length, count);
		for (const degrees of [-90, -45, 0, 45, 90])
			await rotate(degrees);
		u.setData([u.data[0], u.data[1].map(y => y * 2)]);
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
		u.axes[0].font[0] = u.axes[0].font[0].replace('system-ui', 'serif');
		u.redraw(false, true);
		await Promise.resolve();
		measured += u.data[0].length;
		assert.equal(measurements.x.length, measured);
		await rotate(0);
		assert.equal(measurements.x.length, measured);
	});

	it('measures truncated labels and supports end and middle ellipses', async () => {
		const data = u.data;
		const labels = fullLabels();
		const count = labels.length;
		assert.ok(labels.some(label => label.length > 8), 'exercise truncation');
		assert.ok(labels.some(label => label.length <= 8), 'exercise unchanged short labels');
		await rotate(0);
		assert.equal(input('max-length').disabled, true);
		assert.equal(input('middle-ellipsis').disabled, true);
		input('max-length').value = '8';
		input('truncate').checked = true;
		input('truncate').dispatchEvent(new Event('change'));
		await Promise.resolve();
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
		assert.equal(u.axes[0]._size, Math.ceil(u.axes[0].ticks.size + u.axes[0].gap + longestWidth() + 8));

		input('max-length').value = '4';
		input('max-length').dispatchEvent(new Event('input'));
		await Promise.resolve();
		assert.equal(input('max-length-value').textContent, '4');
		assertTruncated(labels, 4, true);
		assert.equal(measurements.x.length, 4 * count);

		input('truncate').checked = false;
		input('truncate').dispatchEvent(new Event('change'));
		await Promise.resolve();
		assert.deepEqual(u.axes[0]._values, labels);
		assert.deepEqual(fullLabels(), labels);
		assert.equal(measurements.x.length, 5 * count);
		assert.equal(u.data, data);
	});

	it('keeps the cache when truncation controls do not change the labels', async () => {
		input('max-length').value = '20';
		input('truncate').checked = true;
		input('truncate').dispatchEvent(new Event('change'));
		await Promise.resolve();
		input('middle-ellipsis').checked = true;
		input('middle-ellipsis').dispatchEvent(new Event('change'));
		await rotate(0);
		assert.deepEqual(u.axes[0]._values, fullLabels());
		assert.equal(measurements.x.length, u.data[0].length);
	});

	it('fits edge bars within the expanded X range', () => {
		assertDataShape();
		assert.equal(u.series[1].fill(u, 1), 'royalblue');
		assert.equal(u.series[1].width, 0);
		assert.equal(u.series[1].points.show(u, 1), false);
		assertBars();
	});

	it('sizes Y from formatted ticks across mixed-sign magnitudes without remeasuring X', async () => {
		await rotate(33);
		const sizes = [];
		for (const magnitude of [1e-4, 1, 1e8, 1e-4]) {
			const before = measurements.y.length;
			u.setData([u.data[0], u.data[0].map((_, i) => (i - (u.data[0].length - 1) / 2) * magnitude)]);
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
			u.setData([u.data[0], u.data[0].map((_, i) => sign * (i + 1) * 1e-4)]);
			await Promise.resolve();
			assertYAxis();
			assert.equal(sign > 0 ? u.scales.y.min : u.scales.y.max, 0);
			assert.equal(measurements.x.length, u.data[0].length);
		}
	});

	it('invalidates the Y measurement cache for font and DPR changes', async () => {
		u.setData([u.data[0], u.data[0].map((_, i) => i - (u.data[0].length - 1) / 2)]);
		await Promise.resolve();
		assertYAxis();
		let before = measurements.y.length;
		u.axes[1].font[0] += ', monospace';
		assert.notEqual(u.axes[1].font[0], u.axes[0].font[0]);
		u.redraw(false, true);
		await Promise.resolve();
		assert.ok(measurements.y.length > before, 'Y font changes invalidate measurements');
		assert.equal(measurements.x.length, u.data[0].length);
		assertYAxis();

		before = measurements.y.length;
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
				assert.notEqual(u.data[1], previous[1], 'fresh Y values');
				if (i > 0) {
					assert.notDeepEqual(fullLabels(), labels, 'fresh full labels');
					assert.notDeepEqual(u.data[1], previous[1], 'new Y values');
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
		input('max-length').value = '8';
		input('truncate').checked = true;
		input('truncate').dispatchEvent(new Event('change'));
		await rotate(45);
		await withSeededRandom(async () => {
			for (const middle of [false, true]) {
				input('middle-ellipsis').checked = middle;
				input('middle-ellipsis').dispatchEvent(new Event('change'));
				await Promise.resolve();
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
					assert.equal(input('truncate').checked, true);
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
		input('truncate').checked = false;
		input('truncate').dispatchEvent(new Event('change'));
		await Promise.resolve();
		assert.deepEqual(u.axes[0]._values, labels, 'restore current full labels, not the initial labels');
		assert.deepEqual(fullLabels(), labels);
		assert.equal(u.data, data);
		assert.equal(input('max-length').disabled, true);
		assert.equal(input('middle-ellipsis').disabled, true);
		assertReadout();
	});
});
