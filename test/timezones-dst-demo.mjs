import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';
import groups, { calendarGroups } from '../demos/timezones-dst.js';
import { getDemoSteps } from '../scripts/demoSteps.mjs';

const day = 86400;
const seconds = iso => Date.parse(iso) / 1000;
// Civil dates and explicit historical offsets keep the oracle independent of uPlot's resolver.
const midnights = (month, dates, offset) => dates.map(date =>
	seconds(`${month}-${String(date).padStart(2, '0')}T00:00:00${offset}`));
const correctedStart = seconds('1986-01-01T00:15:00+05:45');
const upperBoundary = seconds('1986-01-01T00:30:00+05:45');
const kathmanduEndTicks = [
	...midnights('1985-12', [24, 25, 26, 27, 28, 29, 30, 31], '+05:30'), correctedStart,
];
const kathmanduLaterTicks = midnights('1986-01', [2, 3, 4, 5, 6, 7, 8, 9], '+05:45');

const expectedGroups = {
	'midnight-gaps': {
		santiago: {
			zone: 'America/Santiago', ticks: [
				...midnights('2026-09', [2, 3, 4, 5], '-04:00'),
				seconds('2026-09-06T01:00:00-03:00'),
				...midnights('2026-09', [7, 8, 9, 10], '-03:00'),
			],
		},
		'sao-paulo': {
			zone: 'America/Sao_Paulo', ticks: [
				...midnights('2018-11', [1, 2, 3], '-03:00'),
				seconds('2018-11-04T01:00:00-02:00'),
				...midnights('2018-11', [5, 6, 7, 8, 9], '-02:00'),
			],
		},
	},
	'fractional-offsets': {
		'lord-howe-back': {
			zone: 'Australia/Lord_Howe', ticks: [
				...midnights('2024-04', [4, 5, 6, 7], '+11:00'),
				...midnights('2024-04', [8, 9, 10, 11, 12], '+10:30'),
			],
		},
		'lord-howe-forward': {
			zone: 'Australia/Lord_Howe', ticks: [
				...midnights('2024-10', [3, 4, 5, 6], '+10:30'),
				...midnights('2024-10', [7, 8, 9, 10, 11], '+11:00'),
			],
		},
		'lord-howe-two-day': {
			zone: 'Australia/Lord_Howe', days: 2, ticks: [
				...midnights('2024-04', [1, 3, 5, 7], '+11:00'),
				...midnights('2024-04', [9, 11, 13, 15, 17], '+10:30'),
			],
		},
		norfolk: {
			zone: 'Pacific/Norfolk', days: 7, first: true, ticks: [
				...midnights('2015-10', [1], '+11:30'),
				...midnights('2015-10', [8, 15, 22], '+11:00'),
				...midnights('2015-11', [1, 8, 15, 22], '+11:00'),
				...midnights('2015-12', [1], '+11:00'),
			],
		},
	},
	'two-hour-dst': {
		'troll-forward': {
			zone: 'Antarctica/Troll', ticks: [
				...midnights('2024-03', [27, 28, 29, 30, 31], 'Z'),
				...midnights('2024-04', [1, 2, 3, 4], '+02:00'),
			],
		},
		'troll-back': {
			zone: 'Antarctica/Troll', ticks: [
				...midnights('2024-10', [23, 24, 25, 26, 27], '+02:00'),
				...midnights('2024-10', [28, 29, 30, 31], 'Z'),
			],
		},
	},
	'kathmandu-gap': {
		daily: {
			zone: 'Asia/Kathmandu', ticks: [
				...midnights('1985-12', [28, 29, 30, 31], '+05:30'), correctedStart,
				...midnights('1986-01', [2, 3, 4, 5], '+05:45'),
			],
		},
		'ends-at-start': { zone: 'Asia/Kathmandu', ticks: kathmanduEndTicks },
		'ends-after-start': { zone: 'Asia/Kathmandu', ticks: kathmanduEndTicks },
		'starts-at-start': { zone: 'Asia/Kathmandu', ticks: [correctedStart, ...kathmanduLaterTicks] },
		'starts-after-start': { zone: 'Asia/Kathmandu', ticks: kathmanduLaterTicks },
		monthly: {
			zone: 'Asia/Kathmandu', days: 30, ticks: [correctedStart,
				...[2, 3, 4, 5, 6, 7, 8, 9].map(month => seconds(`1986-${String(month).padStart(2, '0')}-01T00:00:00+05:45`)),
			],
		},
		yearly: {
			zone: 'Asia/Kathmandu', days: 365, ticks: [correctedStart,
				...[1987, 1988, 1989, 1990, 1991, 1992, 1993, 1994].map(year => seconds(`${year}-01-01T00:00:00+05:45`)),
			],
		},
	},
	'large-rollback': {
		kanton: {
			zone: 'Pacific/Kanton', ticks: [
				...midnights('1937-08', [28, 29, 30], 'Z'),
				...midnights('1937-08', [31], '-12:00'),
				...midnights('1937-09', [1, 2, 3], '-12:00'),
			],
		},
	},
	// These charts document current limitations, not ideal calendar behavior.
	'calendar-limitations': {
		'kwajalein-prefix': {
			zone: 'Pacific/Kwajalein', days: 2, first: true, sparse: true,
			ticks: midnights('1993-08', [15, 17, 19], '-12:00'),
		},
		'kwajalein-empty': { zone: 'Pacific/Kwajalein', days: 2, first: true, sparse: true, ticks: [] },
		'havana-range': {
			zone: 'America/Havana', ticks: midnights('2020-11', [1, 2, 3, 4, 5, 6, 7, 8, 9], '-05:00'),
		},
		'havana-two-day': {
			zone: 'America/Havana', days: 2, first: true,
			ticks: midnights('2020-11', [1, 3, 5, 7, 9, 11, 13, 15], '-05:00'),
		},
		'havana-seven-day': {
			zone: 'America/Havana', days: 7, first: true, ticks: [
				...midnights('2020-11', [1, 8, 15, 22], '-05:00'),
				...midnights('2020-12', [1, 8, 15, 22], '-05:00'),
				...midnights('2021-01', [1], '-05:00'),
			],
		},
		'synthetic-gap': {
			zone: 'UTC', transition: '2024-01-01T23:30:00Z', ticks: [
				...midnights('2023-12', [29, 30, 31], 'Z'),
				...midnights('2024-01', [1, 2], 'Z'),
				...[2, 3, 4, 5].map(date => seconds(`2024-01-0${date}T23:00:00Z`)),
			],
		},
	},
};

