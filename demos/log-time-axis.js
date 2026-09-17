// TODO:
// - Use uPlot's DateZoned class for timezone-aware splits and calendar boundaries, including DST.
// - Use the existing time-axis label templates for per-tick formatting, as on normal X axes.
// - Add official exponential/recent-time scale distributions to uPlot's distr options instead of distr: 100.

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const AVG_YEAR = 365.25 * DAY;
const DATA_SPAN = 10 * 365 * DAY;
const TICK_SPACING = 62;
const TICK_MARGIN = TICK_SPACING / 2;
const AXIS_FONT = '12px system-ui, sans-serif';
const WIDTH_PERIODS = [[HOUR, 'hour'], [DAY, 'day'], [30 * DAY, '30 days']];
let demoId = 0;

export function recentTimeTransform(min, max, tau, mode = 'log', anchor = max) {
	// Fixed endpoints always map to 0 and 1, even when controls change between redraws.
	if (mode == 'exp') {
		const span = (max - min) / tau;
		const denom = -Math.expm1(-span);
		const floor = Math.exp(-span);

		// Anchor factors cancel after normalization. Very old history can underflow to zero.
		return {
			fwd: t => t == min ? 0 : t == max ? 1 : Math.exp((t - max) / tau) * -Math.expm1(-(t - min) / tau) / denom,
			bwd: p => p == 0 ? min : p == 1 ? max : max + tau * (span < 1
				? Math.log1p((p - 1) * denom)
				: Math.log(p + (1 - p) * floor)),
		};
	}

	const range = max - min;
	const effectiveTau = tau + anchor - max;
	const span = Math.log1p(range / effectiveTau);
	return {
		fwd: t => t == min ? 0 : t == max ? 1 : Math.log1p((t - min) / (effectiveTau + max - t)) / span,
		bwd: p => p == 0 ? min : p == 1 ? max : min + (effectiveTau + range) * -Math.expm1(-p * span),
	};
}

// Pixel-space jumping makes coarse calendar increments unnecessary. For each unit,
// use the earliest boundary that clears the preceding label.
const levels = [
	{ unit: 'year', step: 1 },
	{ unit: 'month', step: 1 },
	{ unit: 'day', step: DAY },
	{ unit: 'hour', step: HOUR },
	{ unit: 'minute', step: MINUTE },
	{ unit: 'second', step: SECOND },
	{ unit: 'millisecond', step: 1 },
];

function ceilBoundary(t, { unit, step }) {
	if (unit == 'year') {
		const year = new Date(t).getUTCFullYear();
		const start = Date.UTC(year, 0, 1);
		return start >= t ? start : Date.UTC(year + 1, 0, 1);
	}

	if (unit == 'month') {
		const date = new Date(t);
		const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
		return start >= t ? start : Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
	}

	// Fixed durations align to UTC boundaries; local-time DST is outside this demo's scope.
	return Math.ceil(t / step) * step;
}

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = n => String(n).padStart(2, '0');

