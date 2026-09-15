import assert from 'node:assert/strict';
import '../scripts2/instrument.mjs';
import { replay } from '../scripts2/replay.mjs';
import uPlot from '../src/uPlot.js';
import arcsinhGroups from '../demos/arcsinh-scales.js';
import pointsGroups from '../demos/points.js';
import { captureStep } from '../scripts2/demoSteps.mjs';
import { withSeededRandom } from '../scripts2/withSeededRandom.mjs';

describe('demo extraction support', () => {
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
