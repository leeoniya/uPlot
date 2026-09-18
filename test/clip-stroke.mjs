import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';

function drawingClips(log) {
	let clips = [];
	let strokeStyle;
	const stack = [];
	const draws = [];
	for (const [name, ...calls] of log) {
		for (const args of calls) {
			if (name == 'save')
				stack.push([clips.slice(), strokeStyle]);
			else if (name == 'restore') {
				assert.ok(stack.length > 0);
				[clips, strokeStyle] = stack.pop();
			}
			else if (name == 'strokeStyle')
				strokeStyle = args;
			else if (name == 'clip')
				clips.push(args[0]);
			else if (name == 'fill' || name == 'stroke')
				draws.push({ name, path: args[0], clips: clips.slice(), strokeStyle });
		}
	}
	assert.equal(stack.length, 0);
	return draws;
}

const path = () => {
	const p = new Path2D();
	p.rect(0, 0, 400, 300);
	return p;
};

describe('stroke-only path clips', () => {
	for (const flags of [0, 1, 2, 3]) {
		for (const mapped of [false, true]) {
			it(`intersects stroke clips without affecting fills or neighboring series (flags ${flags}, mapped ${mapped})`, async () => {
				const lower = { stroke: path(), fill: path(), clip: path(), clipStroke: path(), band: path(), flags: 0 };
				const upperStrokes = mapped ? [path(), path()] : [path()];
				const upper = {
					stroke: mapped ? new Map([['red', upperStrokes[0]], ['blue', upperStrokes[1]]]) : upperStrokes[0],
					fill: path(), clip: path(), clipStroke: path(), flags,
				};
				const following = { stroke: path(), fill: path(), flags: 0 };
				const u = new uPlot({
					width: 400, height: 300,
					scales: { x: { time: false } },
					axes: [{ show: false }, { show: false }],
					legend: { show: false },
					series: [{}, ...[lower, upper, following].map(paths => ({
						stroke: paths === following ? 'blue' : 'red', fill: 'pink', width: 2,
						points: { show: false }, paths: () => paths,
					}))],
					bands: flags ? [{ series: [2, 1] }] : [],
				}, [[0, 1], [1, 2], [3, 4], [5, 6]], document.body);
				try {
					await Promise.resolve();
					const draws = drawingClips(u.ctx.log);
					const find = (name, p) => {
						const found = draws.filter(d => d.name == name && d.path === p);
						assert.equal(found.length, 1);
						return found[0].clips;
					};
					assert.equal(draws.find(d => d.name == 'stroke' && d.path === following.stroke).strokeStyle, 'blue');
					const fillClips = find('fill', upper.fill);
					assert.ok(fillClips.includes(upper.clip));
					assert.ok(!fillClips.includes(upper.clipStroke));
					assert.ok(!fillClips.includes(lower.clipStroke));
					assert.equal(fillClips.includes(lower.clip), Boolean(flags & 1));
					assert.equal(fillClips.includes(lower.band), Boolean(flags & 1));
					for (const p of upperStrokes) {
						const clips = find('stroke', p);
						assert.ok(clips.includes(upper.clip) && clips.includes(upper.clipStroke));
						assert.ok(!clips.includes(lower.clipStroke));
						assert.equal(clips.includes(lower.band), Boolean(flags & 2));
						assert.equal(clips.includes(lower.clip), flags == 3);
					}
					assert.ok(find('stroke', lower.stroke).includes(lower.clipStroke));
					assert.ok(!find('fill', lower.fill).includes(lower.clipStroke));
					for (const name of ['fill', 'stroke']) {
						const clips = find(name, following[name]);
						assert.ok(!clips.includes(lower.clipStroke) && !clips.includes(upper.clipStroke));
					}
				}
				finally { u.destroy(); }
			});
		}
	}

	it('supports a stroke-only clip on custom point paths without a shared clip', async () => {
		const paths = { fill: path(), stroke: path(), clipStroke: path() };
		const u = new uPlot({
			width: 400, height: 300,
			scales: { x: { time: false } },
			series: [{}, { stroke: 'red', points: { show: true, paths: () => paths } }],
		}, [[0, 1], [1, 2]], document.body);
		try {
			await Promise.resolve();
			const draws = drawingClips(u.ctx.log);
			const stroke = draws.find(d => d.name == 'stroke' && d.path === paths.stroke);
			const fill = draws.find(d => d.name == 'fill' && d.path === paths.fill);
			assert.ok(stroke.clips.includes(paths.clipStroke));
			assert.ok(!fill.clips.includes(paths.clipStroke));
		}
		finally { u.destroy(); }
	});
});
