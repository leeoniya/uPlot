import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tzDate, fmtDate } from '../src/fmtDate.js';

// Local mean time offsets have seconds, e.g. GMT+00:53:28 in Europe/Berlin before 1893.
const cases = [
	['Europe/Berlin',    '1850-06-01T00:00:00.000Z'],
	['America/New_York', '1880-03-15T12:00:00.000Z'],
	['Asia/Kolkata',     '1900-01-01T00:00:00.000Z'],
	['Asia/Kathmandu',   '1910-07-04T08:30:15.250Z'],
	['Europe/Berlin',    '2024-07-01T10:20:30.400Z'],
];

const stamp = fmtDate('{YYYY}-{MM}-{DD} {HH}:{mm}:{ss}.{fff} {WWW}');

describe('tzDate', () => {
	for (const [tz, iso] of cases) {
		it(`reads local fields in ${tz} at ${iso}`, () => {
			const date = new Date(iso);
			const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
				timeZone: tz, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit',
				day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3,
			}).formatToParts(date).map(p => [p.type, p.value]));
			const expected = `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}.${parts.fractionalSecond} ${parts.weekday}`;
			assert.equal(stamp(tzDate(date.getTime(), tz)), expected);
		});
	}
});