function tickLabel(t, unit, anchorYear) {
	const d = new Date(t);
	const day = `${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
	const hm = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;

	if (unit == 'year')
		return String(d.getUTCFullYear());
	const year = d.getUTCFullYear() == anchorYear ? '' : `\n${d.getUTCFullYear()}`;
	if (unit == 'month')
		return months[d.getUTCMonth()] + year;
	if (unit == 'day')
		return day + year;
	if (unit == 'hour' || unit == 'minute')
		return hm;

	const hms = `${hm}:${pad(d.getUTCSeconds())}`;
	return unit == 'second' ? hms : `${hms}.${String(d.getUTCMilliseconds()).padStart(3, '0')}`;
}

export function calendarTicks(min, max, transform, width, spacing = TICK_SPACING, anchor = max, measureLabel = null) {
	if (!(width > 0) || !(spacing > 0) || !(max > min))
		return [];

	let ticks = [];
	const measured = measureLabel != null;
	const anchorYear = new Date(anchor).getUTCFullYear();
	const start = { position: -spacing / 2, labelWidth: spacing };
	const end = { position: width + spacing / 2, labelWidth: spacing };
	const minSpacing = measured ? spacing / 2 : spacing;
	const budget = 2 * Math.ceil(width / minSpacing);
	const separation = (a, b, distance) => measured ? Math.max(distance, (a.labelWidth + b.labelWidth) / 2 + 8) : spacing;

	function makeTick(time, level, position = transform.fwd(time) * width) {
		const label = tickLabel(time, level.unit, anchorYear);
		return { time, position, unit: level.unit, step: level.step, label, labelWidth: measured ? measureLabel(label) : 0 };
	}

	function refineLevel(level, frontier, distance) {
		const edges = [frontier, ...ticks.filter(tick => tick.position > frontier.position), end];
		const added = [];

		for (let i = 1; i < edges.length; i++) {
			let left = edges[i - 1];
			const right = edges[i];
			let target = left.position + distance;
			const stop = right.position - distance;

			// Jump in pixel space instead of enumerating calendar units across compressed history.
			for (let attempt = 0; attempt < budget && target <= stop; attempt++) {
				const time = ceilBoundary(transform.bwd(target / width), level);
				const position = transform.fwd(time) * width;

				if (!Number.isFinite(position) || time < min || time > max || position > stop || position < target - 1e-6)
					break;

				const tick = makeTick(time, level, position);
				const next = left.position + separation(left, tick, distance);
				if (position < next - 1e-6) {
					target = next;
					continue;
				}
				if (right.position - position < separation(tick, right, distance) - 1e-6)
					break;

				added.push(tick);
				left = tick;
				target = position + distance;
			}
		}

		ticks = ticks.concat(added).sort((a, b) => a.time - b.time);
	}

	// Reserve the earliest year boundary before later labels can crowd it out.
	const yearLevel = levels[0];
	if (max - min >= AVG_YEAR) {
		const tick = makeTick(ceilBoundary(min, yearLevel), yearLevel);
		if (tick.time <= max && Number.isFinite(tick.position) && tick.position >= 0 && tick.position <= width &&
			tick.position - tick.labelWidth / 2 >= -spacing / 2 && tick.position + tick.labelWidth / 2 <= width + spacing / 2)
			ticks.push(tick);
	}

	// Annual labels use the earliest boundary that fits. Finer units preserve a
	// preferred-spacing pass before filling measured gaps in the expanded tail.
	let frontier = ticks.length > 0 ? ticks[ticks.length - 1] : start;
	refineLevel(yearLevel, frontier, measured ? minSpacing : spacing);

	for (const level of levels.slice(1)) {
		frontier = ticks.length > 0 ? ticks[ticks.length - 1] : start;
		refineLevel(level, frontier, spacing);
		if (measured)
			refineLevel(level, frontier, minSpacing);
	}

	return ticks;
}

const ageUnits = [[AVG_YEAR, 'y'], [AVG_YEAR / 12, 'mo'], [7 * DAY, 'w'], [DAY, 'd'], [HOUR, 'h'], [MINUTE, 'm'], [SECOND, 's'], [1, 'ms']];
const ageSteps = [
	0, 1, 10, 100,
	...[1, 2, 5, 10, 15, 30].map(n => n * SECOND),
	...[1, 2, 5, 15, 30].map(n => n * MINUTE),
	...[1, 2, 3, 6, 12].map(n => n * HOUR),
	...[1, 2, 3, 7, 14].map(n => n * DAY),
	...[1, 3, 6].map(n => n * AVG_YEAR / 12),
	...[1, 2, 5, 10, 25, 50, 100].map(n => n * AVG_YEAR),
];
const positiveAgeSteps = ageSteps.slice(1);

function ageLabel(age) {
	if (age == 0)
		return 'now';
	const [size, unit] = ageUnits.find(([size]) => age % size == 0) || ageUnits[ageUnits.length - 1];
	return `-${age / size}${unit}`;
}

export function ageTicks(min, max, transform, width, spacing = TICK_SPACING, anchor = max) {
	if (!(width > 0) || !(spacing > 0) || !(max > min))
		return [];

	const candidates = new Set(ageSteps);
	if (anchor > max) {
		// A shifted anchor can put all preset ages outside the expanded region.
		// Sample that region in pixel space and align ages to the same duration steps.
		for (let position = width; position >= 0; position -= spacing) {
			const age = anchor - transform.bwd(position / width);
			for (const step of positiveAgeSteps)
				candidates.add(Math.ceil(age / step) * step);
		}
	}

	const ticks = [];
	let previous = Infinity;

	// Prefer recent labels and discard candidates that crowd them in pixel space.
	for (const age of [...candidates].sort((a, b) => a - b)) {
		const time = anchor - age;
		if (time < min || time > max)
			continue;
		const position = transform.fwd(time) * width;
		if (!Number.isFinite(position) || position < 0 || position > width || previous - position < spacing)
			continue;
		ticks.push({ time, position, label: ageLabel(age) });
		previous = position;
	}

	return ticks.reverse();
}

// Tiered storage and latency model adapted from the demo attached to uPlot issue #1143.
export function latencyData(now) {
	const start = now - DATA_SPAN;
	const tiers = [
		[start, now - 90 * DAY, 6 * HOUR],
		[now - 90 * DAY, now - 7 * DAY, HOUR],
		[now - 7 * DAY, now - 6 * HOUR, 5 * MINUTE],
		[now - 6 * HOUR, now, 10 * SECOND],
	];
	const x = [], p50 = [], p99 = [];
	let seed = 42;
	const rand = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;

	for (const [from, to, step] of tiers) {
		for (let t = from; t < to; t += step) {
			const days = (t - start) / DAY;
			const tod = (t % DAY) / DAY * Math.PI * 2;
			let base = 42 + 14 * Math.sin(tod - 1.2) + 6 * Math.sin(days / 7 * Math.PI * 2) + days * 0.011 + (rand() - 0.5) * 5;
			const age = now - t;
			if (age < 90 * MINUTE)
				base += 34 * Math.exp(-age / (35 * MINUTE)) * (0.75 + rand() * 0.5);
			x.push(t);
			p50.push(+base.toFixed(2));
			p99.push(+(base * (1.7 + rand() * 0.5) + 8).toFixed(2));
		}
	}

	x.push(now);
	p50.push(p50[p50.length - 1]);
	p99.push(p99[p99.length - 1]);
	return [x, p50, p99];
}

function durationLabel(duration) {
	const [size, unit] = duration >= AVG_YEAR ? [AVG_YEAR, 'year'] : duration >= DAY ? [DAY, 'day'] :
		duration >= HOUR ? [HOUR, 'hour'] : duration >= MINUTE ? [MINUTE, 'minute'] : [SECOND, 'second'];
	const value = +(duration / size).toFixed(1);
	return `${value.toLocaleString('en-US')} ${unit}${value == 1 ? '' : 's'}`;
}

export function createLogTimeDemo(uPlot, root, now = Date.now()) {
	const data = latencyData(now);
	const min = data[0][0];
	const max = now;
	const tauMin = 5 * MINUTE;
	const tauMax = 20 * (max - min);
	let tau = HOUR;
	let anchor = max;
	let transform;
	let ticks = [];
	let axisWidth = 0;

	const slider = root.querySelector('#tau');
	const output = root.querySelector('#tau-value');
	const status = root.querySelector('#tick-status');
	const mode = root.querySelector('#mode');
	const tickMode = root.querySelector('#ticks');
	const anchorMode = root.querySelector('#anchor');
	const host = root.querySelector('#chart');
	const linearHost = root.querySelector('#linear-chart');
	const hint = root.querySelector('#hint');
	const widthStatus = root.querySelector('#width-status');
	const domainStatus = root.querySelector('#domain-status');
	const syncKey = `log-time-axis-${++demoId}`;
	const ownerDocument = root.ownerDocument || root;
	const measureCanvas = typeof OffscreenCanvas == 'undefined' ? ownerDocument.createElement('canvas') : new OffscreenCanvas(1, 1);
	const measureCtx = measureCanvas.getContext('2d');
	measureCtx.font = AXIS_FONT;
	const measureLabel = label => Math.max(...label.split('\n').map(line => measureCtx.measureText(line).width));

	function updateControlState() {
		// Snapshot the clock once per update so fwd/bwd and tick labels use the same anchor.
		anchor = anchorMode.value == 'now' ? Math.max(max, Date.now()) : max;
		transform = recentTimeTransform(min, max, tau, mode.value, anchor);
		slider.value = String(100 * Math.log(tau / tauMin) / Math.log(tauMax / tauMin));
		output.textContent = durationLabel(tau);
		hint.textContent = mode.value == 'log'
			? 'Log spreads successive age ranges across the axis.'
			: 'Exp shows roughly the most recent 3–5 τ. Older data compresses at the left edge and can reach numerical zero. The anchor does not change normalized exp positions.';
		widthStatus.textContent = WIDTH_PERIODS
			.map(([age, label]) => `Final ${label}: ${(100 * (1 - transform.fwd(max - age))).toFixed(1)}%`).join(' · ');
	}

	updateControlState();
	domainStatus.textContent = `Fixed data snapshot: ${new Date(min).toISOString()} to ${new Date(max).toISOString()}.`;

	function axisStyle() {
		return {
			font: AXIS_FONT,
			stroke: '#68717d',
			grid: { stroke: '#e8ecf0', width: 1 },
			ticks: { stroke: '#cbd2d9', width: 1 },
		};
	}

	function options(target) {
		return {
			width: Math.max(320, Math.min(1200, target.clientWidth || 1000)),
			height: 300,
			ms: 1,
			padding: [0, TICK_MARGIN, 0, 0],
			tzDate: ts => uPlot.tzDate(ts, 'UTC'),
			cursor: {
				drag: { setScale: false },
				sync: { key: syncKey },
			},
			scales: {
				x: { time: true, range: [min, max] },
				y: { range: (u, min, max) => [0, max * 1.1] },
			},
			axes: [{ ...axisStyle(), size: 54, space: TICK_SPACING }, { ...axisStyle(), size: 48 }],
			series: [
				{ value: (u, t) => t == null ? '' : new Date(t).toISOString() },
				{ label: 'p50 ms', stroke: '#5ac8fa', fill: 'rgba(90,200,250,0.10)', width: 1.25, points: { show: false } },
				{ label: 'p99 ms', stroke: '#ff9f0a', width: 1.25, points: { show: false } },
			],
		};
	}

	const opts = options(host);
	Object.assign(opts.scales.x, {
		distr: 100,
		fwd: t => transform.fwd(t),
		bwd: p => transform.bwd(p),
	});
	Object.assign(opts.axes[0], {
		// Keep the linear increment selector from gating our independently generated splits.
		incrs: (u, axisIdx, min, max, width) => {
			axisWidth = width;
			return [max - min];
		},
		splits: () => {
			const calendar = tickMode.value == 'calendar';
			ticks = calendar
				? calendarTicks(min, max, transform, axisWidth, TICK_SPACING, anchor, measureLabel)
				: ageTicks(min, max, transform, axisWidth, TICK_SPACING, anchor);
			status.textContent = calendar
				? `${ticks.length} UTC ticks · ${[...new Set(ticks.map(tick => tick.unit))].join(', ')}`
				: `${ticks.length} age ticks · relative to ${anchorMode.value == 'max' ? 'view max' : 'wall clock'}`;
			return ticks.map(tick => tick.time);
		},
		filter: (u, splits) => splits,
		values: () => ticks.map(tick => tick.label),
	});
	const plot = new uPlot(opts, data, host);
	const linear = new uPlot(options(linearHost), data, linearHost);

	function update() {
		if (plot.cursor.left >= 0 || linear.cursor.left >= 0)
			plot.setCursor({ left: -10, top: -10 }, true, true);
		updateControlState();
		plot.redraw(true, true);
	}

	function setTau(value) {
		value = Number(value);
		if (!Number.isFinite(value))
			throw new TypeError('tau must be a finite number');
		tau = Math.max(tauMin, Math.min(tauMax, value));
		update();
	}

	slider.oninput = () => setTau(tauMin * (tauMax / tauMin) ** (+slider.value / 100));
	mode.onchange = tickMode.onchange = anchorMode.onchange = update;

	return { plot, linear, setTau };
}
