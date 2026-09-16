import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import '../scripts2/instrument.mjs';
import uPlot from '../src/uPlot.js';

const demoDir = new URL('../demos/issues/', import.meta.url);

async function settle() {
	await Promise.resolve();
	await Promise.resolve();
}

function ranges(u) {
	return { x: [u.scales.x.min, u.scales.x.max], y: [u.scales.y.min, u.scales.y.max] };
}

async function loadDemo(filename) {
	const html = readFileSync(new URL(filename, demoDir), 'utf8');
	const fixture = document.createElement('div');
	fixture.innerHTML = html.match(/<body>([\s\S]*?)<script>/)[1];
	document.body.append(fixture);

	let u;
	const Plot = new Proxy(uPlot, {
		construct(target, args) {
			return u = Reflect.construct(target, args);
		},
	});

	try {
		const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
		new Function('uPlot', 'document', script)(Plot, fixture);
		await settle();
	}
	catch (error) {
		u?.destroy();
		fixture.remove();
		throw error;
	}

	// Happy DOM has no layout engine. Mouse coordinates use the applied overlay dimensions.
	u.over.getBoundingClientRect = () => new DOMRect(100, 100,
		parseFloat(u.over.style.width), parseFloat(u.over.style.height));

	let previous = [0, 0];
	function mouse(type, x, y, target = u.over) {
		const rect = u.over.getBoundingClientRect();
		const clientX = rect.left + x * rect.width;
		const clientY = rect.top + y * rect.height;
		const event = new MouseEvent(type, {
			bubbles: type != 'mouseenter',
			cancelable: true,
			button: 0,
			buttons: type == 'mouseup' || type == 'dblclick' ? 0 : 1,
			clientX,
			clientY,
		});
		Object.defineProperties(event, {
			movementX: { value: clientX - previous[0] },
			movementY: { value: clientY - previous[1] },
		});
		previous = [clientX, clientY];
		target.dispatchEvent(event);
	}

	return {
		u,
		fixture,
		status: () => JSON.parse(fixture.querySelector('#status').textContent),
		async drag(x0, y0, x1, y1) {
			mouse('mouseenter', x0, y0);
			mouse('mousedown', x0, y0);
			mouse('mousemove', x1, y1);
			mouse('mouseup', x1, y1, document);
			await settle();
		},
		async reset() {
			mouse('dblclick', 0.5, 0.5);
			await settle();
		},
		async toggle(label) {
			const item = [...u.root.querySelectorAll('.u-label')].find(el => el.textContent == label);
			assert.ok(item, label);
			item.click();
			await settle();
		},
		destroy() {
			u.destroy();
			fixture.remove();
		},
	};
}

