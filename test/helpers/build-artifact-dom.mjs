import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInThisContext } from 'node:vm';
import '../../scripts/instrument.mjs';
import Source from '../../src/uPlot.js';

const root = new URL('../../', import.meta.url);
const filename = process.argv[2];
const frame = () => new Promise(requestAnimationFrame);

async function loadArtifact(filename) {
	const url = new URL(filename, root);
	if (filename.endsWith('.esm.js'))
		return (await import(url.href)).default;

	const code = readFileSync(url, 'utf8');
	// Use the shared DOM realm, but keep bundle declarations out of global scope.
	// The .cjs.js artifact lives under type: module, so test its CommonJS body explicitly.
	const commonJS = filename.endsWith('.cjs.js');
	const evaluate = runInThisContext(`(function(module, exports) {\n${code}\nreturn ${commonJS ? 'module.exports' : 'uPlot'};\n})`, {
		filename: fileURLToPath(url),
	});
	const module = { exports: {} };
	return evaluate(module, module.exports);
}

async function exercise(Plot) {
	let draws = 0;
	let destroys = 0;
	const snapshots = [];
	const u = new Plot({
		width: 400, height: 240, pxRatio: 1,
		padding: [0, 0, 0, 0],
		scales: { x: { time: false }, y: { range: [0, 50] } },
		axes: [{ size: 30 }, { size: 50 }],
		cursor: { dataIdx: (self, si, idx) => idx },
		series: [
			{ label: 'Time', value: (self, value) => value == null ? null : `x=${value}` },
			...['Alpha', 'Beta'].map((label, i) => ({
				label, stroke: ['red', 'blue'][i], points: { show: true, size: 6 },
				value: (self, value) => value == null ? null : `v=${value}`,
			})),
		],
		hooks: { draw: [() => draws++], destroy: [() => destroys++] },
	}, [[0, 50, 100], [10, 20, 30], [30, 15, 25]], (self, init) => {
		self.ctx.measureText = text => ({ width: String(text).length * 8 });
		document.body.appendChild(self.root);
		init();
	});

	function snapshot(stage) {
		// The recorder's Path2D objects contain functions; retain their command logs,
		// as the existing demo snapshot recorder does through JSON serialization.
		snapshots.push(JSON.parse(JSON.stringify({
			stage, draws, destroys,
			size: [u.width, u.height, u.ctx.width, u.ctx.height],
			bbox: u.bbox,
			scales: ['x', 'y'].map(key => [u.scales[key].min, u.scales[key].max]),
			data: u.data,
			visible: u.series.map(series => series.show),
			cursor: { left: u.cursor.left, top: u.cursor.top, idx: u.cursor.idx, idxs: u.cursor.idxs },
			legend: { idx: u.legend.idx, values: u.legend.values, html: u.root.querySelector('.u-legend').outerHTML },
			markers: [...u.over.querySelectorAll('.u-cursor-pt')].map(point => point.style.cssText),
			canvas: u.ctx.log,
		})));
	}

	async function hover(idx) {
		u.setCursor({ left: u.valToPos(u.data[0][idx], 'x'), top: u.valToPos(u.data[1][idx], 'y') });
		await frame();
		assert.equal(u.cursor.idx, idx);
		assert.equal(u.legend.idx, idx);
		const values = u.data.map((column, i) => `${i == 0 ? 'x' : 'v'}=${column[idx]}`);
		assert.deepEqual(u.legend.values.map(value => value._), values);
		assert.deepEqual([...u.root.querySelectorAll('.u-legend tbody td')].map(cell => cell.textContent), values);
		assert.equal(u.over.querySelectorAll('.u-cursor-pt').length, 2);
	}

	try {
		await frame();
		assert.equal(u.status, 1);
		assert.equal(u.root.isConnected, true);
		assert.ok(draws > 0, 'construction draws');
		assert.ok(u.ctx.log.some(entry => entry[0] == 'stroke'), 'canvas receives strokes');
		assert.ok(u.ctx.log.some(entry => entry[0] == 'fill'), 'canvas receives point fills');
		snapshot('construction');

		await hover(1);
		snapshot('cursor');

		const beforeData = draws;
		const nextData = [[0, 50, 100, 150], [5, 35, 10, 45], [40, 20, 30, 15]];
		u.setData(nextData);
		await frame();
		assert.deepEqual(u.data, nextData);
		assert.equal(u.scales.x.max, 150);
		assert.ok(draws > beforeData, 'setData redraws');
		await hover(2);
		snapshot('setData');

		const beforeSize = draws;
		const bitmap = [u.ctx.width, u.ctx.height];
		u.setSize({ width: 520, height: 320 });
		await frame();
		assert.deepEqual([u.width, u.height], [520, 320]);
		assert.notDeepEqual([u.ctx.width, u.ctx.height], bitmap);
		assert.ok(draws > beforeSize, 'setSize redraws');
		await hover(2);
		snapshot('setSize');

		for (const show of [false, true]) {
			const row = u.root.querySelectorAll('.u-legend tbody tr')[1];
			row.querySelector('.u-label').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
			await frame();
			assert.equal(u.series[1].show, show);
			assert.equal(row.classList.contains('u-off'), !show);
			snapshot(show ? 'legend show' : 'legend hide');
		}

		const beforeDestroy = draws;
		u.setSize({ width: 540, height: 340 });
		u.destroy();
		u.destroy();
		await frame();
		assert.equal(u.root.isConnected, false);
		assert.equal(destroys, 1, 'destroy is idempotent');
		assert.equal(draws, beforeDestroy, 'destroy cancels pending drawing');
		snapshots.push({ stage: 'destroy', draws, destroys, connected: u.root.isConnected });
		return snapshots;
	}
	finally {
		u.destroy();
	}
}

const expected = await exercise(Source);
const actual = await exercise(await loadArtifact(filename));
assert.deepEqual(actual, expected, filename + ': DOM state and drawing commands match source');
console.log('DOM build parity passed');
