import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Inputs are local 12:34:56.789; expected UTC instants are day/month/year starts.
const cases = [
	['Australia/Lord_Howe', [
		['2024-04-07T02:04:56.789Z', [
			'2024-04-06T13:00:00.000Z',
			'2024-03-31T13:00:00.000Z',
			'2023-12-31T13:00:00.000Z',
		]],
		['2024-10-06T01:34:56.789Z', [
			'2024-10-05T13:30:00.000Z',
			'2024-09-30T13:30:00.000Z',
			'2023-12-31T13:00:00.000Z',
		]],
	]],
	['Pacific/Norfolk', [
		['2015-10-06T01:34:56.789Z', [
			'2015-10-05T13:00:00.000Z',
			'2015-09-30T12:30:00.000Z',
			'2014-12-31T12:30:00.000Z',
		]],
	]],
	['Asia/Kathmandu', [
		// The first valid time of the day, month, and year is 00:15.
		['1986-01-01T06:49:56.789Z', [
			'1985-12-31T18:30:00.000Z',
			'1985-12-31T18:30:00.000Z',
			'1985-12-31T18:30:00.000Z',
		]],
	]],
	['America/Sao_Paulo', [
		// A whole-hour skipped-midnight control: the day starts at 01:00.
		['2018-11-04T14:34:56.789Z', [
			'2018-11-04T03:00:00.000Z',
			'2018-11-01T03:00:00.000Z',
			'2018-01-01T02:00:00.000Z',
		]],
	]],
];

async function checkPeriodFloors(groups) {
	const { default: assert } = await import('node:assert/strict');
	const { DateZoned, floorSOP, PERIOD_DAY, PERIOD_MONTH, PERIOD_YEAR } = await import('./src/fmtDate.js');
	const periods = [['day', PERIOD_DAY], ['month', PERIOD_MONTH], ['year', PERIOD_YEAR]];
	const fields = d => [d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()];

	for (const [zone, dates] of groups) {
		const zoned = zone != process.env.TZ;
		for (const [iso, expected] of dates) {
			const input = zoned ? new DateZoned(iso) : new Date(iso);
			if (zoned)
				input.setTimeZone(zone);
			const original = [input.getTime(), input.tz, ...fields(input)];
			assert.deepEqual(fields(input).slice(3), [12, 34, 56, 789], zone + ' input local time');

			periods.forEach(([name, period], i) => {
				const context = `${zone} ${zoned ? 'DateZoned' : 'Date'} ${iso} ${name}`;
				const result = floorSOP(input, period);
				assert.equal(result.getTime(), Date.parse(expected[i]), context);
				assert.equal(result.getMilliseconds(), 0, context + ' clears milliseconds');
				assert.equal(result instanceof DateZoned, zoned, context + ' result type');
				if (zoned)
					assert.equal(result.tz, zone, context + ' preserves zone');
				assert.deepEqual([input.getTime(), input.tz, ...fields(input)], original, context + ' does not mutate input');
			});
		}
	}
	console.log('period floor checks passed');
}

describe('floorSOP fractional offsets and skipped midnight', () => {
	// UTC forces remote DateZoned results; each other child tests native Date.
	for (const host of ['UTC', ...cases.map(([zone]) => zone)]) {
		const groups = host == 'UTC' ? cases : cases.filter(([zone]) => zone == host);
		const label = host == 'UTC' ? 'DateZoned with a UTC host' : `native Date in ${host}`;
		it(`floors day/month/year for ${label}`, { timeout: 6000 }, function() {
			const output = execFileSync(process.execPath, [
				'--input-type=module', '-e', `await (${checkPeriodFloors.toString()})(${JSON.stringify(groups)});`,
			], {
				cwd: fileURLToPath(new URL('../', import.meta.url)),
				env: { ...process.env, TZ: host, NODE_OPTIONS: '' },
				encoding: 'utf8',
				timeout: 5000,
			});
			assert.equal(output.trim(), 'period floor checks passed');
		});
	}
});