describe('standalone issue demos', () => {
	it('keeps displayed snippets valid and indented with two spaces', () => {
		for (const filename of readdirSync(demoDir).filter(name => name.endsWith('.html'))) {
			const html = readFileSync(new URL(filename, demoDir), 'utf8');
			const snippets = [...html.matchAll(/<pre><code>([\s\S]*?)<\/code><\/pre>/g)];
			assert.ok(snippets.length > 0, filename);

			for (const [, snippet] of snippets) {
				assert.doesNotThrow(() => new Function(snippet), filename);
				assert.ok(!snippet.includes('\t'), filename);
				for (const line of snippet.split('\n'))
					assert.equal(line.match(/^ */)[0].length % 2, 0, filename);
			}
		}
	});

	it('#823 keeps full-domain bounds and live status through drag and legend toggles', async () => {
		const f = await loadDemo('issue-823-full-domain-scan.html');
		try {
			assert.deepEqual(ranges(f.u).y, [10, 50]);
			await f.drag(0, 0.5, 0.25, 0.5);
			assert.deepEqual(ranges(f.u), { x: [0, 1], y: [10, 50] });

			for (const show of [true, false, true]) {
				await f.toggle('B');
				const y = show ? [10, 500] : [10, 50];
				assert.deepEqual(ranges(f.u), { x: [0, 1], y });
				assert.deepEqual(f.status(), { x: [0, 1], y, BVisible: show });
			}

			await f.reset();
			assert.deepEqual(f.status(), { x: [0, 4], y: [10, 500], BVisible: true });
		}
		finally {
			f.destroy();
		}
	});

	it('#808 expands the thick-stroke clip without extrema scanning or point markers', async () => {
		const f = await loadDemo('issue-808-static-range-scan.html');
		try {
			const { u } = f;
			assert.deepEqual(u.data[1], [-12, -12, 0, 0, 12, 12]);
			assert.deepEqual(ranges(u).y, [-12, 12]);
			assert.deepEqual([u.series[1].min, u.series[1].max], [null, null]);
			assert.equal(u.series[1].points.show(u, 1), false);
			const width = u.series[1].width * u.pxRatio;
			assert.equal(u.series[1].width, 5);
			const clip = u.ctx.log.find(entry => entry[0] == 'clip')[1][0];
			assert.deepEqual(clip.log.find(entry => entry[0] == 'rect')[1], [
				u.bbox.left - width / 2,
				u.bbox.top - width / 2,
				u.bbox.width + width,
				u.bbox.height + width,
			]);
		}
		finally {
			f.destroy();
		}
	});

	it('#915 restores both scales after mode-2 XY zoom without scanning Y', async () => {
		const f = await loadDemo('issue-915-static-range-reset.html');
		try {
			assert.equal(f.u.mode, 2);
			assert.deepEqual(ranges(f.u), { x: [0, 2], y: [1, 10] });
			await f.drag(0.25, 0.25, 0.75, 0.75);
			assert.deepEqual(ranges(f.u), { x: [0.5, 1.5], y: [3.25, 7.75] });
			await f.reset();
			assert.deepEqual(f.status(), { x: [0, 2], y: [1, 10] });
			assert.deepEqual([f.u.series[1].min, f.u.series[1].max], [null, null]);
		}
		finally {
			f.destroy();
		}
	});

	it('#648 preserves manual Y zoom on X-only drag and restores default padded ranges', async () => {
		const f = await loadDemo('issue-648-auto-reset-vs-zoom.html');
		try {
			assert.deepEqual(ranges(f.u).y, [8, 32]);
			await f.drag(0.25, 0.5, 0.75, 0.5);
			assert.deepEqual(ranges(f.u), { x: [0.5, 1.5], y: [8, 32] });
			await f.reset();
			await f.drag(0.25, 0.25, 0.75, 0.75);
			assert.deepEqual(ranges(f.u).y, [14, 26]);
			await f.drag(0.25, 0.5, 0.75, 0.5);
			assert.deepEqual(ranges(f.u).y, [14, 26]);
			const zoomed = ranges(f.u);
			for (let i = 0; i < 3; i++) {
				f.u.redraw();
				await settle();
				assert.deepEqual(ranges(f.u), zoomed);
			}

			await f.reset();
			assert.deepEqual(f.status(), { x: [0, 2], y: [8, 32] });
			f.fixture.querySelector('#new-data').click();
			await settle();
			assert.deepEqual(f.status(), { x: [0, 2], y: [80, 320] });
		}
		finally {
			f.destroy();
		}
	});

	it('#650 queries full-domain padded bounds after visibility changes without applying them', async () => {
		const f = await loadDemo('issue-650-candidate-range.html');
		try {
			assert.deepEqual(ranges(f.u).x, [0, 1]);
			for (const show of [false, true, false, true]) {
				if (f.u.series[2].show != show)
					await f.toggle('Outlier');

				const before = ranges(f.u);
				const extrema = f.u.series.map(s => [s.min, s.max]);
				f.fixture.querySelector('#calculate').click();
				assert.deepEqual(ranges(f.u), before);
				assert.deepEqual(f.u.series.map(s => [s.min, s.max]), extrema);
				assert.deepEqual(before.x, [0, 1]);
				const status = f.status();
				assert.deepEqual(status.viewBeforeQuery, before);
				assert.deepEqual(status.viewAfterQuery, before);
				assert.deepEqual(status.candidateRange, show ? [0, 330] : [8, 32]);

				const reference = new uPlot({
					width: 400,
					height: 300,
					scales: { x: { time: false } },
					series: [{}, { stroke: 'blue' }, { stroke: 'red', show }],
				}, f.u.data, document.body);
				try {
					await settle();
					assert.deepEqual(status.candidateRange, ranges(reference).y);
				}
				finally {
					reference.destroy();
				}
			}
		}
		finally {
			f.destroy();
		}
	});

	it('#655 retains concrete Y bounds and visible paths through X drag and reset', async () => {
		const f = await loadDemo('issue-655-fixed-auto-false.html');
		try {
			await f.drag(0, 0.5, 0.5, 0.5);
			assert.deepEqual(f.status(), { x: [0, 1], y: [-15, 15] });
			assert.equal(f.u.axes[1]._show, true);
			assert.ok(f.u.series[1]._paths.stroke);
			await f.reset();
			assert.deepEqual(f.status(), { x: [0, 2], y: [-15, 15] });
		}
		finally {
			f.destroy();
		}
	});
});