function checkKathmanduBoundary(id, min, max, ticks) {
	if (id === 'ends-at-start' || id === 'ends-after-start') {
		assert.equal(max, id === 'ends-at-start' ? correctedStart : upperBoundary);
		assert.equal(ticks.at(-1), correctedStart, 'include the first valid instant at the upper boundary');
	}
	else if (id === 'starts-at-start') {
		assert.equal(min, correctedStart);
		assert.equal(ticks[0], correctedStart);
	}
	else if (id === 'starts-after-start') {
		assert.equal(min, seconds('1986-01-01T00:15:00.001+05:45'));
		assert.ok(!ticks.includes(correctedStart), 'exclude the midnight just outside the lower boundary');
		assert.equal(ticks[0], seconds('1986-01-02T00:00:00+05:45'));
	}
	else
		assert.ok(ticks.includes(correctedStart), 'retain the corrected day/month/year boundary');
}

function checkLabels(plot, example, ticks = plot.axes[0]._splits, labels = plot.axes[0]._values) {
	const incr = plot.axes[0]._found[0];
	const fmt = new Intl.DateTimeFormat('en-US', {
		timeZone: example.zone, year: 'numeric', month: 'numeric', day: 'numeric',
		hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
	});
	assert.equal(labels.length, ticks.length, 'every tick has a label');
	for (const [i, ts] of ticks.entries()) {
		const shift = example.transition && ts >= seconds(example.transition) ? 3600000 : 0;
		const parts = Object.fromEntries(fmt.formatToParts(new Date(ts * 1000 + shift)).map(part => [part.type, part.value]));
		const date = incr >= 365 * day ? parts.year : incr >= 30 * day
			? parts.month + '/' + parts.year.slice(-2) : parts.month + '/' + parts.day;
		assert.deepEqual(labels[i].split('\n'), [date, parts.hour + ':' + parts.minute,
			new Date(ts * 1000).toISOString().slice(11, 16) + 'Z'], 'local calendar label and unambiguous UTC instant');
	}
}

