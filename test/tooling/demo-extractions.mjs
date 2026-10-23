import assert from 'node:assert/strict';
import '../../scripts/instrument.mjs';
import { replay } from '../../scripts/replay.mjs';
import uPlot from '../../src/uPlot.js';
import { captureStep } from '../../scripts/demoSteps.mjs';

describe('demo extraction support', () => {
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
});
