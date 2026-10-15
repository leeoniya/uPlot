import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import { replay } from '../scripts/replay.mjs';
import uPlot from '../src/uPlot.js';

const operations = path => path.log.flatMap(([name, ...entries]) => entries.map(args => [name, ...args]));

// Independent replay target: do not use the recorder's grouping or copy logic.
class ReplayPath {
	ops = [];
	moveTo(...args) { this.ops.push(['moveTo', ...args]); }
	lineTo(...args) { this.ops.push(['lineTo', ...args]); }
	bezierCurveTo(...args) { this.ops.push(['bezierCurveTo', ...args]); }
	addPath(path) { this.ops.push(...path.ops); }
}

function replayPaths(ctx) {
	const commands = JSON.parse(JSON.stringify(ctx.log));
	const recordedPath = globalThis.Path2D;
	const draws = [];
	try {
		globalThis.Path2D = ReplayPath;
		replay(commands, {
			fill(path) { draws.push(['fill', path.ops]); },
			clip(path) { draws.push(['clip', path.ops]); },
		});
	}
	finally {
		globalThis.Path2D = recordedPath;
	}
	return draws;
}

describe('Path2D recorder', () => {
	it('copies empty paths without sharing later operations', () => {
		const source = new Path2D();
		const copy = new Path2D(source);
		assert.deepStrictEqual(copy.log, []);
		assert.notEqual(copy.log, source.log);
		copy.moveTo(1, 2);
		source.lineTo(3, 4);
		assert.deepStrictEqual(copy.log, [['moveTo', [1, 2]]]);
		assert.deepStrictEqual(source.log, [['lineTo', [3, 4]]]);
	});

	it('copies grouped operations and resumes compression independently', () => {
		const source = new Path2D();
		source.moveTo(0, 0);
		source.lineTo(10, 20);
		source.lineTo(30, 40);
		const initial = structuredClone(source.log);
		const copy = new Path2D(source);
		assert.deepStrictEqual(copy.log, initial);
		for (let i = 0; i < source.log.length; i++) {
			assert.notEqual(copy.log[i], source.log[i]);
			for (let j = 1; j < source.log[i].length; j++)
				assert.notEqual(copy.log[i][j], source.log[i][j]);
		}
		assert.equal(Object.prototype.propertyIsEnumerable.call(copy, 'lineTo'), false);

		copy.lineTo(50, 60);
		assert.deepStrictEqual(source.log, initial);
		source.lineTo(70, 80);
		copy.closePath();
		copy.closePath();
		copy.lineTo(90, 100);
		assert.deepStrictEqual(source.log, [
			['moveTo', [0, 0]], ['lineTo', [10, 20], [30, 40], [70, 80]],
		]);
		assert.deepStrictEqual(copy.log, [
			['moveTo', [0, 0]], ['lineTo', [10, 20], [30, 40], [50, 60]],
			['closePath', [], []], ['lineTo', [90, 100]],
		]);

		const secondCopy = new Path2D(copy);
		secondCopy.lineTo(110, 120);
		assert.deepStrictEqual(secondCopy.log.at(-1), ['lineTo', [90, 100], [110, 120]]);
		assert.deepStrictEqual(copy.log.at(-1), ['lineTo', [90, 100]]);
	});

	it('detaches nested addPath geometry and mutable arguments at copy time', () => {
		const leaf = new Path2D();
		leaf.moveTo(1, 2);
		leaf.lineTo(3, 4);
		const branch = new Path2D();
		branch.addPath(leaf);
		const source = new Path2D();
		source.addPath(branch);
		const copy = new Path2D(source);
		const initial = structuredClone(source.log);

		leaf.lineTo(5, 6);
		branch.lineTo(7, 8);
		source.lineTo(9, 10);
		assert.deepStrictEqual(copy.log, initial);
		copy.lineTo(11, 12);
		assert.deepStrictEqual(source.log.at(-1), ['lineTo', [9, 10]]);
		const ctx = document.createElement('canvas').getContext('2d');
		ctx.fill(copy);
		assert.deepStrictEqual(replayPaths(ctx), [
			['fill', [['moveTo', 1, 2], ['lineTo', 3, 4], ['lineTo', 11, 12]]],
		]);

		const rounded = new Path2D();
		rounded.roundRect(0, 0, 10, 20, [1, 2]);
		const roundedCopy = new Path2D(rounded);
		roundedCopy.log[0][1][4][0] = 3;
		assert.deepStrictEqual(rounded.log[0][1][4], [1, 2]);
	});

	for (const kind of ['linear', 'spline', 'stepped']) {
		it(`replays ${kind} fill and band clip geometry through JSON`, async () => {
			const paths = uPlot.paths[kind]({});
			const data = [[0, 1, 2], [6, 8, 5], [2, 4, 1]];
			const plot = new uPlot({
				width: 400, height: 300, pxRatio: 1,
				axes: [], cursor: {show: false}, legend: {show: false},
				scales: {x: {time: false, range: [0, 2]}, y: {range: [0, 10]}},
				series: [{}, ...data.slice(1).map(() => ({
					paths, stroke: 'black', fill: 'red', fillTo: () => 0, points: {show: false},
				}))],
				bands: [{series: [1, 2]}],
			}, data, document.body);
			try {
				await Promise.resolve();
				const upper = paths(plot, 1, 0, 2);
				const lower = paths(plot, 2, 0, 2);
				const upperStroke = operations(upper.stroke);
				const lowerStroke = operations(lower.stroke);
				assert.ok(upperStroke.length >= 3);
				assert.ok(lowerStroke.length >= 3);
				if (kind === 'spline')
					assert.ok(upperStroke.some(([name]) => name === 'bezierCurveTo'));
				const x = value => Math.round(plot.valToPos(value, 'x', true));
				const y = value => Math.round(plot.valToPos(value, 'y', true));
				const expected = [
					['fill', [...upperStroke, ['lineTo', x(2), y(0)], ['lineTo', x(0), y(0)]]],
					['clip', [...lowerStroke, ['lineTo', x(2), y(10)], ['lineTo', x(0), y(10)], ['lineTo', x(0), y(2)]]],
				];
				const ctx = document.createElement('canvas').getContext('2d');
				ctx.fill(upper.fill);
				ctx.clip(lower.band);
				assert.deepStrictEqual(replayPaths(ctx), expected);

				upper.stroke.lineTo(-10, -20);
				lower.stroke.lineTo(-30, -40);
				assert.deepStrictEqual(replayPaths(ctx), expected, 'later stroke edits must not change copied areas');
			}
			finally {
				plot.destroy();
			}
		});
	}
});
