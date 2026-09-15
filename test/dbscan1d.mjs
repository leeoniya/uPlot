import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Window } from 'happy-dom';

const source = readFileSync(new URL('../demos/lib/dbscan1d.js', import.meta.url), 'utf8');
const {dbscan1d, prepareDbscan1d} = vm.runInNewContext(`${source}\n({dbscan1d, prepareDbscan1d});`);
const labels = (...args) => Array.from(dbscan1d(...args));

// Deliberately quadratic reference implementation with explicit cluster expansion.
function reference(data, epsilon, minPoints, windowRadius = Infinity) {
	const order = Array.from({length: data.length}, (_, i) => i)
		.filter(i => Number.isFinite(data[i])).sort((a, b) => data[a] - data[b]);
	const result = Array.from(data, value => Number.isFinite(value) ? -1 : null);
	const visited = new Set();
	const neighbors = i => order.filter(j => Math.abs(i - j) <= windowRadius && Math.abs(data[i] - data[j]) <= epsilon);
	let cluster = 0;

	for (const i of order) {
		if (visited.has(i))
			continue;
		visited.add(i);
		const near = neighbors(i);
		if (near.length < minPoints)
			continue;
		result[i] = cluster;
		const queue = new Set(near);
		for (const j of queue) {
			if (!visited.has(j)) {
				visited.add(j);
				const next = neighbors(j);
				if (next.length >= minPoints)
					next.forEach(k => queue.add(k));
			}
			if (result[j] === -1)
				result[j] = cluster;
		}
		cluster++;
	}
	return result;
}

