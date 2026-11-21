import assert from 'node:assert/strict';
import { DateZoned } from '../../src/fmtDate.js';
import { timeAxisSplitsMs, timeAxisSplitsS } from '../../src/opts.js';

export const day = 864e5;
export const flags = [
	{ dst: false, first: false },
	{ dst: false, first: true },
	{ dst: true, first: false },
	{ dst: true, first: true },
];

// Explicit offsets distinguish a day's first midnight from a repeated midnight.
export const cases = [
	{
		name: 'Santiago: issue #1159, midnight skipped in September', zone: 'America/Santiago',
		min: '2026-08-30T12:00:00Z', max: '2026-09-13T11:00:00Z',
		ticks: [
			'2026-08-31T00:00:00-04:00', '2026-09-01T00:00:00-04:00',
			'2026-09-02T00:00:00-04:00', '2026-09-03T00:00:00-04:00',
			'2026-09-04T00:00:00-04:00', '2026-09-05T00:00:00-04:00',
			'2026-09-06T01:00:00-03:00', '2026-09-07T00:00:00-03:00',
			'2026-09-08T00:00:00-03:00', '2026-09-09T00:00:00-03:00',
			'2026-09-10T00:00:00-03:00', '2026-09-11T00:00:00-03:00',
			'2026-09-12T00:00:00-03:00', '2026-09-13T00:00:00-03:00',
		],
	},
	{
		name: 'Sao Paulo: midnight skipped in November', zone: 'America/Sao_Paulo',
		ticks: [
			'2018-11-02T00:00:00-03:00', '2018-11-03T00:00:00-03:00',
			'2018-11-04T01:00:00-02:00', '2018-11-05T00:00:00-02:00', '2018-11-06T00:00:00-02:00',
		],
	},
	{
		name: 'Lord Howe: half-hour rollback', zone: 'Australia/Lord_Howe',
		ticks: [
			'2024-04-06T00:00:00+11:00', '2024-04-07T00:00:00+11:00',
			'2024-04-08T00:00:00+10:30', '2024-04-09T00:00:00+10:30',
		],
	},
	{
		name: 'Lord Howe: half-hour forward change', zone: 'Australia/Lord_Howe',
		ticks: [
			'2024-10-05T00:00:00+10:30', '2024-10-06T00:00:00+10:30',
			'2024-10-07T00:00:00+11:00', '2024-10-08T00:00:00+11:00',
		],
	},
	{
		name: 'Lord Howe: two-day ticks across a half-hour rollback', zone: 'Australia/Lord_Howe', days: 2,
		ticks: ['2024-04-05T00:00:00+11:00', '2024-04-07T00:00:00+11:00', '2024-04-09T00:00:00+10:30'],
	},
	{
		name: 'Troll: two-hour forward change', zone: 'Antarctica/Troll',
		ticks: [
			'2024-03-30T00:00:00Z', '2024-03-31T00:00:00Z',
			'2024-04-01T00:00:00+02:00', '2024-04-02T00:00:00+02:00',
		],
	},
	{
		name: 'Troll: two-hour rollback', zone: 'Antarctica/Troll',
		ticks: [
			'2024-10-26T00:00:00+02:00', '2024-10-27T00:00:00+02:00',
			'2024-10-28T00:00:00Z', '2024-10-29T00:00:00Z',
		],
	},
	{
		name: 'Kathmandu: fifteen-minute midnight gap', zone: 'Asia/Kathmandu',
		ticks: [
			'1985-12-30T00:00:00+05:30', '1985-12-31T00:00:00+05:30',
			'1986-01-01T00:15:00+05:45', '1986-01-02T00:00:00+05:45', '1986-01-03T00:00:00+05:45',
		],
	},
	{
		name: 'Norfolk: seven-day month reset across a half-hour offset change', zone: 'Pacific/Norfolk', days: 7, first: true,
		min: '2015-09-29T00:00:00+11:30', max: '2015-10-02T12:00:00+11:30',
		ticks: ['2015-10-01T00:00:00+11:30'],
	},
	{
		name: 'Kanton: twelve-hour rollback advances at the noon tie', zone: 'Pacific/Kanton',
		ticks: [
			'1937-08-28T00:00:00Z', '1937-08-29T00:00:00Z', '1937-08-30T00:00:00Z',
			'1937-08-31T00:00:00-12:00', '1937-09-01T00:00:00-12:00',
			'1937-09-02T00:00:00-12:00', '1937-09-03T00:00:00-12:00',
		],
	},
	{
		name: 'Apia: omit the skipped calendar day', zone: 'Pacific/Apia',
		ticks: ['2011-12-29T00:00:00-10:00', '2011-12-31T00:00:00+14:00', '2012-01-01T00:00:00+14:00'],
	},
	{
		name: 'Newfoundland: rollback into the previous date', zone: 'America/St_Johns',
		ticks: ['2010-11-06T00:00:00-02:30', '2010-11-07T00:00:00-02:30', '2010-11-08T00:00:00-03:30'],
	},
	{
		name: 'Kwajalein: stop a rewinding month reset without discarding the last tick', zone: 'Pacific/Kwajalein', days: 2, first: true,
		min: '1993-08-15T00:00:00-12:00', max: '1993-08-29T00:00:00+12:00',
		prefix: ['1993-08-15T00:00:00-12:00', '1993-08-17T00:00:00-12:00', '1993-08-19T00:00:00-12:00'],
		limitation: 'Resuming multi-day cadence after a date-line shift is outside the bounded correction.',
		ideal: [
			'1993-08-15T00:00:00-12:00', '1993-08-17T00:00:00-12:00', '1993-08-19T00:00:00-12:00',
			'1993-08-23T00:00:00+12:00', '1993-08-25T00:00:00+12:00',
			'1993-08-27T00:00:00+12:00', '1993-08-29T00:00:00+12:00',
		],
	},
	{
		name: 'Kwajalein: stop even when no tick has entered the visible range', zone: 'Pacific/Kwajalein', days: 2, first: true,
		min: '1993-08-22T00:00:00+12:00', max: '1993-08-29T00:00:00+12:00', prefix: [],
				limitation: 'A date-line shift can stop the generator before any visible tick.',
				ideal: ['1993-08-23T00:00:00+12:00', '1993-08-25T00:00:00+12:00', '1993-08-27T00:00:00+12:00', '1993-08-29T00:00:00+12:00'],
	},
	{
		name: 'Havana: range starts at the second midnight', zone: 'America/Havana',
		min: '2020-11-01T00:00:00-05:00', max: '2020-11-03T00:00:00-05:00',
		limitation: 'The month baseline does not disambiguate repeated midnight.',
		ideal: ['2020-11-02T00:00:00-05:00', '2020-11-03T00:00:00-05:00'],
	},
	...[2, 7].map(days => ({
		name: `Havana: ${days}-day month reset onto repeated midnight`, zone: 'America/Havana', days, first: true,
		min: days == 2 ? '2020-10-31T00:00:00-04:00' : '2020-10-29T00:00:00-04:00', max: '2020-11-02T12:00:00-05:00',
		limitation: 'The month reset does not disambiguate repeated midnight.',
		ideal: ['2020-11-01T00:00:00-04:00'],
	})),
	{
		name: 'forward gap straddling midnight', transition: '2024-01-01T23:30:00Z',
		min: '2024-01-01T00:00:00Z', max: '2024-01-03T00:00:00Z',
		limitation: 'The correction preserves 01:00 rather than searching for the day start at 00:30.',
		ideal: ['2024-01-01T00:00:00Z', '2024-01-01T23:30:00Z', '2024-01-02T23:00:00Z'],
	},
];

