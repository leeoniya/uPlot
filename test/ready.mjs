import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';

const data = [[0, 50, 100], [0, 50, 100]];
const plots = [];

function frame(u) {
	const canvas = u.root.querySelector('canvas');
	return {
		bitmap: [canvas.width, canvas.height],
		bbox: { ...u.bbox },
		fonts: u.axes.map(axis => [axis.font.slice(), axis.labelFont.slice()]),
		dom: [u.over.style.left, u.over.style.top, u.over.style.width, u.over.style.height],
		x: [u.scales.x.min, u.scales.x.max],
		y: [u.scales.y.min, u.scales.y.max],
	};
}

function calls(u, name) {
	return u.ctx.log.filter(entry => entry[0] == name).flatMap(entry => entry.slice(1));
}

function plot(onReady, options = {}) {
	const trace = { ready: 0, draws: [], sizes: [], bitmap: { width: [], height: [] } };
	let resolve, reject;
	const ready = new Promise((yes, no) => {
		resolve = yes;
		reject = no;
	});
	const callbacks = Array.isArray(onReady) ? onReady : [onReady];
	const u = new uPlot({
		width: 600,
		height: 400,
		pxRatio: 1,
		padding: [0, 0, 0, 0],
		cursor: { show: false },
		legend: { show: false },
		series: [{}, { stroke: 'blue', points: { show: false } }],
		scales: { x: { time: false }, y: { range: () => [0, 100] } },
		axes: [
			{ size: 30, font: '12px sans-serif', label: 'X', labelFont: '14px sans-serif', labelSize: 20 },
			{ size: 40, font: '12px sans-serif', label: 'Y', labelFont: '14px sans-serif', labelSize: 20 },
		],
		...options,
		hooks: {
			draw: [self => trace.draws.push(frame(self))],
			setSize: [self => trace.sizes.push(frame(self))],
			ready: [
				() => trace.ready++,
				...callbacks.map(callback => self => {
					try {
						callback(self, trace);
					}
					catch (error) {
						reject(error);
					}
				}),
				() => resolve(),
			],
		},
	}, data, (self, init) => {
		self.ctx.measureText = text => ({ width: String(text).length * 8 * self.pxRatio });
		// The shared canvas mock forwards dimension writes to these properties.
		for (const key of ['width', 'height']) {
			let value = self.ctx[key];
			Object.defineProperty(self.ctx, key, {
				get: () => value,
				set(next) {
					trace.bitmap[key].push(next);
					value = next;
				},
			});
		}
		document.body.appendChild(self.root);
		init();
	});
	plots.push(u);
	return { u, trace, ready };
}

function assertDraws(u, trace, count) {
	assert.equal(trace.ready, 1, 'ready fires only once');
	assert.equal(trace.draws.length, count, 'draw hooks');
	assert.equal(calls(u, 'clearRect').length, count, 'actual canvas draws');
}