function checkAutoAxis(plot, expectedDays) {
	const axis = plot.axes[0];
	assert.equal(axis._space, 50, 'use default minimum spacing');
	assert.ok(axis._incrs.length > 20, 'retain the broad automatic time-increment table');
	for (const incr of [1, 60, 3600, day, 2 * day, 7 * day, 30 * day, 365 * day])
		assert.ok(axis._incrs.includes(incr), 'default candidates include ' + incr);
	assert.equal(axis._found[0], expectedDays * day, 'automatically choose the expected interval');
	assert.ok(axis._found[1] >= 50, 'selected nominal spacing meets the default minimum');
	assert.equal(axis.font[2], 12, 'use the default CSS font size');
	assert.equal(axis._size, 70, 'reserve room for three label lines');
}

describe('timezone/DST calendar demo behavior', () => {
	let previous;
	let plots;

	beforeEach(() => {
		previous = globalThis.uPlot;
		globalThis.uPlot = uPlot;
		plots = [];
	});

	afterEach(() => {
		try {
			for (const plot of plots)
				plot.destroy();
		}
		finally {
			globalThis.uPlot = previous;
		}
	});

	async function render(groupId, id) {
		const step = groups.find(group => group.id === groupId)?.steps.find(step => step.id === id);
		assert.ok(step, 'render step exists');
		plots = await step.render();
		assert.equal(plots.length, 1, 'each step returns one real chart');
		await new Promise(requestAnimationFrame);
		assert.equal(plots[0].status, 1);
		return plots[0];
	}

	it('appends all six groups and 22 stable chart IDs without renumbering the original groups', () => {
		const expected = Object.entries(expectedGroups).map(([id, examples]) => ({ id, steps: Object.keys(examples) }));
		assert.deepEqual(calendarGroups.map(group => ({ id: group.id, steps: group.examples.map(example => example.id) })), expected);
		assert.deepEqual(groups.slice(11).map(group => ({ id: group.id, steps: group.steps.map(step => step.id) })), expected);
		assert.equal(getDemoSteps(groups.slice(0, 11)).length, 51, 'retain every original chart');
		assert.equal(getDemoSteps(groups.slice(11)).length, 22, 'register every new calendar chart');
	});

	for (const [groupId, examples] of Object.entries(expectedGroups)) {
		for (const [id, expected] of Object.entries(examples)) {
			it(groupId + '/' + id, async () => {
				const example = calendarGroups.find(group => group.id === groupId)?.examples.find(example => example.id === id);
				assert.ok(example, 'calendar descriptor exists');
				assert.equal(example.zone, expected.zone);
				assert.ok(!Object.hasOwn(example, 'days'), 'ranges, not descriptor increments, drive tick selection');
				assert.equal(example.first ?? false, expected.first ?? false);
				if (expected.transition)
					assert.equal(example.transition, expected.transition, 'synthetic gap starts at 23:30 UTC');
				const [min, max] = [example.min, example.max].map(seconds);
				assert.ok(Number.isFinite(min) && Number.isFinite(max) && min < max, 'finite ISO range in seconds');

				const plot = await render(groupId, id);
				assert.equal(plot.width, 600);
				assert.equal(plot.axes[1].show, false);
				assert.equal(plot.cursor.show, true);
				assert.equal(plot.cursor.drag.x, true);
				assert.equal(plot.cursor.drag.setRange, true);
				assert.equal(plot.select.show, true);
				for (const selector of ['.u-cursor-x', '.u-cursor-y', '.u-select'])
					assert.ok(plot.root.querySelector(selector), selector + ' is available');
				assert.deepEqual([plot.scales.x.min, plot.scales.x.max], [min, max], 'preserve the exact visible range');
				assert.equal(plot.root.querySelector('.u-title')?.textContent, example.title);
				assert.ok(example.title.trim());
				assert.equal(plot.legend.show, false);
				assert.equal(plot.root.querySelector('.u-legend'), null);
				const note = plot.root.querySelector('.dst-note');
				assert.ok(note, 'explanation is inside the chart root');
				assert.equal(note.textContent, example.note);
				assert.ok(note.textContent.trim());
				if (groupId === 'calendar-limitations')
					assert.match(note.textContent, /^Known limitation:/);
				else
					assert.doesNotMatch(note.textContent, /^Known limitation:/);

				const axis = plot.axes[0];
				assert.deepEqual(axis.nice, { dst: true, first: expected.first ?? false });
				checkAutoAxis(plot, expected.days ?? 1);
				const ticks = axis._splits;
				assert.ok(ticks.every((ts, i) => Number.isFinite(ts) && ts >= min && ts <= max && (i === 0 || ts > ticks[i - 1])),
					'ticks are finite, strictly increasing, and inside the visible range');
				assert.deepEqual(ticks, expected.ticks, 'exact epochs from independent civil dates and offsets');
				assert.ok(ticks.length <= 11 && (expected.sparse || ticks.length >= 7),
					'ordinary charts show 7–11 ticks; only the Kwajalein limitations may be sparse');
				if (groupId === 'kathmandu-gap')
					checkKathmanduBoundary(id, min, max, ticks);
				checkLabels(plot, expected);

				if (expected.transition) {
					const transition = seconds(expected.transition);
					const probes = [transition - 1, transition, transition + 1];
					const labels = axis.values(plot, probes, 0, axis._found[1], axis._found[0]);
					checkLabels(plot, expected, probes, labels);
				}
			});
		}
	}

	it('shows the cursor, selects a range, zooms, and resets on double-click', async () => {
		const plot = await render('midnight-gaps', 'santiago');
		const bounds = [plot.scales.x.min, plot.scales.x.max];
		// Happy DOM has no layout engine; use the overlay's applied dimensions.
		const rect = new DOMRect(0, 0, parseFloat(plot.over.style.width), parseFloat(plot.over.style.height));
		plot.over.getBoundingClientRect = () => rect;
		plot.syncRect();
		const mouse = (type, fraction, target = plot.over) => {
			const event = new MouseEvent(type, {
				bubbles: true, button: 0,
				buttons: type === 'mouseup' || type === 'dblclick' ? 0 : 1,
				clientX: rect.width * fraction, clientY: rect.height / 2,
			});
			Object.defineProperty(event, 'movementX', { value: type === 'mousemove' ? rect.width / 2 : 0 });
			target.dispatchEvent(event);
		};

		mouse('mouseenter', .25);
		mouse('mousemove', .25);
		assert.equal(plot.cursor.left, rect.width * .25);
		assert.equal(plot.cursor.top, rect.height / 2);
		mouse('mousedown', .25);
		mouse('mousemove', .75);
		assert.ok(plot.select.width > 0, 'drag creates a visible selection');
		mouse('mouseup', .75, document);
		await Promise.resolve();
		const span = bounds[1] - bounds[0];
		assert.deepEqual([plot.scales.x.min, plot.scales.x.max], [bounds[0] + span * .25, bounds[0] + span * .75]);

		mouse('dblclick', .5);
		await Promise.resolve();
		assert.deepEqual([plot.scales.x.min, plot.scales.x.max], bounds);
		assert.deepEqual(plot.axes[0]._splits, expectedGroups['midnight-gaps'].santiago.ticks);
	});

	it('automatically changes Santiago from daily to two-day ticks at 400px and restores them at 600px', async () => {
		const expected = expectedGroups['midnight-gaps'].santiago;
		const plot = await render('midnight-gaps', 'santiago');
		const data = plot.data;
		const bounds = [plot.scales.x.min, plot.scales.x.max];
		checkAutoAxis(plot, 1);
		assert.deepEqual(plot.axes[0]._splits, expected.ticks);

		plot.setSize({ width: 400, height: plot.height });
		await Promise.resolve();
		assert.equal(plot.width, 400);
		checkAutoAxis(plot, 2);
		assert.deepEqual(plot.axes[0]._splits, [
			...midnights('2026-09', [3, 5], '-04:00'),
			...midnights('2026-09', [7, 9], '-03:00'),
		]);
		assert.equal(plot.data, data);
		assert.deepEqual([plot.scales.x.min, plot.scales.x.max], bounds);
		checkLabels(plot, expected);

		plot.setSize({ width: 600, height: plot.height });
		await Promise.resolve();
		checkAutoAxis(plot, 1);
		assert.deepEqual(plot.axes[0]._splits, expected.ticks);
		assert.equal(plot.data, data);
		assert.deepEqual([plot.scales.x.min, plot.scales.x.max], bounds);
		checkLabels(plot, expected);
	});
});
