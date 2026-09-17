import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../scripts2/instrument.mjs';
import uPlot from '../src/uPlot.js';
import { ageTicks, calendarTicks, createLogTimeDemo, latencyData, recentTimeTransform } from '../demos/log-time-axis.js';

const second = 1000;
const minute = 60 * second;
const hour = 60 * minute;
const day = 24 * hour;
const year = 365.25 * day;
const min = Date.UTC(2000, 0, 1);
const max = Date.UTC(2026, 8, 16, 12);
const tauMin = 5 * minute;
const tauMax = 20 * (max - min);
const units = ['year', 'month', 'day', 'hour', 'minute', 'second', 'millisecond'];
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = n => String(n).padStart(2, '0');
const measureLabel = label => Math.max(...label.split('\n').map(line => line.length * 7));
const demoHtml = readFileSync(new URL('../demos/log-time-axis.html', import.meta.url), 'utf8').match(/<body[^>]*>([\s\S]*?)<script/)[1];

class MeasuredPlot extends uPlot {
	constructor(opts, data, host) {
		super(opts, data, (self, init) => {
			self.ctx.measureText = text => ({ width: text.length * 7 });
			host.appendChild(self.root);
			init();
		});
	}
}

class MeasuredOffscreenCanvas {
	getContext() {
		return { font: '', measureText: text => ({ width: text.length * 7 }) };
	}
}

async function withDemos(configs, run) {
	const OriginalOffscreenCanvas = globalThis.OffscreenCanvas;
	globalThis.OffscreenCanvas = MeasuredOffscreenCanvas;
	let mounted;
	try {
		mounted = configs.map(({ now = max, Plot = MeasuredPlot, widths } = {}) => {
			const fixture = document.createElement('div');
			fixture.innerHTML = demoHtml;
			document.body.append(fixture);
			if (widths != null) {
				for (const [id, width] of [['chart', widths[0]], ['linear-chart', widths[1]]])
					Object.defineProperty(fixture.querySelector(`#${id}`), 'clientWidth', { value: width });
			}
			return { fixture, ...createLogTimeDemo(Plot, fixture, now) };
		});
	}
	finally {
		if (OriginalOffscreenCanvas == null)
			delete globalThis.OffscreenCanvas;
		else
			globalThis.OffscreenCanvas = OriginalOffscreenCanvas;
	}
	try {
		await Promise.resolve();
		await run(mounted);
	}
	finally {
		for (const { fixture, plot, linear } of mounted) {
			plot.destroy();
			linear.destroy();
			fixture.remove();
		}
	}
}

function checkTicks(ticks, lo, hi, transform, width, spacing = 62) {
	assert.ok(ticks.length > 0, 'a usable axis has ticks');
	assert.ok(ticks.length <= Math.floor(width / spacing) + 1, 'tick count respects spacing, including endpoints');
	let previous = -Infinity;
	let previousTime = -Infinity;
	for (const tick of ticks) {
		assert.ok(Number.isFinite(tick.time) && tick.time >= lo && tick.time <= hi, 'finite timestamp within domain');
		assert.ok(tick.time > previousTime, 'unique, increasing timestamps');
		assert.ok(Number.isFinite(tick.position) && tick.position >= 0 && tick.position <= width, 'finite position within axis');
		assert.ok(Math.abs(tick.position - transform.fwd(tick.time) * width) < 1e-6, 'position matches transform');
		assert.ok(tick.position - previous >= spacing - 1e-6, 'minimum pixel spacing');
		assert.ok(tick.label.length > 0);
		previous = tick.position;
		previousTime = tick.time;
	}
}

function checkCalendarTicks(ticks) {
	const ranks = ticks.map(tick => units.indexOf(tick.unit));
	assert.ok(ranks.every(rank => rank >= 0), 'known calendar units');
	assert.deepEqual(ranks, ranks.slice().sort((a, b) => a - b), 'coarse-to-fine units never reverse');
	for (const tick of ticks) {
		const date = new Date(tick.time);
		if (tick.unit == 'year')
			assert.deepEqual([date.getUTCMonth(), date.getUTCDate(), tick.time % day], [0, 1, 0], 'annual ticks stay on UTC Jan 1');
		else if (tick.unit == 'month')
			assert.deepEqual([date.getUTCDate(), tick.time % day], [1, 0]);
		else
			assert.equal(tick.time % tick.step, 0);
	}
}

