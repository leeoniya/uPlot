import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {Window} from 'happy-dom';

const packed = Object.freeze(JSON.parse(readFileSync(new URL('../../bench/data.json', import.meta.url))));
const vendor = new URL('../../.cache/benchmarks/d3-7.9.0-dist-d3.min.js', import.meta.url);
const ratio = 1.5;
const round = value => (Math.round(value * ratio) + 0.5) / ratio;

// Use the cached browser distribution, or an already installed ESM package. Never fetch.
async function loadD3() {
	if (existsSync(vendor)) {
		const sandbox = {};
		runInNewContext(readFileSync(vendor, 'utf8'), sandbox);
		return sandbox.d3;
	}
	try {
		return await import('d3');
	}
	catch (error) {
		if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
		return null;
	}
}

function scales(d3, [xs, cpu, ram, tcp]) {
	return [
		d3.scaleTime().domain([xs[0], xs.at(-1)]).range([55, 1850]),
		d3.scaleLinear().domain([Math.min(d3.min(cpu), d3.min(ram)), Math.max(d3.max(cpu), d3.max(ram))])
			.nice().range([570, 10]),
		d3.scaleLinear().domain(d3.extent(tcp)).nice().range([570, 10]),
	];
}

function checkPaths(host, d3, data) {
	const [x, pct, mb] = scales(d3, data);
	const paths = [...host.querySelectorAll('.series path')];
	assert.equal(paths.length, 3);
	assert.deepEqual(paths.map(path => path.getAttribute('stroke')), ['red', 'blue', 'green']);
	for (const [i, scale] of [pct, pct, mb].entries()) {
		const expected = d3.line().defined(value => value != null)
			.x((value, j) => round(x(data[0][j]))).y(value => round(scale(value))).digits(null)(data[i + 1]);
		assert.equal(paths[i].getAttribute('d'), expected);
	}
	return paths;
}

function checkAxes(host, d3, data) {
	const [x, pct, mb] = scales(d3, data);
	for (const [name, scale, format, position] of [
		['pct', pct, tick => `${+tick.toFixed(1)}%`, 47],
		['mb', mb, tick => `${+tick.toFixed(2)} MB`, 1858],
	]) {
		const labels = [...host.querySelectorAll(`.axis-${name} text`)];
		assert.deepEqual(labels.map(node => node.textContent), Array.from(scale.ticks(10), format));
		assert.deepEqual(labels.map(node => +node.getAttribute('y')), Array.from(scale.ticks(10), scale));
		assert.ok(labels.every(node => +node.getAttribute('x') === position));
	}
	const labels = [...host.querySelectorAll('.axis-x text')];
	assert.deepEqual(labels.map(node => node.textContent), Array.from(x.ticks(12), x.tickFormat(12)));
	assert.deepEqual(labels.map(node => +node.getAttribute('x')), Array.from(x.ticks(12), tick => round(x(tick))));
	const grid = [...host.querySelectorAll('.grid line')];
	assert.deepEqual(grid.map(node => +node.getAttribute('y1')), Array.from(pct.ticks(10), tick => round(pct(tick))));
	assert.ok(grid.every(node => node.getAttribute('x1') === '55' && node.getAttribute('x2') === '1850' &&
		node.getAttribute('y1') === node.getAttribute('y2')));
}

