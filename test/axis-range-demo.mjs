import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import '../scripts/instrument.mjs';
import { withSeededRandom } from '../scripts/withSeededRandom.mjs';
import { createDemo } from '../demos/axis-range-aligned.js';
import { rangeYCount } from '../src/rangeY.js';

const html = await readFile(new URL('../demos/axis-range-aligned.html', import.meta.url), 'utf8');

function aligned(u) {
	const height = u.bbox.height / u.pxRatio;
	const positions = ['left', 'right'].map((key, i) => {
		const ticks = u.axes[i + 1]._splits;
		assert.equal(ticks.length, rangeYCount(height) + 1);
		assert.deepEqual([ticks[0], ticks.at(-1)], [u.scales[key].min, u.scales[key].max]);
		return ticks.map(value => u.valToPos(value, key));
	});
	positions[0].forEach((value, i) => assert.ok(Math.abs(value - positions[1][i]) < 1e-8));
}

describe('aligned random-walk demo', () => {
	let root, u;
	const input = id => root.querySelector(`#${id}`);
	const submit = () => input('walk-controls').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

	beforeEach(async () => {
		root = document.createElement('div');
		root.innerHTML = html.match(/<main\b[^]*?<\/main>/)[0];
		document.body.appendChild(root);
		await withSeededRandom(() => { u = createDemo(root); });
		await Promise.resolve();
	});

	afterEach(() => {
		u?.destroy();
		root.remove();
	});

	it('starts two independent walks with different magnitudes and only one Y grid', () => {
		assert.deepEqual(u.data.map(values => values.length), [501, 501, 501]);
		assert.equal(u.data[1][0], 50);
		assert.equal(u.data[2][0], 500000);
		assert.ok(new Set(u.data[1]).size > 1);
		assert.ok(new Set(u.data[2]).size > 1);
		assert.equal(u.axes[1].side, 3);
		assert.equal(u.axes[2].side, 1);
		assert.equal(u.axes[1].grid.show, true);
		assert.equal(u.axes[2].grid.show, false);
		assert.equal(u.cursor.drag.x, true);
		assert.equal(u.cursor.drag.y, false);
		assert.ok(input('stats').textContent.includes('Plot height: 430px'));
		aligned(u);
	});

	it('uses setSize for the height slider, retaining data and avoiding scans', async () => {
		const data = u.data;
		const sizes = [];
		const setSize = u.setSize;
		u.setSize = size => { sizes.push(size); setSize(size); };
		let scans = 0;
		for (const key of ['left', 'right']) {
			const scan = u.scales[key].scan;
			u.scales[key].scan = (...args) => { scans++; return scan(...args); };
		}
		for (const height of [60, 99, 100, 463, 1050]) {
			input('height').value = height;
			input('height').dispatchEvent(new Event('input'));
			await Promise.resolve();
			assert.deepEqual(sizes.at(-1), { width: u.width, height });
			assert.equal(u.height, height);
			assert.equal(u.bbox.height / u.pxRatio, height - 50);
			assert.equal(input('height-value').value, `${height}px`);
			assert.equal(u.data, data);
			assert.equal(scans, 0);
			aligned(u);
		}
		assert.equal(sizes.length, 5);
	});

	it('accepts independent starts and spreads, including flat data', async () => {
		input('left-start').value = -.02;
		input('left-spread').value = .0001;
		input('right-start').value = 1e8;
		input('right-spread').value = 1000;
		await withSeededRandom(submit);
		assert.equal(u.data[1][0], -.02);
		assert.equal(u.data[2][0], 1e8);
		assert.ok(new Set(u.data[1]).size > 1);
		assert.ok(new Set(u.data[2]).size > 1);
		aligned(u);
		input('left-spread').value = 0;
		input('right-spread').value = 0;
		submit();
		await Promise.resolve();
		assert.deepEqual([...new Set(u.data[1])], [-.02]);
		assert.deepEqual([...new Set(u.data[2])], [1e8]);
		aligned(u);
	});

	it('scales seeded walk deviations independently with each input spread', async () => {
		const keys = ['left', 'right'];
		const starts = [-16, 1024];
		const spreads = [2, 32];
		keys.forEach((key, i) => {
			input(`${key}-start`).value = starts[i];
			input(`${key}-spread`).value = spreads[i];
		});
		await withSeededRandom(submit);
		const baseline = u.data.map(values => values.slice());
		assert.deepEqual(baseline.map(values => values.length), [501, 501, 501]);
		const normalized = keys.map((_, i) => {
			assert.equal(baseline[i + 1][0], starts[i]);
			const deviations = baseline[i + 1].map(value => (value - starts[i]) / spreads[i]);
			assert.ok(deviations.some(value => Math.abs(value) > 1e-8), 'seeded walk is not flat');
			return deviations;
		});
		assert.ok(normalized[0].some((value, i) => Math.abs(value - normalized[1][i]) > 1e-8),
			'left and right walks are not copies after removing starts and spreads');

		for (const changed of [[8, 32], [2, 8], [8, 8]]) {
			keys.forEach((key, i) => { input(`${key}-spread`).value = changed[i]; });
			// Reset the seed so only the input spreads change, not the random samples.
			await withSeededRandom(submit);
			assert.deepEqual(u.data[0], baseline[0]);
			keys.forEach((key, i) => {
				assert.equal(u.data[i + 1].length, baseline[i + 1].length);
				assert.equal(u.data[i + 1][0], starts[i]);
				u.data[i + 1].forEach((value, j) => {
					const expected = (baseline[i + 1][j] - starts[i]) * changed[i] / spreads[i];
					assert.ok(Math.abs((value - starts[i]) - expected) < 1e-10 * Math.max(1, Math.abs(expected)),
						`${key}: sample ${j} deviation scales with spread ${changed[i]}`);
				});
			});
			aligned(u);
		}
	});

	it('randomizes starts and spreads across different orders of magnitude', async () => {
		await withSeededRandom(async () => {
			for (let i = 0; i < 8; i++) {
				const previous = u.data;
				input('randomize').click();
				await Promise.resolve();
				const starts = ['left', 'right'].map(key => input(`${key}-start`).valueAsNumber);
				const magnitudes = starts.map(Math.abs);
				assert.ok(Math.max(...magnitudes) / Math.min(...magnitudes) > 100);
				assert.deepEqual([u.data[1][0], u.data[2][0]], starts);
				for (const key of ['left', 'right'])
					assert.ok(input(`${key}-spread`).valueAsNumber > 0);
				assert.notEqual(u.data, previous);
				assert.ok(u.data.every(values => values.every(Number.isFinite)));
				aligned(u);
			}
		});
	});

	it('keeps flat zoomed ranges aligned and resets zoom without replacing data', async () => {
		u.setScale('x', { min: 249.9, max: 250.1 });
		await Promise.resolve();
		for (const i of [1, 2])
			assert.deepEqual([u.series[i].min, u.series[i].max], [u.data[i][250], u.data[i][250]]);
		aligned(u);
		const data = u.data;
		input('reset-zoom').click();
		await Promise.resolve();
		assert.deepEqual([u.scales.x.min, u.scales.x.max], [0, 500]);
		assert.equal(u.data, data);
		aligned(u);
		u.setScale('x', { min: 100, max: 200 });
		await Promise.resolve();
		await withSeededRandom(submit);
		assert.deepEqual([u.scales.x.min, u.scales.x.max], [0, 500]);
		assert.notEqual(u.data, data);
	});

	it('does not replace data when a spread is invalid', async () => {
		const data = u.data;
		input('left-spread').value = -1;
		submit();
		await Promise.resolve();
		assert.equal(u.data, data);
	});

	it('removes resize and control handlers on destroy', () => {
		let calls = 0;
		u.setSize = () => calls++;
		u.destroy();
		u = null;
		window.dispatchEvent(new Event('resize'));
		input('height').dispatchEvent(new Event('input'));
		assert.equal(calls, 0);
	});
});
