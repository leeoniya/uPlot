import { createLegend } from '/src/legend-ivi.js';

const workloads = ['mount/destroy', 'changed values', 'unchanged values', 'focus-only', 'show/hide', 'keyed reorder', 'keyed add/remove'];

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const progress = stage => fetch('/bench-progress', { method: 'POST', body: stage });
const assert = (ok, message) => { if (!ok) throw Error(message); };

function fixture(n) {
	const makeSeries = i => ({label: `series-${i}`, show: true, width: 1, class: i ? 'bench-y' : 'bench-x'});
	const base = Array.from({length: n + 1}, (_, i) => makeSeries(i));
	const replacementCount = Math.max(1, Math.floor(n / 10));
	const replaced = base.slice(0, base.length - replacementCount).concat(
		Array.from({length: replacementCount}, (_, i) => makeSeries(n + i + 1)));
	const reverse = [base[0], ...base.slice(1).reverse()];
	const series = base.slice();
	// Exactly one scalar value per row, keyed by the single column name.
	const values = [0, 1].map(phase => base.map((_, i) => ({_: String(i * 100 + phase)})));
	const host = document.createElement('div');
	// Suppress layout/paint work between sample tasks, too.
	host.style.display = 'none';
	document.body.append(host);
	const events = [];
	let mounts = 0;
	const self = {series};
	const opts = {
		series, columns: {_: 0}, multi: false, mode: 1, focusAlpha: 0.3, cursorFocus: true,
		legend: {live: true, mount: () => { mounts++; }, markers: {
			show: true, width: () => 1, dash: () => 'solid',
			stroke: () => 'rgb(10, 20, 30)', fill: () => 'rgb(40, 50, 60)',
		}},
		bind: {click: (_, __, fn) => fn, mouseenter: (_, __, fn) => fn, mouseleave: (_, __, fn) => fn},
		emit: (type, s) => events.push([type, s]),
	};
	return {base, replaced, reverse, series, values, host, self, opts, events, mounts: () => mounts};
}

function smoke(n) {
	const f = fixture(n);
	const view = createLegend(f.self, f.host, f.opts);
	const rows = () => [...f.host.querySelectorAll('tbody > tr')];
	const check = (values, focus = null) => {
		const rs = rows();
		assert(rs.length === f.series.length, 'row count');
		assert(f.host.querySelector('table').className === 'u-legend u-inline u-live', 'table classes');
		rs.forEach((row, i) => {
			assert(row.querySelector('.u-label').textContent === f.series[i].label, `label ${i}`);
			assert(row.querySelector('.u-value').textContent === (values[i] == null ? '--' : values[i]._), `value ${i}`);
			assert(row.classList.contains('u-off') === !f.series[i].show, `show ${i}`);
			assert(row.style.opacity === (focus && i > 0 && f.series[i] !== focus ? '0.3' : ''), `opacity ${i}`);
			assert(row.querySelector('.u-marker') != null, `marker ${i}`);
		});
		return rs;
	};
	try {
		view.render(f.values[0], null);
		const original = check(f.values[0]);
		assert(f.mounts() === 1, 'mount callback');
		view.render(f.values[1], null); check(f.values[1]);
		view.render(f.values[1], null); check(f.values[1]);
		view.render(f.values[1], f.base[1]); check(f.values[1], f.base[1]);
		f.series[1].show = false;
		view.render(f.values[1], null); check(f.values[1]);
		f.series[1].show = true;
		f.series.splice(0, f.series.length, ...f.reverse);
		view.render(f.values[0], null);
		const reversed = check(f.values[0]);
		assert(reversed[0] === original[0] && reversed[n] === original[1], 'keyed reorder identity');
		f.series.splice(0, f.series.length, ...f.replaced);
		view.render(f.values[0], null);
		const added = check(f.values[0]);
		for (let i = 0; i <= n - Math.max(1, Math.floor(n / 10)); i++)
			assert(added[i] === original[i], 'retained key identity');
		const th = added[1].querySelector('th');
		th.dispatchEvent(new MouseEvent('click'));
		th.dispatchEvent(new MouseEvent('mouseenter'));
		f.host.querySelector('table').dispatchEvent(new MouseEvent('mouseleave'));
		assert(f.events.length === 3 && f.events[0][0] === 'click' && f.events[0][1] === f.series[1]
			&& f.events[1][0] === 'focus' && f.events[1][1] === f.series[1] && f.events[2][0] === 'leave', 'event bindings');
		const missing = f.values[0].slice(); missing[1] = null;
		view.render(missing, null); check(missing);
		assert(f.mounts() === 1, 'mount must not repeat');
		view.destroy();
		assert(f.host.childNodes.length === 0, 'destroy removes DOM');
		view.destroy(); view.render(f.values[0], null);
		assert(f.host.childNodes.length === 0, 'destroy is final and idempotent');
	} finally {
		view.destroy();
		f.host.remove();
	}
}