describe('ready commit timing', () => {
	afterEach(() => {
		for (const u of plots)
			u.destroy();
		plots.length = 0;
	});

	it('defers ready setPxRatio until a new commit, then updates bitmap, fonts, and layout without redraw', async () => {
		let before;
		const { u, trace, ready } = plot(self => {
			assert.equal(self.status, 1);
			assert.equal(self.pxRatio, 1);
			before = frame(self);
			self.setPxRatio(4);
			assert.equal(self.pxRatio, 4, 'requested ratio is public immediately');
			assert.deepEqual(frame(self), before, 'canvas, fonts, and geometry remain committed to ratio 1');
		});
		await ready;
		await Promise.resolve();
		const after = frame(u);
		assert.deepEqual(after.bitmap, [2400, 1600]);
		assert.deepEqual(after.bbox, Object.fromEntries(Object.entries(before.bbox).map(([key, value]) => [key, value * 4])));
		assert.deepEqual(after.dom, before.dom, 'CSS geometry is unchanged');
		for (let i = 0; i < u.axes.length; i++) {
			for (let j = 0; j < 2; j++) {
				assert.equal(after.fonts[i][j][1], before.fonts[i][j][1] * 4);
				assert.notEqual(after.fonts[i][j][0], before.fonts[i][j][0]);
				assert.ok(calls(u, 'font').includes(after.fonts[i][j][0]), 'scaled font reaches the canvas');
			}
		}
		assert.deepEqual(trace.bitmap, { width: [600, 2400], height: [400, 1600] });
		assert.equal(trace.sizes.length, 2);
		assertDraws(u, trace, 2);
		await Promise.resolve();
		assertDraws(u, trace, 2);
	});

	it('coalesces setters from multiple ready hooks into one final draw', async () => {
		const { u, trace, ready } = plot([
			self => {
				self.setPxRatio(2);
				self.setSize({ width: 640, height: 420 });
			},
			self => {
				self.setPxRatio(3);
				self.setScale('x', { min: 10, max: 90 });
				self.setPxRatio(4);
				self.setSize({ width: 700, height: 450 });
				assert.deepEqual(frame(self).bitmap, [600, 400]);
			},
		]);
		await ready;
		await Promise.resolve();
		assert.deepEqual(frame(u).bitmap, [2800, 1800]);
		assert.deepEqual(frame(u).x, [10, 90]);
		assert.deepEqual(trace.bitmap, { width: [600, 2800], height: [400, 1800] });
		assert.equal(trace.sizes.length, 2);
		assertDraws(u, trace, 2);
	});

	it('does not schedule another draw for an unchanged ready pixel ratio', async () => {
		const { u, trace, ready } = plot(self => {
			self.setPxRatio(1);
			self.setPxRatio(1);
		});
		await ready;
		await Promise.resolve();
		assert.deepEqual(trace.bitmap, { width: [600], height: [400] });
		assert.equal(trace.sizes.length, 1);
		assertDraws(u, trace, 1);
	});

	it('commits ready setSize and setScale asynchronously', async () => {
		const { u, trace, ready } = plot(self => {
			const before = frame(self);
			self.setSize({ width: 720, height: 480 });
			self.setScale('x', { min: 25, max: 75 });
			self.setScale('y', { min: 10, max: 90 });
			assert.deepEqual(frame(self), before);
		});
		await ready;
		await Promise.resolve();
		assert.deepEqual(frame(u).bitmap, [720, 480]);
		assert.deepEqual(frame(u).x, [25, 75]);
		assert.deepEqual(frame(u).y, [10, 90]);
		assert.equal(u.valToPos(75, 'x', true), u.bbox.left + u.bbox.width);
		assertDraws(u, trace, 2);
	});

	it('resets the auto-scale flag before an explicit X scale in a ready batch', async () => {
		const flags = [];
		let initial;
		const { u, trace, ready } = plot(self => {
			initial = frame(self).y;
			assert.ok(flags.includes(true), 'initial data uses auto-scale');
			flags.length = 0;
			self.batch(() => self.setScale('x', { min: 25, max: 75 }));
			assert.ok(flags.length > 0, 'explicit X consults the dependent scale auto policy');
			assert.ok(flags.every(flag => flag === false), 'explicit X is not an auto reset');
			assert.deepEqual(frame(self).y, initial, 'auto-reset-only Y retains its range');
		}, {
			scales: {
				x: { time: false },
				y: {
					auto: (self, viaAutoScaleX) => {
						flags.push(viaAutoScaleX);
						return viaAutoScaleX;
					},
				},
			},
		});
		await ready;
		await Promise.resolve();
		assert.deepEqual(frame(u).x, [25, 75]);
		assert.deepEqual(frame(u).y, initial);
		assertDraws(u, trace, 2);
	});

	it('finishes cache.paths:false cleanup before ready and preserves newly queued work', async () => {
		const { u, trace, ready } = plot(self => {
			assert.equal(self.series[1]._paths, null, 'initial path cleanup precedes ready');
			self.batch(() => self.setPxRatio(2));
			assert.equal(self.series[1]._paths, null, 'batch also clears its own paths');
			self.setPxRatio(4);
			assert.deepEqual(frame(self).bitmap, [1200, 800]);
		}, { cache: { paths: false } });
		await ready;
		await Promise.resolve();
		assert.deepEqual(frame(u).bitmap, [2400, 1600]);
		assert.deepEqual(trace.bitmap, { width: [600, 1200, 2400], height: [400, 800, 1600] });
		assert.equal(u.series[1]._paths, null);
		assertDraws(u, trace, 3);
	});

	for (const deferHooks of [false, true]) {
		it(`flushes a ready batch synchronously without a duplicate draw (deferHooks: ${deferHooks})`, async () => {
			const { u, trace, ready } = plot((self, events) => {
				self.setPxRatio(2);
				self.batch(() => {
					self.setPxRatio(4);
					self.setSize({ width: 700, height: 450 });
				}, deferHooks);
				assert.deepEqual(frame(self).bitmap, [2800, 1800], 'batch commits before returning');
				assert.equal(calls(self, 'clearRect').length, 2, 'batch draws synchronously');
				assert.equal(events.draws.length, deferHooks ? 1 : 2);
				assert.equal(events.sizes.length, deferHooks ? 1 : 2);
			});
			await ready;
			await Promise.resolve();
			assertDraws(u, trace, 2);
			assert.equal(trace.sizes.length, 2, 'deferred hooks flush once');
			assert.deepEqual(trace.bitmap, { width: [600, 2800], height: [400, 1800] });
			await Promise.resolve();
			assertDraws(u, trace, 2);
		});
	}

	it('does not let the outer commit or an obsolete batch callback consume later ready work', async () => {
		let atMarker;
		const { u, trace, ready } = plot(self => {
			self.setPxRatio(2);
			self.batch(() => self.setPxRatio(3));
			queueMicrotask(() => {
				atMarker = frame(self).bitmap;
			});
			self.setPxRatio(4);
		});
		await ready;
		await Promise.resolve();
		assert.deepEqual(atMarker, [1800, 1200], 'obsolete callback must not run the newer request before the marker');
		assert.deepEqual(frame(u).bitmap, [2400, 1600]);
		assert.deepEqual(trace.bitmap, { width: [600, 1800, 2400], height: [400, 1200, 1600] });
		assertDraws(u, trace, 3);
		await Promise.resolve();
		assertDraws(u, trace, 3);
	});
});