function checkMeasuredTicks(ticks, lo, hi, transform, width, measure = measureLabel) {
	checkTicks(ticks, lo, hi, transform, width, 31);
	checkCalendarTicks(ticks);
	for (const tick of ticks)
		assert.equal(tick.labelWidth, measure(tick.label), 'label reports its measured maximum line width');
	let firstYear = Date.UTC(new Date(lo).getUTCFullYear(), 0, 1);
	if (firstYear < lo)
		firstYear = Date.UTC(new Date(lo).getUTCFullYear() + 1, 0, 1);
	const extent = ticks.find(tick => hi - lo >= year && tick.time == firstYear && tick.unit == 'year');
	const edges = [{ position: -31, labelWidth: 62 }, ...ticks, { position: width + 31, labelWidth: 62 }];
	for (let i = 1; i < edges.length; i++) {
		const left = edges[i - 1];
		const right = edges[i];
		if (extent != null && (left.label == null && right === extent || right.label == null && left === extent))
			continue;
		assert.ok(right.position - left.position >= Math.max(31, (left.labelWidth + right.labelWidth) / 2 + 8) - 1e-6,
			`labels clear both neighbors and boundaries: ${left.label ?? 'start'} / ${right.label ?? 'end'}`);
	}
}

function checkAgeLabels(ticks, anchor) {
	const durations = { ms: 1, s: second, m: minute, h: hour, d: day, w: 7 * day, mo: year / 12, y: year };
	for (const tick of ticks) {
		if (tick.label == 'now')
			assert.equal(tick.time, anchor);
		else {
			const match = /^-(\d+(?:\.\d+)?)(ms|s|mo|m|h|d|w|y)$/.exec(tick.label);
			assert.ok(match, `concise age label: ${tick.label}`);
			assert.ok(Math.abs(anchor - tick.time - +match[1] * durations[match[2]]) < 1, `age matches anchor: ${tick.label}`);
		}
	}
}