export const niceFlags = example => flags.filter(nice => example.first === undefined || nice.first == example.first);
export const range = example => [example.min ?? example.ticks[0], example.max ?? example.ticks.at(-1)].map(Date.parse);

export function splits(example, ms, nice, native = false) {
	const [min, max] = range(example).map(t => t * ms);
	let calls = 0;
	const toDate = ts => {
		// A test timeout cannot interrupt a synchronous infinite loop.
		assert.ok(++calls <= 128, example.name + ': tick generator did not terminate');
		if (native)
			return new Date(ts / ms);
		// The synthetic gap starts after the UTC month baseline used by this fixture.
		const shift = example.transition && ts / ms >= Date.parse(example.transition) ? 3600e3 : 0;
		const date = new DateZoned(ts / ms + shift);
		date.setTimeZone(example.zone ?? 'UTC');
		return date;
	};
	return (ms == 1 ? timeAxisSplitsMs : timeAxisSplitsS)(toDate)({ axes: [{ nice }] }, 0, min, max, (example.days ?? 1) * day * ms, 50);
}

export function checkSplits(example, ms, nice, native = false) {
	const ticks = splits(example, ms, nice, native);
	const [min, max] = range(example).map(t => t * ms);
	const context = `${example.name}, ms=${ms}, native=${native}, nice=${JSON.stringify(nice)}`;
	assert.ok(ticks.every((t, i) => Number.isFinite(t) && t >= min && t <= max && (i == 0 || t > ticks[i - 1])), context);
	if (example.ticks)
		assert.deepEqual(ticks, example.ticks.map(iso => Date.parse(iso) * ms), context);
	else if (example.prefix)
		// Preserve valid ticks without requiring future fixes to keep truncating the range.
		assert.deepEqual(ticks.slice(0, example.prefix.length), example.prefix.map(iso => Date.parse(iso) * ms), context);
	else
		assert.ok(ticks.length > 0, context);
	return ticks;
}

export function checkNative(zone) {
	for (const example of cases.filter(example => example.zone == zone)) {
		for (const ms of [1, 1e-3]) {
			for (const nice of niceFlags(example))
				checkSplits(example, ms, nice, true);
		}
	}
}
