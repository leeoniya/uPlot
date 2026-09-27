import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

async function checkLocalTime(dates) {
	const { default: assert } = await import('node:assert/strict');
	const { DateZoned, tzDate, floorSOP, fmtDate, PERIOD_DAY, PERIOD_MONTH, PERIOD_YEAR } = await import('./src/fmtDate.js');
	const { timeAxisSplitsMs, timeAxisSplitsS } = await import('./src/opts.js');
	const local = new Intl.DateTimeFormat().resolvedOptions().timeZone;
	const periods = [PERIOD_DAY, PERIOD_MONTH, PERIOD_YEAR];
	const stamp = fmtDate('{YYYY}-{MM}-{DD} {HH}:{mm}:{ss}.{fff}');
	const setTimeZone = DateZoned.prototype.setTimeZone;

	// Prepare explicit-local DateZoned inputs before forbidding further conversions.
	const inputs = dates.flatMap(([month, day]) => {
		const native = new Date(2024, month - 1, day, 12, 34, 56, 789);
		const zoned = new DateZoned(native);
		zoned.setTimeZone(local);
		return [native, zoned];
	});
	DateZoned.prototype.setTimeZone = () => assert.fail('local period flooring must not convert through DateZoned');
	try {
		for (const input of inputs) {
			const original = input.getTime();
			for (const period of periods) {
				const expected = new Date(original);
				expected.setHours(0, 0, 0, 0);
				if (period == PERIOD_MONTH)
					expected.setDate(1);
				else if (period == PERIOD_YEAR)
					expected.setMonth(0, 1);

				const result = floorSOP(input, period);
				assert.equal(Object.getPrototypeOf(result), Date.prototype);
				assert.equal(result.getTime(), expected.getTime());
				assert.equal(stamp(result), stamp(expected));
				assert.equal(result.getTimezoneOffset(), expected.getTimezoneOffset());
				assert.equal(input.getTime(), original, 'flooring does not mutate its input');
			}
		}

		for (const ms of [1, 1e-3]) {
			for (const date of [ts => new Date(ts / ms), ts => tzDate(ts / ms, local)]) {
				const splits = (ms == 1 ? timeAxisSplitsMs : timeAxisSplitsS)(date);
				const plot = { axes: [{ nice: { dst: true, first: false } }] };
				for (const [month, day] of dates) {
					const start = new Date(2024, month - 1, day).getTime();
					const end = new Date(2024, month - 1, day + 1).getTime();
					for (const hours of [1, 6, 24]) {
						const expected = hours == 1
							? Array.from({ length: (end - start) / 3600e3 + 1 }, (_, i) => (start + i * 3600e3) * ms)
							: Array.from({ length: 24 / hours + 1 }, (_, i) => new Date(2024, month - 1, day, i * hours).getTime() * ms);
						const ticks = splits(plot, 0, start * ms, end * ms, hours * 3600e3 * ms, 50);
						assert.deepEqual(ticks, expected);
						assert.deepEqual(ticks.map(ts => stamp(date(ts))), expected.map(ts => stamp(new Date(ts / ms))));
					}
				}

				// Match sine-stream's 600-point, five-minute spacing without DOM or canvas work.
				const start = new Date(2024, 2, 9, 12).getTime();
				for (let frame = 0; frame < 120; frame++) {
					const min = (start + frame * 300e3) * ms;
					const max = min + 599 * 300e3 * ms;
					const ticks = splits(plot, 0, min, max, 12 * 3600e3 * ms, 300);
					assert.ok(ticks.length > 0);
					assert.ok(ticks.every(ts => ts >= min && ts <= max));
					assert.ok(ticks.every(ts => date(ts).getHours() % 12 == 0));
				}
			}
		}
	}
	finally {
		DateZoned.prototype.setTimeZone = setTimeZone;
	}

	for (const [zone, expected] of [
		['UTC', ['2024-07-15T00:00:00Z', '2024-07-01T00:00:00Z', '2024-01-01T00:00:00Z']],
		['Asia/Tokyo', ['2024-07-14T15:00:00Z', '2024-06-30T15:00:00Z', '2023-12-31T15:00:00Z']],
		['America/Chicago', ['2024-07-15T05:00:00Z', '2024-07-01T05:00:00Z', '2024-01-01T06:00:00Z']],
	]) {
		const input = tzDate(Date.parse('2024-07-15T12:34:56.789Z'), zone);
		periods.forEach((period, i) => {
			const result = floorSOP(input, period);
			assert.equal(result.getTime(), Date.parse(expected[i]), zone);
			assert.equal(result instanceof DateZoned, zone != local);
			if (zone != local)
				assert.equal(result.tz, zone);
			assert.equal(result.getHours(), 0);
		});
	}
	console.log('local time checks passed');
}

describe('local time period flooring', () => {
	for (const [zone, dates] of [
		['UTC', [[1, 15], [7, 15]]],
		['America/New_York', [[3, 10], [11, 3]]],
		['Europe/London', [[3, 31], [10, 27]]],
		['Asia/Kathmandu', [[1, 15], [7, 15]]],
		['Australia/Lord_Howe', [[1, 15], [2, 15]]],
	]) {
		it(`uses native dates in ${zone} and preserves remote-zone conversion`, function() {
			this.timeout(6000);
			// Each process resolves localTz independently, without changing other tests' timezone.
			const output = execFileSync(process.execPath, [
				'--input-type=module', '-e', `await (${checkLocalTime.toString()})(${JSON.stringify(dates)});`,
			], {
				cwd: fileURLToPath(new URL('../', import.meta.url)),
				env: { ...process.env, TZ: zone, NODE_OPTIONS: '' },
				encoding: 'utf8',
				timeout: 5000,
			});
			assert.equal(output.trim(), 'local time checks passed');
		});
	}
});