describe('D3 SVG and Canvas benchmarks (real D3, offline)', function() {
	this.timeout(10000);
	const originals = new Map();
	let d3, canvas, minmax, svg, svgMinmax, data, window, host, wait, chart, frames, nextFrame, originalGetContext;

	before(async function() {
		d3 = await loadD3();
		if (!d3) {
			console.warn('D3 SVG tests need cached D3 7.9.0 or an installed d3 package.');
			this.skip();
		}
		for (const name of ['d3', 'devicePixelRatio', 'requestAnimationFrame', 'cancelAnimationFrame', 'document'])
			originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
		globalThis.d3 = d3;
		globalThis.devicePixelRatio = ratio;
		const documentDescriptor = originals.get('document');
		Object.defineProperty(globalThis, 'document', {configurable: true, value: new Proxy({}, {
			get() { assert.fail('module import must not construct DOM'); },
		})});
		try {
			canvas = await import('../../bench/d3.mjs');
			svg = await import('../../bench/d3-svg.mjs');
			minmax = await import('../../bench/d3-minmax.mjs');
			svgMinmax = await import('../../bench/d3-svg-minmax.mjs');
		}
		finally {
			if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor);
			else delete globalThis.document;
		}
		data = Object.freeze(svg.prepData(packed).map(Object.freeze));
	});

	after(() => {
		for (const [name, descriptor] of originals) {
			if (descriptor) Object.defineProperty(globalThis, name, descriptor);
			else delete globalThis[name];
		}
	});

	beforeEach(() => {
		window = new Window();
		host = window.document.createElement('div');
		host.innerHTML = '<h3>Server Events</h3><div class="legend">' +
			'<span id="cpu-value">CPU: --</span><span id="ram-value">RAM: --</span>' +
			'<span id="tcp-value">TCP Out: --</span></div>' +
			'<div class="chart"><svg id="plot" width="1920" height="600"></svg></div>';
		window.document.body.append(host);
		originalGetContext = window.HTMLCanvasElement.prototype.getContext;
		window.HTMLCanvasElement.prototype.getContext = () => assert.fail('SVG must not use Canvas');
		wait = {textContent: 'Rendering...'};
		frames = new Map();
		nextFrame = 0;
		globalThis.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
		globalThis.cancelAnimationFrame = id => { assert.ok(frames.delete(id)); };
	});

	afterEach(async () => {
		chart?.destroy();
		chart = null;
		assert.equal(frames.size, 0);
		window.HTMLCanvasElement.prototype.getContext = originalGetContext;
		await window.happyDOM.close();
	});

	function flush() {
		const pending = [...frames.values()];
		frames.clear();
		pending.forEach(callback => callback());
	}

	function move(x, overlay = host.querySelector('.overlay')) {
		const plot = host.querySelector('#plot');
		// happy-dom has no SVG matrixTransform implementation. Supply the browser
		// geometry API for a translated, 2x-scaled SVG; D3 still converts the event.
		plot.createSVGPoint = () => ({x: 0, y: 0, matrixTransform(matrix) {
			return {x: this.x * matrix.a + matrix.e, y: this.y * matrix.d + matrix.f};
		}});
		plot.getScreenCTM = () => ({inverse: () => ({a: 0.5, d: 0.5, e: -160, f: -50})});
		const event = new window.PointerEvent('pointermove', {bubbles: true, clientX: x * 2 + 320, clientY: 200});
		Object.defineProperty(event, 'offsetX', {value: -999});
		overlay.dispatchEvent(event);
	}

	it('shares prep and preserves every input field and all 55,550 rows', () => {
		assert.equal(svg.prepData, canvas.prepData);
		assert.equal(data.length, 4);
		assert.ok(data.every(column => column.length === 55550));
		for (let j = 0; j < 55550; j++) {
			const i = packed[0] + 1 + j * packed[0];
			assert.equal(data[0][j], packed[i] * 60000);
			assert.equal(data[1][j], Math.round((100 - packed[i + 1]) * 1000) / 1000);
			assert.equal(data[2][j], Math.round(100 * packed[i + 5] / (packed[i + 5] + packed[i + 6]) * 100) / 100);
			assert.equal(data[3][j], packed[i + 3]);
		}
		const irregular = Object.freeze([7, 'epoch', 'idl', 'recv', 'send', 'writ', 'used', 'free',
			10, 87.6543, 0, 3, 0, 1, 2, 17, 50, 0, 6, 0, 25, 75]);
		assert.deepEqual(svg.prepData(irregular), [[600000, 1020000], [12.346, 50], [33.33, 25], [3, 6]]);
	});

	it('draws three full connected native paths, automatic dual axes and calendar ticks without Canvas', async () => {
		const runtime = Object.freeze({renderer: 'canvas'});
		chart = svg.makeChart(data, host, wait, runtime);
		assert.equal(wait.textContent, 'Rendering...');
		await Promise.resolve();
		assert.equal(wait.textContent, 'Done!');
		assert.equal(host.querySelectorAll('canvas').length, 0);
		assert.equal(host.querySelector('svg').getAttribute('width'), '1920');
		assert.equal(host.querySelector('svg').getAttribute('height'), '600');
		const paths = checkPaths(host, d3, data);
		for (const path of paths) {
			assert.equal((path.getAttribute('d').match(/M/g) || []).length, 1);
			assert.equal((path.getAttribute('d').match(/L/g) || []).length, 55549);
		}
		checkAxes(host, d3, data);
		const group = host.querySelector('.series');
		assert.equal(group.getAttribute('fill'), 'none');
		assert.equal(+group.getAttribute('stroke-width'), 1 / ratio);
		const clip = host.querySelector('clipPath');
		assert.equal(group.getAttribute('clip-path'), `url(#${clip.id})`);
		assert.equal(clip.getAttribute('clipPathUnits'), 'userSpaceOnUse');
		const rect = clip.querySelector('rect');
		assert.deepEqual(['x', 'y', 'width', 'height'].map(key => +rect.getAttribute(key)), [55, 10, 1795, 560]);
		assert.equal(host.querySelector('.overlay').getAttribute('pointer-events'), 'all');
		assert.equal(host.querySelector('.d3-svg-chart').lastElementChild, host.querySelector('.overlay'));
	});

	for (const variant of ['svg', 'svg-minmax']) it(`${variant} uses the same automatic scales for non-percentage ranges and preserves null gaps`, async () => {
		const input = Object.freeze([[0, 60000, 900000, 1800000], [125, null, 160, 180],
			[220, 230, 240, 250], [1500, 2000, null, 3500]].map(Object.freeze));
		chart = (variant === 'svg' ? svg : svgMinmax).makeChart(input, host, wait);
		await Promise.resolve();
		checkPaths(host, d3, input);
		checkAxes(host, d3, input);
		const [x] = scales(d3, input);
		move(x(60000));
		flush();
		assert.equal(host.querySelector('#cpu-value').textContent, 'CPU: --');
		assert.equal(host.querySelector('#ram-value').textContent, 'RAM: 230.0%');
		assert.equal(host.querySelector('#tcp-value').textContent, 'TCP Out: 2000.00 MB');
		assert.equal(host.querySelector('.cursor circle').getAttribute('display'), 'none');
	});

	for (const variant of ['svg', 'svg-minmax']) it(`${variant} uses SVG-local pointer coordinates, coalesces frames, draws SVG markers, and cleans up`, async () => {
		const adapter = variant === 'svg' ? svg : svgMinmax;
		chart = adapter.makeChart(data, host, wait);
		await Promise.resolve();
		const [x, pct, mb] = scales(d3, data);
		const overlay = host.querySelector('.overlay');
		const cursor = host.querySelector('.cursor');
		assert.equal(cursor.getAttribute('display'), 'none');
		const idx = 12345;
		move(1000);
		move(x(data[0][idx]));
		assert.equal(frames.size, 1);
		flush();
		assert.equal(cursor.getAttribute('display'), null);
		assert.equal(+cursor.querySelector('line').getAttribute('x1'), round(x(data[0][idx])));
		const markers = [...cursor.querySelectorAll('circle')];
		assert.deepEqual(markers.map(node => node.getAttribute('fill')), ['red', 'blue', 'green']);
		assert.deepEqual(markers.map(node => +node.getAttribute('cy')),
			[pct, pct, mb].map((scale, s) => round(scale(data[s + 1][idx]))));
		assert.ok(markers.every(node => +node.getAttribute('r') === 3 && +node.getAttribute('cx') === round(x(data[0][idx]))));
		const legend = () => [...host.querySelectorAll('.legend span')].map(node => node.textContent);
		const expected = [`CPU: ${data[1][idx].toFixed(1)}%`, `RAM: ${data[2][idx].toFixed(1)}%`, `TCP Out: ${data[3][idx].toFixed(2)} MB`];
		assert.deepEqual(legend(), expected);
		move(54);
		flush();
		assert.equal(cursor.getAttribute('display'), 'none');
		assert.deepEqual(legend(), expected);
		move(1000);
		overlay.dispatchEvent(new window.PointerEvent('pointerleave'));
		assert.equal(frames.size, 0);
		assert.equal(cursor.getAttribute('display'), 'none');
		move(1000);
		assert.equal(frames.size, 1);
		adapter.destroyChart(chart);
		assert.equal(frames.size, 0);
		assert.equal(host.querySelector('.d3-svg-chart'), null);
		assert.ok(host.querySelector('#plot'));
		move(1000, overlay);
		assert.equal(frames.size, 0);
		assert.deepEqual(legend(), expected);
		adapter.destroyChart(chart);
	});

	it('shares min/max path commands between SVG and Canvas on initialization and dense, sparse, gapped, and empty updates', async () => {
		assert.equal(svgMinmax.prepData, canvas.prepData);
		assert.equal(svgMinmax.updateChart, canvas.updateChart);
		function canvasPaths(input) {
			const canvasHost = window.document.createElement('div');
			canvasHost.innerHTML = '<canvas id="plot"></canvas><canvas id="overlay"></canvas>';
			let path;
			const paths = [];
			const ctx = {
				scale() {}, clearRect() {}, fillText() {}, save() {}, restore() {}, rect() {}, clip() {},
				beginPath() { path = d3.path(); },
				moveTo(x, y) { path.moveTo(x, y); },
				lineTo(x, y) { path.lineTo(x, y); },
				closePath() { path.closePath(); },
				stroke() { paths.push(path.toString() || null); },
			};
			for (const node of canvasHost.querySelectorAll('canvas')) node.getContext = () => ctx;
			const other = minmax.makeChart(input, canvasHost);
			other.destroy();
			return paths.slice(-3);
		}
		function check(input) {
			assert.equal(host.querySelector('canvas'), null);
			const paths = [...host.querySelectorAll('.series path')];
			assert.deepEqual(paths.map(path => path.getAttribute('stroke')), ['red', 'blue', 'green']);
			assert.deepEqual(paths.map(path => path.getAttribute('d')), canvasPaths(input));
			if (input[0].length) checkAxes(host, d3, input);
			return paths;
		}
		chart = svgMinmax.makeChart(data, host, wait, Object.freeze({renderer: 'canvas'}));
		await Promise.resolve();
		assert.equal(wait.textContent, 'Done!');
		for (const path of check(data)) {
			const commands = path.getAttribute('d').match(/[ML]/g);
			assert.ok(commands.length <= 4 * (1795 * ratio + 2));
			assert.ok(commands.length < data[0].length / 2);
		}
		const gapped = Object.freeze(data.map((values, column) => Object.freeze(values.map((value, i) =>
			column === 0 ? value + 86400000 : i === 1 || i === 3 || i === 30000 ? null : value * -2))));
		const sparse = Object.freeze([[0, 60000], [10, 20], [30, 40], [1, 2]].map(Object.freeze));
		for (const input of [gapped, sparse, [[], [], [], []], data]) {
			svgMinmax.updateChart(chart, input, host, wait);
			const paths = check(input);
			if (input === gapped) assert.ok(paths.every(path => path.getAttribute('d').includes('Z')));
			if (input === sparse) checkPaths(host, d3, input);
		}
		svgMinmax.destroyChart(chart);
		chart = svgMinmax.makeEmptyChart(host, wait);
		await Promise.resolve();
		check([[], [], [], []]);
		svgMinmax.updateChart(chart, data, host, wait);
		check(data);
	});

	it('uses distinct clip IDs and does not report readiness after immediate destruction', async () => {
		const input = [[0, 60000], [10, 20], [30, 40], [1, 2]];
		chart = svg.makeChart(input, host, wait);
		await Promise.resolve();
		const id = host.querySelector('clipPath').id;
		const secondHost = host.cloneNode(true);
		secondHost.querySelector('#plot').replaceChildren();
		host.after(secondHost);
		const secondWait = {textContent: 'Rendering...'};
		const second = svg.makeChart(input, secondHost, secondWait);
		assert.notEqual(secondHost.querySelector('clipPath').id, id);
		second.destroy();
		await Promise.resolve();
		assert.equal(secondWait.textContent, 'Rendering...');
		assert.equal(host.querySelector('clipPath').id, id);
	});

	for (const variant of ['canvas', 'minmax']) it(`keeps ${variant} Canvas setup, sparse coordinates, colors, and pointer legend behavior`, async () => {
		host.querySelector('.chart').innerHTML = '<canvas id="plot"></canvas><canvas id="overlay"></canvas>';
		const input = [[0, 60000, 180000], [10, 20, 30], [40, 50, 60], [1, 2, 3]];
		const contexts = [];
		for (const node of host.querySelectorAll('canvas')) {
			const calls = [];
			const context = {calls};
			for (const method of ['scale', 'beginPath', 'moveTo', 'lineTo', 'fillText', 'save', 'restore', 'rect', 'clip', 'clearRect', 'arc', 'fill'])
				context[method] = (...args) => calls.push([method, ...args]);
			context.stroke = () => calls.push(['stroke', context.strokeStyle]);
			node.getContext = kind => { assert.equal(kind, '2d'); return context; };
			contexts.push(context);
		}
		chart = (variant === 'canvas' ? canvas : minmax).makeChart(input, host, wait, Object.freeze({renderer: 'svg'}));
		await Promise.resolve();
		assert.equal(wait.textContent, 'Done!');
		assert.equal(host.querySelector('svg'), null);
		for (const node of host.querySelectorAll('canvas')) {
			assert.equal(node.width, 1920 * ratio);
			assert.equal(node.height, 600 * ratio);
		}
		assert.deepEqual(contexts.map(ctx => ctx.calls[0]), [['scale', ratio, ratio], ['scale', ratio, ratio]]);
		const calls = contexts[0].calls;
		assert.deepEqual(calls.filter(call => call[0] === 'stroke').slice(-3), [['stroke', 'red'], ['stroke', 'blue'], ['stroke', 'green']]);
		assert.deepEqual(calls.find(call => call[0] === 'rect'), ['rect', 55, 10, 1795, 560]);
		const [x, pct, mb] = scales(d3, input);
		const points = calls.slice(calls.findIndex(call => call[0] === 'clip') + 1)
			.filter(call => call[0] === 'moveTo' || call[0] === 'lineTo');
		assert.deepEqual(points, [pct, pct, mb].flatMap((scale, s) => input[s + 1].map((value, i) =>
			[i === 0 ? 'moveTo' : 'lineTo', round(x(input[0][i])), round(scale(value))])));
		const event = new window.PointerEvent('pointermove');
		Object.defineProperty(event, 'offsetX', {value: x(60000)});
		host.querySelector('#overlay').dispatchEvent(event);
		flush();
		assert.equal(host.querySelector('#cpu-value').textContent, 'CPU: 20.0%');
		assert.equal(host.querySelector('#ram-value').textContent, 'RAM: 50.0%');
		assert.equal(host.querySelector('#tcp-value').textContent, 'TCP Out: 2.00 MB');
		assert.equal(contexts[1].calls.filter(call => call[0] === 'arc').length, 3);
	});

	it('reduces full-data Canvas paths on initialization and updates without changing source data or cursor lookup', async () => {
		assert.equal(minmax.prepData, canvas.prepData);
		assert.equal(minmax.updateChart, canvas.updateChart);
		host.querySelector('.chart').innerHTML = '<canvas id="plot"></canvas><canvas id="overlay"></canvas>';
		let points = [], paths = [];
		const context = {
			scale() {}, clearRect() {}, save() {}, restore() {}, rect() {}, clip() {}, fillText() {},
			arc() {}, fill() {}, closePath() {},
			beginPath() { points = []; },
			moveTo(x, y) { points.push([x, y]); },
			lineTo(x, y) { points.push([x, y]); },
			stroke() { paths.push({color: this.strokeStyle, points}); },
		};
		for (const node of host.querySelectorAll('canvas'))
			node.getContext = () => context;

		function check(input) {
			const series = paths.slice(-3);
			assert.deepEqual(series.map(path => path.color), ['red', 'blue', 'green']);
			const [x, pct, mb] = scales(d3, input);
			for (const [s, scale] of [pct, pct, mb].entries()) {
				const actual = series[s].points;
				assert.ok(actual.length <= 4 * (1795 * ratio + 2));
				assert.ok(actual.length < input[0].length / 2);
				const expected = input[s + 1].map((y, i) => [round(x(input[0][i])), round(scale(y))]);
				function buckets(vertices) {
					const result = new Map();
					for (const [x, y] of vertices) {
						if (!result.has(x)) result.set(x, [y, y, y, y]);
						const bucket = result.get(x);
						bucket[1] = Math.min(bucket[1], y);
						bucket[2] = Math.max(bucket[2], y);
						bucket[3] = y;
					}
					return result;
				}
				assert.deepEqual(buckets(actual), buckets(expected));
			}
			const idx = 12345;
			const event = new window.PointerEvent('pointermove');
			Object.defineProperty(event, 'offsetX', {value: x(input[0][idx])});
			host.querySelector('#overlay').dispatchEvent(event);
			flush();
			assert.equal(host.querySelector('#cpu-value').textContent, `CPU: ${input[1][idx].toFixed(1)}%`);
			assert.equal(host.querySelector('#ram-value').textContent, `RAM: ${input[2][idx].toFixed(1)}%`);
			assert.equal(host.querySelector('#tcp-value').textContent, `TCP Out: ${input[3][idx].toFixed(2)} MB`);
		}

		chart = minmax.makeChart(data, host, wait);
		await Promise.resolve();
		assert.equal(wait.textContent, 'Done!');
		check(data);
		const next = Object.freeze(data.map((values, column) => Object.freeze(values.map(value =>
			column === 0 ? value + 86400000 : value * -2))));
		paths = [];
		minmax.updateChart(chart, next, host, wait);
		check(next);
		minmax.destroyChart(chart);
		paths = [];
		chart = minmax.makeEmptyChart(host, wait);
		await Promise.resolve();
		assert.ok(paths.slice(-3).every(path => path.points.length === 0));
		minmax.updateChart(chart, data, host, wait);
		check(data);
	});
});
