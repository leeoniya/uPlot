import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

async function checkLazyTime(firstRemote) {
	const { default: assert } = await import('node:assert/strict');
	const NativeDateTimeFormat = Intl.DateTimeFormat;
	const calls = [];
	let allowIntl = false;
	Intl.DateTimeFormat = new Proxy(NativeDateTimeFormat, {
		construct(target, args) {
			assert.ok(allowIntl, 'import and implicit local time must not construct Intl.DateTimeFormat');
			calls.push(args);
			return Reflect.construct(target, args);
		},
	});

	const { tzDate, DateZoned, fmtDate } = await import('./src/fmtDate.js');
	const { default: uPlot } = await import('./src/uPlot.js');
	const date = new Date('2024-07-15T12:34:56.789Z');
	const ts = date.getTime();
	for (const tz of [undefined, null]) {
		assert.equal(tzDate(date, tz), date);
		const result = tzDate(ts, tz);
		assert.equal(Object.getPrototypeOf(result), Date.prototype);
		assert.equal(result.getTime(), ts);
		assert.equal(result.getHours(), date.getHours());
	}
	assert.equal(uPlot.tzDate(date), date);
	assert.equal(uPlot.fmtNum(1234.5), '1,234.5');
	assert.equal(fmtDate('{YYYY}')(tzDate(ts)), '2024');
	const invalid = new Date(NaN);
	assert.equal(tzDate(invalid), invalid);
	assert.ok(Number.isNaN(tzDate(NaN).getTime()));
	assert.equal(calls.length, 0);

	// Resolve the expected name through the original constructor, outside the spy.
	const local = new NativeDateTimeFormat().resolvedOptions().timeZone;
	allowIntl = true;
	if (firstRemote) {
		assert.ok(tzDate(ts, 'Asia/Tokyo') instanceof DateZoned);
		assert.equal(calls.length, 2);
	}

	const setTimeZone = DateZoned.prototype.setTimeZone;
	DateZoned.prototype.setTimeZone = () => assert.fail('an explicit local timezone must bypass DateZoned');
	try {
		for (const input of [date, new Date('2024-01-15T12:34:56.789Z')]) {
			assert.equal(tzDate(input, local), input, 'preserve an existing Date object');
			const result = tzDate(input.getTime(), local);
			assert.equal(Object.getPrototypeOf(result), Date.prototype);
			assert.equal(result.getTime(), input.getTime());
			assert.equal(result.getHours(), input.getHours());
			assert.equal(result.getTimezoneOffset(), input.getTimezoneOffset());
		}
		assert.equal(calls.length, firstRemote ? 2 : 1);
		assert.deepEqual(calls[0], [], 'resolve the local timezone only once');
		assert.equal(tzDate(date), date);
		assert.equal(calls.length, firstRemote ? 2 : 1);
	}
	finally { DateZoned.prototype.setTimeZone = setTimeZone; }

	for (let i = 0; i < 2; i++) {
		const result = tzDate(ts, 'Asia/Tokyo');
		assert.ok(result instanceof DateZoned);
		assert.equal(result.tz, 'Asia/Tokyo');
		assert.equal(result.getTime(), ts);
		assert.equal(result.getHours(), 21);
		assert.equal(result.getMinutes(), 34);
		assert.equal(result.getTimezoneOffset(), 540, 'preserve the existing DateZoned offset sign');
	}
	assert.equal(calls.length, 2, 'reuse the remote timezone formatter');
	assert.equal(calls[1][1].timeZone, 'Asia/Tokyo');

	for (const tz of ['UTC', 'Etc/UTC']) {
		const result = tzDate(date, tz);
		assert.equal(result.getTime(), ts);
		assert.equal(result.getHours(), date.getUTCHours());
		assert.equal(result.getTimezoneOffset(), 0);
		assert.equal(result instanceof DateZoned, tz !== local);
		if (tz === local) assert.equal(result, date);
	}
	assert.equal(calls.length, 2, 'UTC conversion needs no per-zone Intl formatter');

	assert.throws(() => tzDate(ts, 'Not/A_Zone'), RangeError);
	assert.equal(calls.length, 3);
	assert.equal(tzDate(date, local), date);
	tzDate(ts, 'Asia/Tokyo');
	assert.equal(calls.length, 3, 'invalid input does not invalidate the caches');
	console.log('lazy timezone checks passed');
}

describe('lazy timezone detection', () => {
	for (const zone of ['UTC', 'America/New_York', 'Asia/Kathmandu']) {
		for (const firstRemote of [false, true]) {
			it(`defers Intl and preserves the local fast path in ${zone}, remote first: ${firstRemote}`, { timeout: 6000 }, function() {
				const output = execFileSync(process.execPath, [
					'--input-type=module', '-e', `await (${checkLazyTime.toString()})(${firstRemote});`,
				], {
					cwd: fileURLToPath(new URL('../', import.meta.url)),
					env: { ...process.env, TZ: zone, NODE_OPTIONS: '' },
					encoding: 'utf8',
					timeout: 5000,
				});
				assert.equal(output.trim(), 'lazy timezone checks passed');
			});
		}
	}
});
