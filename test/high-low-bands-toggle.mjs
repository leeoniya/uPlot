import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';

function assertDrawing(u, visible, filled) {
	const defaults = () => ({ clips: [], dash: [], strokeStyle: '#000', fillStyle: '#000', lineWidth: 1, offset: [0, 0] });
	let state = defaults();
	const stack = [];
	const paints = [];
	let clears = 0;

	// Expand grouped calls and track effective state, including bitmap resets.
	for (const [name, ...entries] of u.ctx.log) {
		for (const value of entries) {
			if (name == 'canvas.width' || name == 'canvas.height') {
				state = defaults();
				stack.length = 0;
			}
			else if (name == 'translate')
				state.offset = state.offset.map((v, i) => v + value[i]);
			else if (name == 'clearRect')
				clears++;
			else if (name == 'strokeStyle' || name == 'fillStyle' || name == 'lineWidth')
				state[name] = value;
			else if (name == 'setLineDash')
				state.dash = value[0];
			else if (name == 'save')
				stack.push({ ...state, clips: state.clips.slice(), offset: state.offset.slice() });
			else if (name == 'restore') {
				assert.ok(stack.length > 0, 'restore has a matching save');
				state = stack.pop();
			}
			else if (name == 'clip')
				state.clips.push(value[0]);
			else if ((name == 'stroke' || name == 'fill') && value.length > 0) {
				const path = value[0];
				const si = u.series.findIndex(s => s._paths?.[name] === path);
				assert.ok(visible.includes(si), 'only current paths of visible series are painted');
				assert.equal(state[name + 'Style'], name == 'stroke'
					? [null, 'green', 'red', 'blue'][si]
					: [null, 'rgba(0,255,0,0.1)', 'rgba(255,0,0,0.1)'][si]);

				const width = (si == 3 ? 2 : 1) * u.pxRatio;
				const offset = u.series[si].pxAlign == 1 ? (width % 2) / 2 : 0;
				assert.deepEqual(state.offset, [offset, offset], 'each paint uses its own pixel-alignment offset');

				const ownGap = u.series[si]._paths.clip;
				assert.ok(state.clips.includes(ownGap), 'own data gaps clip every series paint');
				if (name == 'fill') {
					assert.ok(filled.includes(si), 'only bands with both endpoints shown are filled');
					const avg = u.series[3]._paths;
					const bandClip = Array.isArray(avg.band) ? avg.band[si == 1 ? 0 : 1] : avg.band;
					assert.ok(state.clips.includes(bandClip), 'band fill uses the correct Avg boundary direction');
					assert.ok(state.clips.includes(avg.clip), 'Avg gaps clip the band fill');
				}
				assert.equal(state.clips.length, name == 'fill' ? 4 : 2,
					'bounds and own gaps only for strokes; Avg boundary and gaps added only for fills');
				if (name == 'stroke') {
					assert.equal(state.lineWidth, (si == 3 ? 2 : 1) * u.pxRatio);
					assert.deepEqual(state.dash, si == 3 ? [10, 10] : []);
				}
				paints.push({
					kind: name, si, path, style: state[name + 'Style'],
					width: name == 'stroke' ? state.lineWidth : null,
					dash: name == 'stroke' ? state.dash : null,
					clips: state.clips.slice(),
					offset: state.offset.slice(),
				});
			}
		}
	}

	assert.equal(clears, 1, 'one settled canvas draw');
	assert.equal(stack.length, 0, 'canvas saves are balanced');
	assert.deepEqual(state.clips, [], 'no clip survives the draw');
	assert.deepEqual(state.offset, [0, 0], 'canvas translation returns to identity');
	assert.deepEqual(paints.map(p => [p.kind, p.si]), [
		...filled.map(si => ['fill', si]),
		...visible.map(si => ['stroke', si]),
	], 'each surviving band is filled once, below all visible strokes');

	// Compare effective paints, not redundant style assignments skipped by the canvas cache.
	return JSON.parse(JSON.stringify(paints));
}

describe('first high-low-bands Temps demo series toggles', () => {
	let u, previousPlot;

	beforeEach(async () => {
		previousPlot = Object.getOwnPropertyDescriptor(globalThis, 'uPlot');
		globalThis.uPlot = uPlot;
		const { default: groups } = await import('../demos/high-low-bands.js');
		[u] = await groups[0].steps[0].render();
		await Promise.resolve();
	});

	afterEach(() => {
		try {
			u?.destroy();
			u = null;
		}
		finally {
			if (previousPlot)
				Object.defineProperty(globalThis, 'uPlot', previousPlot);
			else
				delete globalThis.uPlot;
		}
	});

	for (const [si, label, visible, filled] of [
		[1, 'Low', [2, 3], [2]],
		[2, 'High', [1, 3], [1]],
		[3, 'Avg', [1, 2], []],
	]) {
		it(`hides and restores ${label} (${si}) without stale band fills or clips`, async () => {
			assert.equal(u.root.querySelector('.u-title').textContent, 'Temps');
			assert.deepEqual(u.series.slice(1).map(s => s.label), ['Low', 'High', 'Avg']);
			assert.ok(u.series.every(s => s.show), 'start with every series shown');
			const initial = assertDrawing(u, [1, 2, 3], [1, 2]);

			u.ctx.log.length = 0;
			u.setSeries(si, { show: false });
			await Promise.resolve();
			assert.equal(u.series[si].show, false);
			const hidden = assertDrawing(u, visible, filled);
			const cached = visible.map(i => u.series[i]._paths);

			u.ctx.log.length = 0;
			u.redraw(false);
			await Promise.resolve();
			assert.deepEqual(assertDrawing(u, visible, filled), hidden, 'cached hidden draw retains the same geometry and clips');
			visible.forEach((i, j) => assert.equal(u.series[i]._paths, cached[j], 'redraw(false) reuses visible paths'));

			u.ctx.log.length = 0;
			u.setSeries(si, { show: true });
			await Promise.resolve();
			assert.ok(u.series.every(s => s.show), 'restore every series');
			assert.deepEqual(assertDrawing(u, [1, 2, 3], [1, 2]), initial,
				'restored series paint operations match the initial drawing');
		});
	}
});
