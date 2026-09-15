import Baseline from './baseline.mjs';
import Current from './current.mjs';

const samples = 7;
const moves = 128;
const warmups = 3;
const constructors = [Baseline, Current];
const nextFrame = () => new Promise(requestAnimationFrame);
const median = values => values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)];
const results = [];

function fixture(Plot, config) {
	const count = 1024;
	const data = [Array.from({ length: count }, (_, i) => i)];
	const series = [{}];
	for (let si = 1; si <= config.series; si++) {
		data.push(Array.from({ length: count }, (_, i) => 50 + 40 * Math.sin(i * 0.071 + si * 0.83)));
		series.push({ stroke: 'green', points: { show: false, size: 7, width: 1.5 } });
	}
	const u = new Plot({
		width: 1003, height: 403, pxRatio: config.dpr,
		padding: [5.3, 7.2, 4.1, 11.4],
		legend: { show: !!config.legend },
		cursor: { focus: { prox: -1 } },
		scales: { x: { time: false, range: [0, count - 1] }, y: { range: [0, 100] } },
		axes: [{ size: 30 }, { size: 60 }],
		series,
	}, data, document.body);
	return u;
}

function eventPool(u, config) {
	const rect = u.over.getBoundingClientRect();
	return Array.from({ length: moves }, (_, i) => {
		let fraction = config.sameIndex ? 0.5 : (17 + i * 7) / 1023;
		return new MouseEvent('mousemove', {
			clientX: rect.left + rect.width * fraction,
			clientY: rect.top + rect.height * (0.2 + (i % 10) * 0.06),
			bubbles: true,
		});
	});
}

function measure(u, events, flush) {
	const point = u.over.querySelector('.u-cursor-pt');
	let checksum = 0;
	const start = performance.now();
	for (const event of events) {
		u.over.dispatchEvent(event);
		if (flush)
			checksum += point.getBoundingClientRect().left;
		else
			checksum += u.cursor.idx;
	}
	return { ms: (performance.now() - start) / events.length, checksum };
}

async function runCase(config) {
	const plots = constructors.map(Plot => fixture(Plot, config));
	try {
		await Promise.resolve();
		for (const u of plots)
			u.root.style.display = 'none';

		const rows = [];
		for (const flush of [false, true]) {
			const timings = [[], []];
			const checksums = [0, 0];
			for (let sample = -warmups; sample < samples; sample++) {
				// Alternate order to reduce warmup, clock, and thermal bias.
				const order = sample % 2 == 0 ? [0, 1] : [1, 0];
				for (const index of order) {
					const u = plots[index];
					u.root.style.display = 'block';
					u.syncRect();
					const events = eventPool(u, config);
					u.over.dispatchEvent(events[events.length - 1]);
					await nextFrame();
					const result = measure(u, events, flush);
					checksums[index] += result.checksum;
					if (sample >= 0)
						timings[index].push(result.ms);
					u.root.style.display = 'none';
				}
			}
			const oldMs = median(timings[0]);
			const newMs = median(timings[1]);
			rows.push({
				case: config.name,
				measurement: flush ? 'handler + style/layout flush' : 'handler only',
				baselineMs: oldMs,
				currentMs: newMs,
				changePercent: (newMs / oldMs - 1) * 100,
				deltaMs: newMs - oldMs,
				samples: timings,
				checksums,
			});
		}
		return rows;
	}
	finally {
		plots.forEach(u => u.destroy());
	}
}

try {
	const cases = [
		{ name: '1 series, DPR 1', series: 1, dpr: 1 },
		{ name: '10 series, DPR 1', series: 10, dpr: 1 },
		{ name: '100 series, DPR 1', series: 100, dpr: 1 },
		{ name: '100 series, DPR 1.25', series: 100, dpr: 1.25 },
		{ name: '100 series, DPR 2', series: 100, dpr: 2 },
		{ name: '100 series, inline legend', series: 100, dpr: 1, legend: true },
		{ name: '100 series, unchanged index', series: 100, dpr: 1, sameIndex: true },
	];
	for (const config of cases) {
		const rows = await runCase(config);
		results.push(...rows);
		await fetch('/progress', { method: 'POST', body: JSON.stringify(rows) });
	}
	await fetch('/result', { method: 'POST', body: JSON.stringify({
		userAgent: navigator.userAgent,
		samples, moves, warmups, results,
		limitations: 'Synthetic mousemove events. Handler-only samples batch style work; flush samples force style/layout after each event. Neither measures painting, compositing, OS input, or frame delivery. Focus redraws are disabled.',
	}) });
}
catch (error) {
	await fetch('/result', { method: 'POST', body: JSON.stringify({ error: error.stack ?? String(error) }) });
}