describe('1D DBSCAN demo', () => {
	it('preserves input order and does not change the input', () => {
		const data = Object.freeze([100, 2, 1, 0, 20, 21, 22]);
		assert.deepEqual(labels(data, 1, 3), [-1, 0, 0, 0, 1, 1, 1]);
	});

	it('includes the epsilon boundary and the point itself', () => {
		assert.deepEqual(labels([0, 1, 2], 1, 3), [0, 0, 0]);
		assert.deepEqual(labels([0, 1, 2], 1, 4), [-1, -1, -1]);
		assert.deepEqual(labels([3, 3, 8], 0, 2), [0, 0, -1]);
		assert.deepEqual(labels([3, 8], 0, 1), [0, 1]);
	});

	it('does not merge clusters through a shared non-core border point', () => {
		assert.deepEqual(labels([0, 0, 0, 1, 2, 3, 4, 4, 4], 1, 4), [0, 0, 0, 0, 0, 1, 1, 1, 1]);
	});

	it('handles empty input and excludes missing or non-finite samples', () => {
		assert.deepEqual(labels([], 1, 2), []);
		assert.deepEqual(labels([null, undefined, NaN, Infinity, -Infinity, 2, 2], 0, 2), [null, null, null, null, null, 0, 0]);
	});

	it('rejects invalid parameters', () => {
		for (const epsilon of [-1, NaN, Infinity, '1'])
			assert.throws(() => dbscan1d([], epsilon, 2), /epsilon/);
		for (const minPoints of [0, -1, 1.5, NaN, Infinity, '2'])
			assert.throws(() => dbscan1d([], 1, minPoints), /minPoints/);
	});

	it('matches explicit DBSCAN expansion on 500 deterministic datasets', () => {
		let seed = 12345;
		const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
		for (let run = 0; run < 500; run++) {
			const data = Array.from({length: random() % 60}, () => (random() % 200 - 100) / 4);
			const epsilon = (random() % 20) / 4;
			const minPoints = random() % 10 + 1;
			assert.deepEqual(labels(data, epsilon, minPoints), reference(data, epsilon, minPoints));
		}
	});

	it('reuses and fully resets internal and supplied label buffers across modes and parameters', () => {
		const data = Object.freeze([20, null, 0, 1, 2, 21, 22]);
		const detector = prepareDbscan1d(data);
		const internal = detector.detect({epsilon: 1, minPoints: 3});
		assert.ok(Array.isArray(internal));
		assert.deepEqual(Array.from(internal), [1, null, 0, 0, 0, 1, 1]);
		const supplied = Array(data.length).fill('stale');
		const cases = [
			[{epsilon: 1, minPoints: 3, windowRadius: 1}, [-1, null, 0, 0, 0, -1, -1]],
			[{epsilon: 0, minPoints: 2}, [-1, null, -1, -1, -1, -1, -1]],
			[{epsilon: 0, minPoints: 1, windowRadius: 0}, [0, null, 0, 0, 0, 0, 0]],
			[{epsilon: 1, minPoints: 3, windowRadius: Infinity}, [1, null, 0, 0, 0, 1, 1]],
		];
		for (const [options, expected] of cases) {
			internal.fill('stale');
			assert.strictEqual(detector.detect(options), internal);
			assert.deepEqual(Array.from(internal), expected);
			supplied.fill('stale');
			assert.strictEqual(detector.detect(options, supplied), supplied);
			assert.deepEqual(supplied, expected);
		}
		assert.strictEqual(detector.detect({epsilon: 0, minPoints: 1}), internal);
		assert.deepEqual(Array.from(internal), [3, null, 0, 1, 2, 4, 5]);
	});

	it('accepts only ordinary output arrays of exactly the input length', () => {
		const detector = prepareDbscan1d([null, 1]);
		for (const output of [null, [], [0], [0, 0, 0], new Int32Array(2), new Float64Array(2), {length: 2}])
			assert.throws(() => detector.detect({epsilon: 0, minPoints: 1}, output));
		const output = Array(2);
		assert.strictEqual(detector.detect({epsilon: 0, minPoints: 1}, output), output);
		assert.deepEqual(output, [null, 0]);
	});

	it('handles ascending, descending, duplicate, and missing values without changing input', () => {
		for (const values of [[], [null, undefined, NaN, Infinity, -Infinity], [-3, -3, 0, 1, 2, 20], [-3, null, -3, NaN, 0, 1, Infinity, 2, 20], [20, 2, 1, 0, -3, -3]]) {
			const data = Object.freeze(values);
			const detector = prepareDbscan1d(data);
			for (const epsilon of [0, 1, 10]) {
				const expected = reference(data, epsilon, 2);
				assert.deepEqual(Array.from(detector.detect({epsilon, minPoints: 2})), expected);
				assert.deepEqual(Array.from(detector.detect({epsilon, minPoints: 2, windowRadius: Infinity})), labels(data, epsilon, 2));
			}
		}
	});

	it('includes local border points but does not propagate through non-core points', () => {
		const detector = prepareDbscan1d([0, 1, 2, 3, 4]);
		assert.deepEqual(Array.from(detector.detect({epsilon: 1, minPoints: 3, windowRadius: 1})), [0, 0, 0, 0, 0]);
		const border = prepareDbscan1d([0, 0, 0, 1, 2, 3]);
		assert.deepEqual(Array.from(border.detect({epsilon: 1, minPoints: 4, windowRadius: 5})), [0, 0, 0, 0, 0, -1]);
	});

	it('uses inclusive value and index boundaries and fixed minPoints including self', () => {
		const detector = prepareDbscan1d([0, 1, 2]);
		for (const windowRadius of [1, 2, 50])
			assert.deepEqual(Array.from(detector.detect({epsilon: 1, minPoints: 3, windowRadius})), [0, 0, 0]);
		assert.deepEqual(Array.from(detector.detect({epsilon: 1, minPoints: 4, windowRadius: 1})), [-1, -1, -1]);
		assert.deepEqual(Array.from(detector.detect({epsilon: 0, minPoints: 1, windowRadius: 0})), [0, 0, 0]);
		assert.deepEqual(Array.from(prepareDbscan1d([3, 3, 3]).detect({epsilon: 0, minPoints: 2, windowRadius: 0})), [-1, -1, -1]);
		assert.deepEqual(Array.from(prepareDbscan1d([3, 3, 8]).detect({epsilon: 0, minPoints: 2, windowRadius: 1})), [0, 0, -1]);
	});

	it('retains missing positions in local windows and differs from global detection', () => {
		const detector = prepareDbscan1d([2, null, 2, undefined, NaN, Infinity, -Infinity]);
		assert.deepEqual(Array.from(detector.detect({epsilon: 0, minPoints: 2})), [0, null, 0, null, null, null, null]);
		assert.deepEqual(Array.from(detector.detect({epsilon: 0, minPoints: 2, windowRadius: 1})), [-1, null, -1, null, null, null, null]);
		assert.deepEqual(Array.from(detector.detect({epsilon: 0, minPoints: 2, windowRadius: 2})), [0, null, 0, null, null, null, null]);
		const sparse = Array(3);
		sparse[0] = sparse[2] = 2;
		assert.deepEqual(Array.from(prepareDbscan1d(sparse).detect({epsilon: 0, minPoints: 2, windowRadius: 1})), [-1, null, -1]);
	});

	it('validates prepared detection parameters', () => {
		const detector = prepareDbscan1d([]);
		for (const epsilon of [-1, NaN, Infinity, '1'])
			assert.throws(() => detector.detect({epsilon, minPoints: 2}), /epsilon/);
		for (const minPoints of [0, -1, 1.5, NaN, Infinity, '2'])
			assert.throws(() => detector.detect({epsilon: 1, minPoints}), /minPoints/);
		for (const windowRadius of [-1, 0.5, NaN, -Infinity, '1', null])
			assert.throws(() => detector.detect({epsilon: 1, minPoints: 2, windowRadius}), /windowRadius/);
		assert.deepEqual(Array.from(detector.detect({epsilon: 0, minPoints: 1, windowRadius: 0})), []);
	});

	it('matches local noise classifications from quadratic DBSCAN on 500 deterministic datasets', () => {
		let seed = 67890;
		const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
		const missing = [null, undefined, NaN, Infinity, -Infinity];
		for (let run = 0; run < 500; run++) {
			const data = Object.freeze(Array.from({length: random() % 60}, () => {
				const value = random();
				return value % 7 === 0 ? missing[value % missing.length] : (value % 40 - 20) / 4;
			}));
			const detector = prepareDbscan1d(data);
			for (const windowRadius of [0, 1, random() % 12, data.length + 1]) {
				const epsilon = (random() % 12) / 4;
				const minPoints = random() % 8 + 1;
				const expected = reference(data, epsilon, minPoints, windowRadius).map(label => label == null || label === -1 ? label : 0);
				assert.deepEqual(Array.from(detector.detect({epsilon, minPoints, windowRadius})), expected, `run ${run}, radius ${windowRadius}, epsilon ${epsilon}, minPoints ${minPoints}`);
			}
		}
	});

	it('updates outlier charts, counts, and readouts immediately from sliders, modes, and presets', async () => {
		const window = new Window();
		const charts = [];
		const data = [0, 0, 0, 100];
		const html = readFileSync(new URL('../demos/data-smoothing.html', import.meta.url), 'utf8');
		const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
		let loaded;
		const context = vm.createContext({
			document: window.document,
			devicePixelRatio: 1,
			console: {time() {}, timeEnd() {}},
			dbscan1d,
			prepareDbscan1d,
			prepareDoubleMad: vm.runInNewContext(readFileSync(new URL('../demos/lib/double-mad.js', import.meta.url), 'utf8') + '\nprepareDoubleMad;'),
			sgg: data => data,
			smooth: data => data,
			fetch: () => ({then: () => ({then: callback => { loaded = Promise.resolve().then(() => callback(data)); }})}),
			uPlot: class {
				constructor(opts, data) { this.opts = opts; this.data = data; this.updates = 0; charts.push(this); }
				setData(data) { this.data = data; this.updates++; }
			},
		});
		try {
			vm.runInContext(script, context);
			await loaded;
			const form = window.document.querySelector('form');
			const madForm = window.document.querySelector('#double-mad-controls');
			const mode = form.elements.mode;
			const radius = form.elements.windowRadius;
			const epsilon = form.elements.epsilon;
			const minPoints = form.elements.minPoints;
			const threshold = madForm.elements.threshold;
			const ranges = [epsilon, minPoints, radius, threshold];
			const assertReadouts = () => {
				for (const input of ranges) {
					assert.equal(input.nextElementSibling?.tagName, 'SPAN');
					assert.ok(input.nextElementSibling.classList.contains('slider-value'));
					assert.equal(input.nextElementSibling.textContent, input.value);
				}
			};
			for (const [input, min, max, step, value] of [
				[epsilon, '0', '5000', '10', '100'],
				[minPoints, '1', '100', '1', '20'],
				[radius, '0', '300', '1', '50'],
				[threshold, '0', '6', '0.05', '3.5'],
			]) {
				assert.equal(input.type, 'range');
				assert.equal(input.min, min);
				assert.equal(input.max, max);
				assert.equal(input.step, step);
				assert.equal(input.defaultValue, value);
				assert.equal(input.value, value);
			}
			assertReadouts();
			assert.doesNotMatch(form.textContent, /For a local example|global defaults classify/);
			for (const controls of [form, madForm])
				assert.doesNotMatch(controls.textContent, /Find outliers/);
			assert.equal(mode.tagName, 'SELECT');
			assert.deepEqual(Array.from(mode.options, option => option.value).sort(), ['global', 'local']);
			assert.equal(mode.value, 'global');
			assert.equal(radius.value, '50');
			assert.equal(radius.disabled, true);
			const chartData = charts[1].data;
			const buffers = Array.from(chartData);
			const assertBuffers = () => {
				assert.strictEqual(charts[1].data, chartData);
				buffers.forEach((buffer, i) => assert.strictEqual(charts[1].data[i], buffer));
				assert.strictEqual(charts[1].data[1], data);
				assert.deepEqual(data, [0, 0, 0, 100]);
			};
			const chartStates = charts.map(chart => ({data: chart.data, buffers: Array.from(chart.data)}));
			const detector = prepareDbscan1d(data);
			const assertDbscan = options => {
				const result = Array.from(detector.detect(options));
				assert.deepEqual(Array.from(charts[1].data[2]), result.map((label, i) => label === -1 ? data[i] : null));
				assert.equal(form.querySelector('output').textContent.trim(), `${result.filter(label => label === -1).length} outliers`);
			};
			const act = (chartIndex, callback) => {
				const before = charts.map(chart => ({updates: chart.updates, values: chart.data.map(buffer => Array.from(buffer))}));
				callback();
				charts.forEach((chart, i) => {
					assert.strictEqual(chart.data, chartStates[i].data);
					chartStates[i].buffers.forEach((buffer, j) => assert.strictEqual(chart.data[j], buffer));
					if (i === chartIndex)
						assert.ok(chart.updates > before[i].updates, 'the affected chart updates synchronously');
					else {
						assert.equal(chart.updates, before[i].updates);
						assert.deepEqual(chart.data.map(buffer => Array.from(buffer)), before[i].values);
					}
				});
				assertBuffers();
				assertReadouts();
				assert.equal(radius.disabled, mode.value === 'global');
				assertDbscan({epsilon: epsilon.valueAsNumber, minPoints: minPoints.valueAsNumber, windowRadius: mode.value === 'local' ? radius.valueAsNumber : Infinity});
			};
			const input = (control, value) => act(control === threshold ? 2 : 1, () => {
				control.value = String(value);
				control.dispatchEvent(new window.Event('input', {bubbles: true}));
			});
			const changeMode = value => act(1, () => {
				mode.value = value;
				mode.dispatchEvent(new window.Event('change', {bubbles: true}));
			});
			input(epsilon, 0);
			input(minPoints, 3);
			assert.deepEqual(Array.from(charts[1].data[2]), [null, null, null, 100]);
			assert.equal(form.querySelector('output').textContent.trim(), '1 outliers');
			assertBuffers();
			input(epsilon, 100);
			assert.deepEqual(Array.from(charts[1].data[2]), [null, null, null, null]);
			changeMode('local');
			input(radius, 0);
			assert.deepEqual(Array.from(charts[1].data[2]), data);
			changeMode('global');
			assert.deepEqual(Array.from(charts[1].data[2]), [null, null, null, null]);
			changeMode('local');
			assert.deepEqual(Array.from(charts[1].data[2]), data);
			input(radius, 1);
			input(epsilon, 0);
			assert.deepEqual(Array.from(charts[1].data[2]), [null, null, null, 100]);

			for (const [preset, expectedEpsilon, expectedMinPoints] of [['global', 100, 20], ['local', 1000, 5]]) {
				changeMode('local');
				input(radius, 7);
				input(epsilon, 230);
				input(minPoints, 2);
				changeMode(preset === 'global' ? 'local' : 'global');
				const button = form.querySelector(`button[data-preset="${preset}"]`);
				assert.ok(button);
				assert.equal(button.type, 'button');
				act(1, () => button.click());
				assert.equal(mode.value, preset);
				assert.equal(epsilon.value, String(expectedEpsilon));
				assert.equal(minPoints.value, String(expectedMinPoints));
				assert.equal(radius.value, '50');
				assertDbscan({epsilon: expectedEpsilon, minPoints: expectedMinPoints, windowRadius: preset === 'local' ? 50 : Infinity});
			}

			const submit = (controls, chartIndex) => act(chartIndex, () => {
				const event = new window.Event('submit', {bubbles: true, cancelable: true});
				assert.equal(controls.dispatchEvent(event), false);
				assert.equal(event.defaultPrevented, true);
			});
			changeMode('global');
			epsilon.value = '100';
			minPoints.value = '3';
			submit(form, 1);
			assert.deepEqual(Array.from(charts[1].data[2]), [null, null, null, null]);
			assert.equal(madForm.elements.threshold.value, '3.5');
			assert.equal(madForm.querySelector('output').textContent.trim(), '0 outliers');
			assert.match(madForm.querySelector('.mad-stats').textContent, /Median: .*left MAD: .*right MAD:/);
			const madChartData = charts[2].data;
			const madBuffer = madChartData[2];
			assert.deepEqual(Array.from(madBuffer), [null, null, null, null]);
			for (const value of [0, 3.5, 0, 6]) {
				input(threshold, value);
				assert.strictEqual(charts[2].data, madChartData);
				assert.strictEqual(charts[2].data[2], madBuffer);
				assert.strictEqual(charts[2].data[1], data);
				assert.deepEqual(Array.from(madBuffer), value === 0 ? data : [null, null, null, null]);
				assert.equal(madForm.querySelector('output').textContent.trim(), `${value === 0 ? 4 : 0} outliers`);
				assertBuffers();
				assert.deepEqual(Array.from(charts[1].data[2]), [null, null, null, null]);
			}
			threshold.value = '0';
			submit(madForm, 2);
			assert.deepEqual(Array.from(madBuffer), data);
			assert.equal(madForm.querySelector('output').textContent.trim(), '4 outliers');
			assert.equal(charts.length, 6);
		}
		finally {
			await window.happyDOM.close();
		}
	});
});