export async function run({series: n = 300, iterations = 300} = {}) {
	if (!crossOriginIsolated) throw Error('Cross-origin isolation is required for finer timer resolution.');
	const results = [];
	smoke(n);
	await progress('correctness smoke passed');

	for (const workload of workloads) {
		const f = fixture(n);
		const times = new Float64Array(iterations);
		let view;
		try {
			if (workload !== 'mount/destroy') {
				view = createLegend(f.self, f.host, f.opts);
				view.render(f.values[0], null);
			}

			await delay(100);
			const heapBefore = performance.memory?.usedJSHeapSize;
			for (let i = 0; i < iterations; i++) {
				const phase = (i + 1) % 2;
				let values = f.values[0], focus = null;
				if (workload === 'changed values') values = f.values[phase];
				if (workload === 'focus-only') focus = f.base[phase ? 1 : n];
				if (workload === 'show/hide') {
					for (let j = 1; j < f.series.length; j++) f.series[j].show = !phase;
				}
				if (workload === 'keyed reorder' || workload === 'keyed add/remove') {
					const next = phase ? (workload === 'keyed reorder' ? f.reverse : f.replaced) : f.base;
					// Reuse the mutable core array; avoid a discarded splice-result array.
					for (let j = 0; j < next.length; j++) f.series[j] = next[j];
				}
				const start = performance.now();
				if (workload === 'mount/destroy') {
					const mounted = createLegend(f.self, f.host, f.opts);
					mounted.render(values, null);
					mounted.destroy();
				} else view.render(values, focus);
				times[i] = performance.now() - start;
				// Pause outside the measured interval.
				if ((i + 1) % 10 === 0) await delay(20);
			}
			const heapAfter = performance.memory?.usedJSHeapSize;
			const sorted = times.slice().sort();
			const fastestFiveMs = Array.from(sorted.subarray(0, 5));
			const averageFastestFiveMs = fastestFiveMs.reduce((sum, x) => sum + x, 0) / 5;
			const timerLimited = sorted[0] <= 0;
			results.push({ workload, iterations, averageFastestFiveMs, fastestFiveMs, timerLimited, sampleMs: Array.from(times), heapBefore, heapAfter });
			await progress(workload + ': ' + (averageFastestFiveMs * 1000).toFixed(2) + ' us');
		} finally {
			view?.destroy();
			f.host.remove();
		}
	}
	return {
		implementation: 'ivi', environment: navigator.userAgent, crossOriginIsolated,
		ySeries: n, xSeries: 1, iterationsPerWorkload: iterations,
		statistic: `Arithmetic mean of the fastest five individual calls out of ${iterations}; no additional timed batches or warmup loop`,
		cooldownMs: 0, fixtureSetupDelayMs: 100, breathers: '20 ms after each ten calls, outside timing',
		timing: 'Synchronous renderer only; attached display:none host, no layout/paint; input preparation and progress reporting excluded.',
		fixture: `${n} Y plus X, one scalar value column, markers and focus enabled; all-Y show/hide, reverse Y, replace last 10% Y keys`,
		smoke: 'passed', results,
	};
}
