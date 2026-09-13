import assert from 'node:assert/strict';
import '../scripts2/instrument.mjs';
import { replay } from '../scripts2/replay.mjs';
import uPlot from '../src/uPlot.js';
import arcsinhGroups from '../demos/arcsinh-scales.js';

describe('demo extraction support', () => {
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
			assert.equal(plot.scales.y.asinh, 1);
			for (const value of ['-3', '3', '0']) {
				input.value = value;
				input.dispatchEvent(new Event('input'));
				const threshold = 10 ** Number(value);
				assert.equal(plot.scales.y.asinh, threshold);
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
});
