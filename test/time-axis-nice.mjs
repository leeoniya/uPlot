import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import { timeAxisSplitsMs, timeAxisSplitsS } from '../src/opts.js';
import { DateZoned, fmtDate } from '../src/fmtDate.js';
import uPlot from '../src/uPlot.js';

const hour = 3600e3;
const day = 24 * hour;
const flags = [
	{ dst: false, first: false },
	{ dst: false, first: true },
	{ dst: true, first: false },
	{ dst: true, first: true },
];
const monthCases = [
	{
		days: 2, min: '2024-01-27', max: '2024-02-05',
		regular: ['Jan27', 'Jan29', 'Jan31', 'Feb2', 'Feb4'],
		first: ['Jan27', 'Jan29', 'Feb1', 'Feb3', 'Feb5'],
	},
	{
		days: 3, min: '2024-01-25', max: '2024-02-07',
		regular: ['Jan25', 'Jan28', 'Jan31', 'Feb3', 'Feb6'],
		first: ['Jan25', 'Jan28', 'Feb1', 'Feb4', 'Feb7'],
	},
];
const transitions = [
	{ name: 'spring', min: '2024-03-10T00:00:00-06:00', max: '2024-03-11T00:00:00-05:00', hours: 23, gap: 5 },
	{ name: 'fall', min: '2024-11-03T00:00:00-05:00', max: '2024-11-04T00:00:00-06:00', hours: 25, gap: 7 },
];
const monthDay = fmtDate('{MMM}{D}');
const clock = fmtDate('{HH}:{mm}:{ss}');
const calendarDate = fmtDate('{YYYY}-{MM}-{DD}');
const differences = values => values.slice(1).map((value, i) => value - values[i]);

for (const ms of [1, 1e-3]) {
	describe(`time axis nice (ms=${ms})`, () => {
		const timestamp = iso => Date.parse(iso) * ms;
		const zoned = zone => ts => {
			const date = new DateZoned(ts / ms);
			date.setTimeZone(zone);
			return date;
		};
		const utc = zoned('UTC');
		const chicago = zoned('America/Chicago');
		const generator = ms == 1 ? timeAxisSplitsMs : timeAxisSplitsS;
		const splits = (tzDate, min, max, incr, nice) => generator(tzDate)({
			// Opposite flags on axis 0 catch accidental use of the wrong axis.
			axes: [{ nice: { dst: !nice.dst, first: !nice.first } }, { nice }],
		}, 1, min, max, incr * ms, 50);

		for (const override of [undefined, {}, { dst: false }, { first: true }, { dst: false, first: true }]) {
			it(`merges defaults through chart init: ${JSON.stringify(override) ?? 'omitted'}`, async () => {
				const min = timestamp(monthCases[0].min);
				const max = timestamp(monthCases[0].max);
				const expected = { dst: true, first: false, ...override };
				const u = new uPlot({
					width: 800,
					height: 400,
					ms,
					pxRatio: 1,
					tzDate: utc,
					cursor: { show: false },
					legend: { show: false },
					series: [{}, { points: { show: false } }],
					scales: {
						x: { time: true, min, max, range: () => [min, max] },
						y: { time: true, min, max, range: () => [min, max] },
					},
					axes: [0, 1].map(() => ({
						...(override === undefined ? {} : { nice: { ...override } }),
						incrs: [2 * day * ms],
						// Use explicit labels so automatic time-label filtering is not under test.
						values: '{MMM}{D}',
					})),
				}, [[min, max], [min, max]], (self, init) => {
					self.ctx.measureText = text => ({ width: String(text).length * 7 });
					document.body.appendChild(self.root);
					init();
				});
				try {
					await Promise.resolve();
					assert.equal(u.status, 1);
					for (const [i, axis] of u.axes.entries()) {
						assert.deepEqual(axis.nice, expected, `axis ${i} defaults`);
						assert.deepEqual(axis._splits.map(ts => monthDay(utc(ts))),
							expected.first ? monthCases[0].first : monthCases[0].regular, `axis ${i} splits`);
					}
				}
				finally {
					u.destroy();
				}
			});
		}

		for (const example of monthCases) {
			for (const nice of flags) {
				it(`${example.days}-day month rollover: ${JSON.stringify(nice)}`, () => {
					const ticks = splits(utc, timestamp(example.min), timestamp(example.max), example.days * day, nice);
					assert.deepEqual(ticks.map(ts => monthDay(utc(ts))), nice.first ? example.first : example.regular);
					assert.ok(ticks.every(ts => clock(utc(ts)) == '00:00:00'));
				});
			}
		}

		for (const transition of transitions) {
			const min = timestamp(transition.min);
			const max = timestamp(transition.max);

			for (const nice of flags) {
				it(`Chicago ${transition.name}, six-hour ticks: ${JSON.stringify(nice)}`, () => {
					const ticks = splits(chicago, min, max, 6 * hour, nice);
					const elapsed = nice.dst
						? [0, transition.gap, transition.gap + 6, transition.gap + 12, transition.gap + 18]
						: Array.from({ length: Math.floor(transition.hours / 6) + 1 }, (_, i) => i * 6);
					assert.deepEqual(ticks, elapsed.map(hours => min + hours * hour * ms));
					assert.deepEqual(differences(ticks), (nice.dst ? [transition.gap, 6, 6, 6] : elapsed.slice(1).map(() => 6)).map(hours => hours * hour * ms));
					if (nice.dst)
						assert.deepEqual(ticks.map(ts => chicago(ts).getHours()), [0, 6, 12, 18, 0]);
					else
						assert.ok(ticks.slice(1).every(ts => chicago(ts).getHours() % 6 != 0));
				});

				it(`Chicago ${transition.name}, daily midnight stays corrected: ${JSON.stringify(nice)}`, () => {
					const ticks = splits(chicago, min - day * ms, max + day * ms, day, nice);
					assert.deepEqual(ticks, [min - day * ms, min, max, max + day * ms]);
					assert.deepEqual(differences(ticks), [24, transition.hours, 24].map(hours => hours * hour * ms));
					assert.deepEqual(ticks.map(ts => clock(chicago(ts))), Array(4).fill('00:00:00'));
				});

				it(`Chicago ${transition.name}, hourly ticks are unaffected: ${JSON.stringify(nice)}`, () => {
					assert.deepEqual(splits(chicago, min, max, hour, nice),
						Array.from({ length: transition.hours + 1 }, (_, i) => min + i * hour * ms));
				});
			}
		}

		for (const example of [
			{ name: 'month', min: '2023-12-15', max: '2024-04-01', incr: 30 * day, dates: ['2024-01-01', '2024-02-01', '2024-03-01', '2024-04-01'] },
			{ name: 'year', min: '2023-07-01', max: '2026-01-01', incr: 365 * day, dates: ['2024-01-01', '2025-01-01', '2026-01-01'] },
		]) {
			it(`${example.name} ticks are unaffected by either option`, () => {
				for (const nice of flags) {
					const ticks = splits(utc, timestamp(example.min), timestamp(example.max), example.incr, nice);
					assert.deepEqual(ticks, example.dates.map(timestamp), JSON.stringify(nice));
					assert.deepEqual(ticks.map(ts => calendarDate(utc(ts))), example.dates);
				}
			});
		}
	});
}