describe('adaptive log time demo', () => {
	it('keeps transform endpoints, monotonicity, representable round trips, and recent-detail shape', () => {
		for (const mode of ['log', 'exp']) {
			for (const tau of [tauMin, hour, 30 * day, tauMax]) {
				const transform = recentTimeTransform(min, max, tau, mode);
				assert.deepEqual([transform.fwd(min), transform.fwd(max), transform.bwd(0), transform.bwd(1)], [0, 1, min, max]);
				let previous = -1;
				for (const time of [min, Date.UTC(2010, 0, 1), Date.UTC(2025, 0, 1), max - day, max - second, max]) {
					const position = transform.fwd(time);
					assert.ok(Number.isFinite(position) && position >= previous && position <= 1);
					if (position > 0 || time == min)
						assert.ok(Math.abs(transform.bwd(position) - time) < 1, 'timestamp round trip where history is representable');
					previous = position;
				}
				for (const position of [0, .000001, .01, .5, .99, 1]) {
					const time = transform.bwd(position);
					assert.ok(Number.isFinite(time) && time >= min && time <= max);
					assert.ok(Math.abs(transform.fwd(time) - position) < 2e-9, `position round trip at ${position}`);
				}
			}
			const compressed = recentTimeTransform(min, max, tauMin, mode);
			const nearLinear = recentTimeTransform(min, max, tauMax, mode);
			assert.ok(1 - compressed.fwd(max - hour) > 1 - nearLinear.fwd(max - hour), `${mode} gives recent data more space as tau shrinks`);
		}
	});

	it('handles exponential underflow and applies anchor semantics without changing endpoints', () => {
		const underflow = recentTimeTransform(min, max, tauMin, 'exp');
		assert.equal(underflow.fwd(min + day), 0);
		assert.equal(underflow.fwd(max - 365 * day), 0);
		assert.equal(underflow.bwd(0), min);
		assert.ok(underflow.fwd(max - minute) > 0);

		const anchor = max + 90 * day;
		for (const mode of ['log', 'exp']) {
			const base = recentTimeTransform(min, max, hour, mode);
			const shifted = recentTimeTransform(min, max, hour, mode, anchor);
			assert.deepEqual([shifted.fwd(min), shifted.fwd(max), shifted.bwd(0), shifted.bwd(1)], [0, 1, min, max]);
			for (const value of [min + day, max - day, max - hour])
				assert.equal(shifted.fwd(value) == base.fwd(value), mode == 'exp', `${mode} anchor behavior`);
		}
	});

	it('keeps fixed and measured calendar ticks valid across focused boundaries and logarithmic samples', () => {
		for (const mode of ['log', 'exp']) {
			for (const tau of [tauMin, tauMax]) {
				for (const width of [320, 1127, 1131, 1200]) {
					const transform = recentTimeTransform(min, max, tau, mode);
					const fixed = calendarTicks(min, max, transform, width);
					checkTicks(fixed, min, max, transform, width);
					checkCalendarTicks(fixed);
					checkMeasuredTicks(calendarTicks(min, max, transform, width, 62, max, measureLabel), min, max, transform, width);
				}
			}
		}
		const samples = Array.from({ length: 8 }, (_, i) => tauMin * (tauMax / tauMin) ** (i / 7));
		for (const [i, tau] of samples.entries()) {
			const mode = i % 2 ? 'exp' : 'log';
			const width = [320, 800, 1127, 1131, 1200][i % 5];
			const transform = recentTimeTransform(min, max, tau, mode);
			const ticks = calendarTicks(min, max, transform, width);
			checkTicks(ticks, min, max, transform, width);
			checkCalendarTicks(ticks);
		}
		const compressed = calendarTicks(min, max, recentTimeTransform(min, max, tauMin), 1000);
		const uniform = calendarTicks(min, max, recentTimeTransform(min, max, tauMax), 1000);
		assert.ok(compressed.some(tick => tick.unit == 'minute'));
		assert.ok(uniform.every(tick => tick.unit == 'year' || tick.unit == 'month'));
	});

	it('bounds the worst-case measured refinement call budget', () => {
		const transform = recentTimeTransform(min, max, tauMin, 'exp');
		const calls = { fwd: 0, bwd: 0, measure: 0 };
		const ticks = calendarTicks(min, max, {
			fwd: time => (calls.fwd++, transform.fwd(time)),
			bwd: position => (calls.bwd++, transform.bwd(position)),
		}, 1200, 62, max, label => (calls.measure++, measureLabel(label)));
		assert.ok(Object.values(calls).every(count => count > 0 && count < 2000), `bounded calls: ${JSON.stringify(calls)}`);
		checkMeasuredTicks(ticks, min, max, transform, 1200);
	});

	it('keeps the exact earliest annual extent and the 2017, 2020, 2023 fit regression', () => {
		const end = Date.UTC(2026, 8, 17, 3);
		const start = end - 3650 * day;
		const transform = recentTimeTransform(start, end, hour);
		const ticks = calendarTicks(start, end, transform, 1127, 62, end, measureLabel);
		const time = Date.UTC(2017, 0, 1);
		assert.ok(Math.abs(transform.fwd(time) * 1127 - 2.86) < .01);
		assert.deepEqual(ticks[0], { time, position: transform.fwd(time) * 1127, unit: 'year', step: 1, label: '2017', labelWidth: 28 });
		assert.deepEqual(ticks.slice(0, 3).map(tick => tick.label), ['2017', '2020', '2023']);
		assert.ok(ticks[0].position - ticks[0].labelWidth / 2 < 0, 'extent uses the left margin without moving its center');
		checkMeasuredTicks(ticks, start, end, transform, 1127);

		const january = Date.UTC(2017, 0, 1);
		const cases = [['log', tauMin, 320, null], ['log', tauMax, 1200, measureLabel], ['exp', tauMin, 1127, measureLabel], ['exp', tauMax, 1131, null]];
		for (const [lo, expected] of [[january, january], [january + 1, Date.UTC(2018, 0, 1)]]) {
			for (const [mode, tau, width, measure] of cases) {
				const current = recentTimeTransform(lo, end, tau, mode);
				const annual = calendarTicks(lo, end, current, width, 62, end, measure);
				assert.deepEqual([annual[0].time, annual[0].position, annual[0].unit, annual[0].step], [expected, current.fwd(expected) * width, 'year', 1]);
				assert.equal(annual.filter(tick => tick.time == expected).length, 1, 'annual seed is not duplicated');
			}
		}
	});

	it('uses the annual threshold without Jan 1 or leap-year drift', () => {
		const january = Date.UTC(2024, 0, 1);
		for (const span of [year - 1, year]) {
			const start = january - 1;
			const end = start + span;
			const transform = recentTimeTransform(start, end, hour);
			const ticks = calendarTicks(start, end, transform, 1127, 62, end, measureLabel);
			assert.equal(ticks.some(tick => tick.unit == 'year'), span == year);
			if (span == year)
				assert.equal(ticks[0].time, january);
		}
		const start = Date.UTC(2023, 11, 31, 12);
		const end = Date.UTC(2025, 0, 2);
		const transform = recentTimeTransform(start, end, end - start);
		const annual = calendarTicks(start, end, transform, 1200).filter(tick => tick.unit == 'year');
		assert.ok(annual.some(tick => tick.time == Date.UTC(2024, 0, 1)));
		checkCalendarTicks(annual);
	});

	it('uses annual outer margins and rejects labels that exceed them', () => {
		const start = Date.UTC(2024, 0, 1, 18);
		const end = Date.UTC(2025, 0, 1);
		const width = 360;
		const transform = { fwd: time => (time - start) / (end - start), bwd: position => start + position * (end - start) };
		assert.deepEqual(calendarTicks(start, end, transform, width, 62, end, measureLabel),
			[{ time: end, position: width, unit: 'year', step: 1, label: '2025', labelWidth: 28 }]);
		assert.ok(!calendarTicks(start, end, transform, width, 62, end, () => 64).some(tick => tick.unit == 'year'));
		const longEnd = Date.UTC(2026, 8, 17, 3);
		const longStart = longEnd - 3650 * day;
		const nonlinear = recentTimeTransform(longStart, longEnd, hour);
		assert.ok(!calendarTicks(longStart, longEnd, nonlinear, 1127, 62, longEnd, label => label == '2017' ? 70 : measureLabel(label))
			.some(tick => tick.label == '2017'));
	});

	it('fills Sep 16 when measured and rejects overlapping gap or boundary labels', () => {
		const end = Date.UTC(2026, 8, 17, 3);
		const start = end - 3650 * day;
		const width = 1127;
		const transform = recentTimeTransform(start, end, hour);
		const dates = [15, 16, 17].map(date => Date.UTC(2026, 8, date));
		const fixed = calendarTicks(start, end, transform, width);
		assert.deepEqual(dates.map(time => fixed.some(tick => tick.time == time)), [true, false, true]);
		const measured = calendarTicks(start, end, transform, width, 62, end, measureLabel);
		checkMeasuredTicks(measured, start, end, transform, width);
		assert.deepEqual(dates.map(time => measured.find(tick => tick.time == time)?.label), ['Sep 15', 'Sep 16', 'Sep 17']);

		const gapStart = Date.UTC(2026, 8, 14);
		const gapEnd = Date.UTC(2026, 8, 20);
		const linear = { fwd: time => (time - gapStart) / (gapEnd - gapStart), bwd: p => gapStart + p * (gapEnd - gapStart) };
		const middle = calendarTicks(gapStart, gapEnd, linear, 360, 62, gapEnd, label => label == 'Sep 17' ? 100 : 14);
		assert.ok(middle.some(tick => tick.label == 'Sep 17'));
		assert.ok(!middle.some(tick => tick.time == Date.UTC(2026, 8, 16) || tick.time == Date.UTC(2026, 8, 18)));
		const edges = calendarTicks(gapStart, gapEnd, linear, 360, 62, gapEnd, () => 120);
		assert.ok([15, 19].every(date => !edges.some(tick => tick.time == Date.UTC(2026, 8, date))));
		assert.deepEqual(calendarTicks(gapStart, gapEnd, linear, 360, 62, gapEnd, () => 720), []);
	});

	it('uses concise UTC labels through seconds and milliseconds', () => {
		const end = Date.UTC(2026, 8, 16, 12);
		const seen = new Set();
		for (const span of [400 * day, 40 * day, 3 * day, 3 * hour, 10 * second]) {
			for (const anchor of [end, end + 400 * day]) {
				const start = end - span;
				for (const tick of calendarTicks(start, end, recentTimeTransform(start, end, span), 1200, 62, anchor)) {
					const date = new Date(tick.time);
					const otherYear = date.getUTCFullYear() != new Date(anchor).getUTCFullYear();
					if (tick.unit == 'month' || tick.unit == 'day') {
						const label = months[date.getUTCMonth()] + (tick.unit == 'day' ? ` ${date.getUTCDate()}` : '');
						assert.equal(tick.label, label + (otherYear ? `\n${date.getUTCFullYear()}` : ''));
						seen.add(`${tick.unit}:${otherYear}`);
					}
					else if (tick.unit == 'hour' || tick.unit == 'minute')
						assert.equal(tick.label, `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`);
					else if (tick.unit == 'second')
						assert.match(tick.label, /^\d\d:\d\d:\d\d$/);
					else if (tick.unit == 'millisecond')
						assert.match(tick.label, /^\d\d:\d\d:\d\d\.\d{3}$/);
					seen.add(tick.unit);
				}
			}
		}
		for (const shape of ['month:false', 'month:true', 'day:false', 'day:true', 'hour', 'minute', 'second', 'millisecond'])
			assert.ok(seen.has(shape), `exercised ${shape} labels`);
	});

	it('keeps bounded, spaced age ticks and shifted-anchor labels', () => {
		const cases = [['log', tauMin, 320, max], ['log', tauMax, 1200, max + 2 * day], ['exp', tauMin, 1200, max + 2 * day], ['exp', tauMax, 320, max]];
		for (const [mode, tau, width, anchor] of cases) {
			const transform = recentTimeTransform(min, max, tau, mode, anchor);
			const ticks = ageTicks(min, max, transform, width, 62, anchor);
			checkTicks(ticks, min, max, transform, width);
			checkAgeLabels(ticks, anchor);
			assert.equal(ticks.some(tick => tick.label == 'now'), anchor == max);
		}
		for (const [span, label] of [[6 * hour, '-1h'], [7 * day, '-2d']]) {
			const start = max - span;
			assert.ok(ageTicks(start, max, recentTimeTransform(start, max, 20 * span), 1200).some(tick => tick.label == label));
		}
		const shifted = ageTicks(max - 7 * day, max, recentTimeTransform(max - 7 * day, max, 140 * day), 1200, 62, max + 2 * day);
		assert.ok(shifted.some(tick => tick.time == max && tick.label == '-2d'));

		const anchor = max + hour + second;
		const transform = recentTimeTransform(min, max, tauMin, 'exp', anchor);
		const expanded = ageTicks(min, max, transform, 1000, 62, anchor);
		checkAgeLabels(expanded, anchor);
		assert.ok(expanded.filter(tick => tick.position >= 500).length >= 3);
		assert.deepEqual([expanded.at(-1).time, expanded.at(-1).label], [max, '-3601s']);
	});

	it('honors explicit spacing and rejects unusable axes', () => {
		for (const tickFn of [calendarTicks, ageTicks]) {
			const transform = recentTimeTransform(min, max, hour);
			checkTicks(tickFn(min, max, transform, 1000, 96), min, max, transform, 1000, 96);
			assert.deepEqual(tickFn(min, max, transform, 0), []);
			assert.deepEqual(tickFn(min, max, transform, 1000, 0), []);
			assert.deepEqual(tickFn(min, min, transform, 1000), []);
		}
	});

	it('generates deterministic four-tier data over exactly 3650 days', () => {
		const now = Date.UTC(2024, 1, 29, 3, 17, 23, 123);
		const data = latencyData(now);
		assert.deepEqual(data, latencyData(now));
		const [timestamps, p50, p99] = data;
		assert.deepEqual([timestamps[0], timestamps.at(-1)], [now - 3650 * day, now]);
		assert.equal(timestamps.length, p50.length);
		assert.equal(timestamps.length, p99.length);
		const tiers = [[now - 90 * day, 6 * hour], [now - 7 * day, hour], [now - 6 * hour, 5 * minute], [now, 10 * second]];
		for (const [end] of tiers)
			assert.ok(timestamps.includes(end));
		for (let i = 1; i < timestamps.length; i++) {
			const [, step] = tiers.find(([end]) => timestamps[i - 1] < end);
			assert.equal(timestamps[i] - timestamps[i - 1], step);
			assert.ok(Number.isFinite(p50[i]) && p99[i] > p50[i]);
		}
	});

	it('syncs two cursor flows by value, isolates demo keys, and clears active cursors on updates', async () => {
		await withDemos([{}, {}], async ([logDemo, expDemo]) => {
			for (const demo of [logDemo, expDemo]) {
				assert.equal(demo.plot.cursor.sync.key, demo.linear.cursor.sync.key);
				assert.notEqual(demo.plot.cursor.sync.key, null);
			}
			assert.notEqual(logDemo.plot.cursor.sync.key, expDemo.plot.cursor.sync.key);
			const flow = (source, target) => {
				const time = max - hour;
				const idx = source.data[0].indexOf(time);
				const latency = source.data[1][idx];
				source.setCursor({ left: source.valToPos(time, 'x'), top: source.valToPos(latency, 'y') }, true, true);
				assert.equal(target.cursor.idx, idx);
				assert.ok(Math.abs(target.cursor.left - target.valToPos(time, 'x')) < 1e-6);
				assert.notEqual(target.cursor.left, source.cursor.left, 'sync uses values, not pixels');
			};
			flow(logDemo.plot, logDemo.linear);
			expDemo.fixture.querySelector('#mode').value = 'exp';
			expDemo.fixture.querySelector('#mode').dispatchEvent(new Event('change'));
			await Promise.resolve();
			flow(expDemo.linear, expDemo.plot);
			logDemo.fixture.querySelector('#ticks').value = 'age';
			logDemo.fixture.querySelector('#ticks').dispatchEvent(new Event('change'));
			await Promise.resolve();
			for (const chart of [logDemo.plot, logDemo.linear])
				assert.deepEqual([chart.cursor.left, chart.cursor.top], [-10, -10], 'control update clears both synced cursors');
		});
	});

	it('updates one UI transition per control without replacing charts, data, domain, or linear state', async () => {
		const now = Date.UTC(2024, 1, 29, 3, 17, 23, 123);
		const start = now - 3650 * day;
		const localTauMax = 20 * (now - start);
		const created = [];
		class TrackedPlot extends MeasuredPlot {
			constructor(...args) {
				super(...args);
				created.push(this);
			}
		}
		const originalDateNow = Date.now;
		let wallClock = now + 2 * day;
		Date.now = () => wallClock;
		try {
			await withDemos([{ now, Plot: TrackedPlot, widths: [700, 930] }], async ([demo]) => {
				const { fixture, plot, linear, setTau } = demo;
				const data = plot.data;
				const originalData = data.map(values => values.slice());
				const roots = [plot.root, linear.root];
				const linearPositions = [start, now - day, now].map(time => linear.valToPos(time, 'x'));
				const mode = fixture.querySelector('#mode');
				const tickMode = fixture.querySelector('#ticks');
				const anchorMode = fixture.querySelector('#anchor');
				const slider = fixture.querySelector('#tau');
				const plotWidth = () => plot.over.clientWidth || parseFloat(plot.over.style.width);
				const checkMapping = (tau, anchor = anchorMode.value == 'now' ? wallClock : now) => {
					const transform = recentTimeTransform(start, now, tau, mode.value, anchor);
					for (const time of [start, now - day, now - minute, now])
						assert.ok(Math.abs(plot.valToPos(time, 'x') / plotWidth() - transform.fwd(time)) < 1e-9);
				};
				const checkAdapter = (tau, anchor) => {
					const transform = recentTimeTransform(start, now, tau, mode.value, anchor);
					const measure = label => Math.max(...label.split('\n').map(line => plot.ctx.measureText(line).width));
					const ticks = tickMode.value == 'calendar'
						? calendarTicks(start, now, transform, plotWidth(), 62, anchor, measure)
						: ageTicks(start, now, transform, plotWidth(), 62, anchor);
					assert.deepEqual(plot.axes[0]._splits, ticks.map(tick => tick.time));
					assert.deepEqual(plot.axes[0]._values, ticks.map(tick => tick.label));
				};

				assert.equal(created.length, 2);
				assert.deepEqual([plot.width, linear.width], [700, 930], 'options use each target client width');
				assert.equal(linear.data, data);
				assert.deepEqual(data, latencyData(now));
				checkMapping(hour, now);
				checkAdapter(hour, now);

				mode.value = 'exp';
				mode.dispatchEvent(new Event('change'));
				await Promise.resolve();
				checkMapping(hour, now);
				tickMode.value = 'age';
				tickMode.dispatchEvent(new Event('change'));
				await Promise.resolve();
				assert.match(fixture.querySelector('#tick-status').textContent, /age ticks/);
				anchorMode.value = 'now';
				anchorMode.dispatchEvent(new Event('change'));
				await Promise.resolve();
				const snapshot = plot.axes[0]._values.slice();
				wallClock += day;
				plot.redraw(true, true);
				await Promise.resolve();
				assert.deepEqual(plot.axes[0]._values, snapshot, 'redraw retains the wall-clock snapshot');

				const idx = data[0].indexOf(now - hour);
				plot.setCursor({ left: plot.valToPos(data[0][idx], 'x'), top: plot.valToPos(data[1][idx], 'y') }, true, true);
				anchorMode.dispatchEvent(new Event('change'));
				await Promise.resolve();
				assert.notDeepEqual(plot.axes[0]._values, snapshot, 'control update snapshots the advanced wall clock');
				assert.ok([plot, linear].every(chart => chart.cursor.left == -10));

				for (const [value, tau] of [['0', tauMin], ['100', localTauMax]]) {
					slider.value = value;
					slider.dispatchEvent(new Event('input'));
					await Promise.resolve();
					checkMapping(tau);
				}
				assert.throws(() => setTau(NaN), TypeError);
				assert.throws(() => setTau(undefined), TypeError);
				setTau(1);
				await Promise.resolve();
				checkMapping(tauMin);
				setTau(2 * localTauMax);
				await Promise.resolve();
				checkMapping(localTauMax);
				checkAdapter(localTauMax, wallClock);

				assert.equal(created.length, 2, 'controls retain the same chart instances');
				assert.deepEqual([plot.root, linear.root], roots);
				assert.ok(roots.every(root => fixture.contains(root)));
				assert.equal(plot.data, data);
				assert.equal(linear.data, data);
				assert.deepEqual(data, originalData, 'controls do not mutate shared data');
				for (const chart of [plot, linear])
					assert.deepEqual([chart.scales.x.min, chart.scales.x.max], [start, now]);
				assert.deepEqual([start, now - day, now].map(time => linear.valToPos(time, 'x')), linearPositions, 'linear mapping remains unchanged');
			});
		}
		finally {
			Date.now = originalDateNow;
		}
	});
});
