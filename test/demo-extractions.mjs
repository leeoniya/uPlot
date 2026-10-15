import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import { replay } from '../scripts/replay.mjs';
import uPlot from '../src/uPlot.js';
import arcsinhGroups from '../demos/arcsinh-scales.js';
import pointsGroups from '../demos/points.js';
import axisControlGroups from '../demos/axis-control.js';
import { captureStep } from '../scripts/demoSteps.mjs';
import { withSeededRandom } from '../scripts/withSeededRandom.mjs';

describe('demo extraction support', () => {
	it('adapts decimal-aware labels to vertical zoom and reset in the axis-control demo', async () => {
		const previous = globalThis.uPlot;
		globalThis.uPlot = uPlot;
		try {
			let formatter;
			for (const [step, incr, dec, zoomMax, zoomIncr] of [[0, .25, 2, .1, .025], [1, .00025, 5, .0001, .000025]]) {
				const [plot] = await axisControlGroups[1].steps[step].render();
				try {
					assert.deepEqual(plot.axes[1]._values,
						[0, 1, 2, 3, 4].map(i => `${(i * incr).toFixed(dec)} ms`));
					assert.deepEqual(plot.axes[1].values(plot, [null, 0, incr], 1, 50, incr),
						['', `${(0).toFixed(dec)} ms`, `${incr.toFixed(dec)} ms`]);
					formatter ??= plot.axes[1].values;
					assert.equal(plot.axes[1].values, formatter);
					assert.equal(plot.cursor.drag.x, false);
					assert.equal(plot.cursor.drag.y, true);
					const initialRange = [plot.scales.y.min, plot.scales.y.max];
					const initialLabels = plot.axes[1]._values.slice();
					const xRange = [plot.scales.x.min, plot.scales.x.max];

					plot.setScale('y', {min: 0, max: zoomMax});
					await Promise.resolve();
					assert.deepEqual([plot.scales.y.min, plot.scales.y.max], [0, zoomMax]);
					assert.deepEqual(plot.axes[1]._values,
						[0, 1, 2, 3, 4].map(i => `${(i * zoomIncr).toFixed(dec + 1)} ms`));
					for (const [i, label] of plot.axes[1]._values.entries())
						assert.equal(parseFloat(label), plot.axes[1]._splits[i]);
					assert.equal(new Set(plot.axes[1]._values).size, plot.axes[1]._values.length);
					assert.deepEqual([plot.scales.x.min, plot.scales.x.max], xRange);

					plot.over.dispatchEvent(new MouseEvent('dblclick', {bubbles: true, button: 0}));
					await Promise.resolve();
					assert.deepEqual([plot.scales.y.min, plot.scales.y.max], initialRange);
					assert.deepEqual(plot.axes[1]._values, initialLabels);
				}
				finally { plot.destroy(); }
			}
		}
		finally { globalThis.uPlot = previous; }
	});
	it('repeats the seeded points demo without retaining random-walk state', async () => {
		const previous = globalThis.uPlot;
		globalThis.uPlot = uPlot;

		async function capture() {
			const snapshots = [];
			await withSeededRandom(() => captureStep(pointsGroups[0].steps[0], '0-0', (actual, id) => {
				snapshots.push({ id, actual: JSON.parse(JSON.stringify(actual)) });
			}));
			return snapshots;
		}

		try {
			const first = await capture();
			assert.deepStrictEqual(first.map(snapshot => snapshot.id), ['0-0/0', '0-0/1', '0-0/2', '0-0/3']);
			assert.deepStrictEqual(await capture(), first);
		}
		finally {
			globalThis.uPlot = previous;
		}
	});

	it('records signed-zero drawing arguments consistently with JSON snapshots', () => {
		const ctx = document.createElement('canvas').getContext('2d');
		const path = new Path2D();
		ctx.translate(-0, -0);
		ctx.fillRect(1, 2, 3, -0);
		path.rect(-0, 1, 2, -0);
		ctx.stroke(path);
		assert.deepStrictEqual(ctx.log, [
			['translate', [0, 0]],
			['fillRect', [1, 2, 3, 0]],
			['stroke', [{ log: [['rect', [0, 1, 2, 0]]] }]],
		]);
		assert.deepStrictEqual(ctx.log, JSON.parse(JSON.stringify(ctx.log)));
	});

	it('records every bitmap size assignment in order with methods and properties', () => {
		const canvas = document.createElement('canvas');
		const ctx = canvas.getContext('2d');
		assert.deepStrictEqual(ctx.log, []);
		assert.equal(Object.prototype.propertyIsEnumerable.call(ctx, 'record'), false);

		canvas.width = 40;
		canvas.width = 40;
		canvas.height = 20;
		canvas.height = 20;
		ctx.save();
		ctx.translate(2, 3);
		ctx.fillStyle = 'red';
		canvas.width = 40;
		ctx.fillStyle = 'blue';
		ctx.restore();
		ctx.fillRect(0, 0, 10, 10);
		canvas.height = 20;
		ctx.fillRect(0, 0, 10, 10);
		ctx.save();
		canvas.width = 0;
		ctx.save();
		ctx.restore();
		canvas.height = 0;
		ctx.restore();

		assert.deepStrictEqual(ctx.log, [
			['canvas.width', 40, 40],
			['canvas.height', 20, 20],
			['save', []],
			['translate', [2, 3]],
			['fillStyle', 'red'],
			['canvas.width', 40],
			['fillStyle', 'blue'],
			['restore', []],
			['fillRect', [0, 0, 10, 10]],
			['canvas.height', 20],
			['fillRect', [0, 0, 10, 10]],
			['save', []],
			['canvas.width', 0],
			['save', []],
			['restore', []],
			['canvas.height', 0],
			['restore', []],
		]);
		assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.log)), ctx.log);
		assert.equal(canvas.getContext('2d'), ctx);
		assert.deepStrictEqual([canvas.width, canvas.height, ctx.width, ctx.height], [0, 0, 0, 0]);

		const other = document.createElement('canvas');
		const otherCtx = other.getContext('2d');
		other.width = 7;
		other.height = 9;
		assert.deepStrictEqual(otherCtx.log, [['canvas.width', 7], ['canvas.height', 9]]);
		assert.deepStrictEqual([otherCtx.width, otherCtx.height], [7, 9]);
		assert.deepStrictEqual(ctx.log.at(-1), ['restore', []]);
	});

	it('keeps final bitmap dimensions alongside the resize history in captures', async () => {
		await captureStep({
			async render() {
				const plot = new uPlot({ width: 100, height: 80, pxRatio: 1, series: [{}, {}] }, [[0, 1], [1, 2]], document.body);
				await Promise.resolve();
				plot.setSize({ width: 120, height: 90 });
				return [plot];
			}
		}, 'resize', (actual, id) => {
			assert.equal(id, 'resize');
			assert.deepStrictEqual([actual.width, actual.height], [120, 90]);
			assert.deepStrictEqual(actual.ctxlog.filter(([name]) => name.startsWith('canvas.')), [
				['canvas.width', 100], ['canvas.height', 80],
				['canvas.width', 120], ['canvas.height', 90],
			]);
		});
	});

	it('records alpha assignments with readback and replays grouped values through JSON', () => {
		const canvas = document.createElement('canvas');
		const ctx = canvas.getContext('2d');
		assert.equal(ctx.globalAlpha, 1);
		assert.deepStrictEqual(ctx.log, []);
		assert.equal(Object.prototype.propertyIsEnumerable.call(ctx, 'globalAlpha'), false);

		for (const alpha of [.5, .5, 0, 1]) {
			ctx.globalAlpha = alpha;
			assert.equal(ctx.globalAlpha, alpha);
		}
		ctx.fillRect(0, 0, 10, 10);
		ctx.globalAlpha = .25;
		assert.equal(canvas.getContext('2d').globalAlpha, .25);
		assert.equal(document.createElement('canvas').getContext('2d').globalAlpha, 1);
		assert.deepStrictEqual(ctx.log, [
			['globalAlpha', .5, .5, 0, 1],
			['fillRect', [0, 0, 10, 10]],
			['globalAlpha', .25],
		]);

		const commands = JSON.parse(JSON.stringify(ctx.log));
		assert.deepStrictEqual(commands, ctx.log);
		const assignments = [];
		const draws = [];
		replay(commands, {
			set globalAlpha(value) { assignments.push(value); },
			fillRect(...args) { draws.push(args); },
		});
		assert.deepStrictEqual(assignments, [.5, .5, 0, 1, .25]);
		assert.deepStrictEqual(draws, [[0, 0, 10, 10]]);
	});

	it('preserves alpha save/restore ordering for replay without extra assignments', () => {
		const ctx = document.createElement('canvas').getContext('2d');
		ctx.globalAlpha = .5;
		ctx.save();
		ctx.globalAlpha = 0;
		ctx.fillRect(0, 0, 10, 10);
		ctx.restore();
		ctx.fillRect(0, 0, 10, 10);
		assert.deepStrictEqual(ctx.log, [
			['globalAlpha', .5],
			['save', []],
			['globalAlpha', 0],
			['fillRect', [0, 0, 10, 10]],
			['restore', []],
			['fillRect', [0, 0, 10, 10]],
		]);

		const stack = [];
		const draws = [];
		replay(JSON.parse(JSON.stringify(ctx.log)), {
			globalAlpha: 1,
			save() { stack.push(this.globalAlpha); },
			restore() { this.globalAlpha = stack.pop(); },
			fillRect() { draws.push(this.globalAlpha); },
		});
		assert.deepStrictEqual(draws, [0, .5]);
		assert.deepStrictEqual(stack, []);
	});

	it('records and replays gradient styles through JSON', () => {
		const ctx = document.createElement('canvas').getContext('2d');
		const gradient = ctx.createLinearGradient(0, 0, 100, 0);
		assert.equal(Object.prototype.propertyIsEnumerable.call(ctx, 'createLinearGradient'), false);
		assert.equal(Object.prototype.propertyIsEnumerable.call(gradient, 'addColorStop'), false);
		assert.deepStrictEqual(gradient.log, []);
		gradient.addColorStop(0, 'red');
		gradient.addColorStop(1, 'blue');
		ctx.fillStyle = gradient;
		ctx.strokeStyle = gradient;

		const commands = JSON.parse(JSON.stringify(ctx.log));
		assert.deepStrictEqual(ctx.log, commands);
		assert.deepStrictEqual(commands[0][1], {
			type: 'linearGradient',
			args: [0, 0, 100, 0],
			log: [['addColorStop', [0, 'red'], [1, 'blue']]],
		});

		const gradients = [];
		const target = {
			createLinearGradient(...args) {
				const result = { args, stops: [], addColorStop(...stop) { this.stops.push(stop); } };
				gradients.push(result);
				return result;
			},
		};
		replay(commands, target);
		assert.equal(gradients.length, 2);
		assert.equal(target.fillStyle, gradients[0]);
		assert.equal(target.strokeStyle, gradients[1]);
		for (const result of gradients) {
			assert.deepStrictEqual(result.args, [0, 0, 100, 0]);
			assert.deepStrictEqual(result.stops, [[0, 'red'], [1, 'blue']]);
		}
	});

	it('keeps the arcsinh slider working when page controls are present', async () => {
		const previous = globalThis.uPlot;
		globalThis.uPlot = uPlot;
		const label = document.createElement('label');
		label.id = 'thresh-label';
		const input = document.createElement('input');
		input.id = 'linthresh';
		input.type = 'range';
		input.min = '-3';
		input.max = '3';
		input.value = '0';
		document.body.append(label, input);
		let plot;
		try {
			[plot] = await arcsinhGroups[0].steps[0].render();
			const asinh = plot.scales.y.asinh;
			assert.equal(asinh(plot, 'y'), 1);
			for (const value of ['-3', '3', '0']) {
				input.value = value;
				input.dispatchEvent(new Event('input'));
				await Promise.resolve();
				const threshold = 10 ** Number(value);
				assert.equal(plot.scales.y.asinh, asinh);
				assert.equal(asinh(plot, 'y'), threshold);
				assert.equal(plot.scales.y._asinh, threshold);
				assert.equal(label.textContent, 'Linear threshold: ' + threshold);
				assert.equal(plot.scales.y._min, Math.asinh(plot.scales.y.min / threshold));
				assert.equal(plot.scales.y._max, Math.asinh(plot.scales.y.max / threshold));
			}
		}
		finally {
			plot?.destroy();
			input.remove();
			label.remove();
			globalThis.uPlot = previous;
		}
	});

	it('slices the adaptive arcsinh data and restores it without changing the manual plot', async () => {
		const previous = globalThis.uPlot;
		globalThis.uPlot = uPlot;
		const label = document.createElement('label');
		label.id = 'slice-label';
		label.textContent = 'Minimum absolute Y value: 0.001';
		const input = document.createElement('input');
		input.id = 'data-min';
		input.type = 'range';
		input.min = '-3';
		input.max = '2';
		input.step = '1';
		input.value = '-3';
		const readout = document.createElement('span');
		readout.id = 'adaptive-threshold';
		document.body.append(label, input, readout);
		const positive = Array.from({ length: 54 }, (_, i) =>
			Number(`${i % 9 + 1}e${Math.floor(i / 9) - 3}`)).concat(1000);
		const values = positive.slice().reverse().map(v => -v).concat(positive);
		const data = [values.map((value, i) => i + 1), values];
		let manual;
		let plot;
		try {
			[manual] = await arcsinhGroups[0].steps[0].render();
			[plot] = await arcsinhGroups[1].steps[0].render();
			const manualData = manual.data.map(values => values.slice());
			const manualAsinh = manual.scales.y.asinh;
			const asinh = plot.scales.y.asinh;
			assert.equal(typeof asinh, 'function');

			function checkState(threshold) {
				assert.deepStrictEqual(plot.data, data.map(column => column.filter((v, i) => Math.abs(values[i]) >= threshold)));
				assert.ok(plot.data[1].includes(-threshold));
				assert.ok(plot.data[1].includes(threshold));
				assert.equal(plot.scales.x.min, 1);
				assert.equal(plot.scales.x.max, 110);
				assert.equal(plot.scales.y.min, -1000);
				assert.equal(plot.scales.y.max, 1000);
				assert.equal(plot.scales.y.asinh, asinh);
				assert.equal(asinh(plot, 'y'), threshold);
				assert.equal(plot.scales.y._asinh, threshold);
				assert.equal(plot.scales.y._min, Math.asinh(plot.scales.y.min / threshold));
				assert.equal(plot.scales.y._max, Math.asinh(1000 / threshold));
				assert.equal(label.textContent, 'Minimum absolute Y value: ' + threshold);
				assert.equal(readout.textContent, 'Adaptive linear threshold: ' + threshold);
				assert.deepStrictEqual(manual.data, manualData);
				assert.equal(manual.scales.y.asinh, manualAsinh);
				assert.equal(manualAsinh(manual, 'y'), 1);
				assert.equal(manual.scales.y._asinh, 1);
			}

			checkState(0.001);
			for (const [value, threshold] of [
				['-3', 0.001],
				['0', 1],
				['2', 100],
				['-2', 0.01],
				['-3', 0.001],
			]) {
				input.value = value;
				input.dispatchEvent(new Event('input'));
				await Promise.resolve();
				checkState(threshold);
			}
			assert.deepStrictEqual(plot.data, data);
		}
		finally {
			plot?.destroy();
			manual?.destroy();
			input.remove();
			label.remove();
			readout.remove();
			globalThis.uPlot = previous;
		}
	});
});
