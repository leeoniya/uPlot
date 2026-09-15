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

	it('updates both outlier charts and counts when their forms are submitted', async () => {
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
				constructor(opts, data) { this.opts = opts; this.data = data; charts.push(this); }
				setData(data) { this.data = data; }
			},
		});
		try {
			vm.runInContext(script, context);
			await loaded;
			const form = window.document.querySelector('form');
			const mode = form.elements.mode;
			const radius = form.elements.windowRadius;
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
			form.elements.epsilon.value = '0';
			form.elements.minPoints.value = '3';
			form.dispatchEvent(new window.Event('submit', {cancelable: true}));
			assert.deepEqual(Array.from(charts[1].data[2]), [null, null, null, 100]);
			assert.equal(form.querySelector('output').textContent.trim(), '1 outliers');
			assertBuffers();
			form.elements.epsilon.value = '100';
			form.dispatchEvent(new window.Event('submit', {cancelable: true}));
			assert.deepEqual(Array.from(charts[1].data[2]), [null, null, null, null]);
			assert.equal(form.querySelector('output').textContent.trim(), '0 outliers');
			assertBuffers();
			mode.value = 'local';
			mode.dispatchEvent(new window.Event('change', {bubbles: true}));
			assert.equal(radius.disabled, false);
			radius.value = '0';
			form.dispatchEvent(new window.Event('submit', {cancelable: true}));
			assert.deepEqual(Array.from(charts[1].data[2]), [0, 0, 0, 100]);
			assert.equal(form.querySelector('output').textContent.trim(), '4 outliers');
			assertBuffers();
			radius.value = '1';
			form.elements.epsilon.value = '0';
			form.dispatchEvent(new window.Event('submit', {cancelable: true}));
			assert.deepEqual(Array.from(charts[1].data[2]), [null, null, null, 100]);
			assert.equal(form.querySelector('output').textContent.trim(), '1 outliers');
			assertBuffers();
			mode.value = 'global';
			mode.dispatchEvent(new window.Event('change', {bubbles: true}));
			assert.equal(radius.disabled, true);
			form.elements.epsilon.value = '100';
			form.dispatchEvent(new window.Event('submit', {cancelable: true}));
			assert.deepEqual(Array.from(charts[1].data[2]), [null, null, null, null]);
			assert.equal(form.querySelector('output').textContent.trim(), '0 outliers');
			assertBuffers();
			const madForm = window.document.querySelector('#double-mad-controls');
			assert.equal(madForm.elements.threshold.value, '3.5');
			assert.equal(madForm.querySelector('output').textContent.trim(), '0 outliers');
			assert.match(madForm.querySelector('.mad-stats').textContent, /Median: .*left MAD: .*right MAD:/);
			const madChartData = charts[2].data;
			const madBuffer = madChartData[2];
			assert.deepEqual(Array.from(madBuffer), [null, null, null, null]);
			for (const threshold of [0, 3.5, 0, 10]) {
				madForm.elements.threshold.value = String(threshold);
				madForm.dispatchEvent(new window.Event('submit', {cancelable: true}));
				assert.strictEqual(charts[2].data, madChartData);
				assert.strictEqual(charts[2].data[2], madBuffer);
				assert.strictEqual(charts[2].data[1], data);
				assert.deepEqual(Array.from(madBuffer), threshold === 0 ? data : [null, null, null, null]);
				assert.equal(madForm.querySelector('output').textContent.trim(), `${threshold === 0 ? 4 : 0} outliers`);
				assertBuffers();
				assert.deepEqual(Array.from(charts[1].data[2]), [null, null, null, null]);
			}
			assert.equal(charts.length, 6);
		}
		finally {
			await window.happyDOM.close();
		}
	});
});
