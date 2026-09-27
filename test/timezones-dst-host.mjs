import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const zones = ['Europe/Paris', 'Europe/London', 'Asia/Tokyo', 'America/Chicago', 'UTC'];
const root = fileURLToPath(new URL('../', import.meta.url));

function capture(zone) {
	const output = execFileSync(process.execPath, ['test/fixtures/timezones-dst.mjs'], {
		cwd: root,
		env: { ...process.env, TZ: zone, NODE_OPTIONS: '' },
		encoding: 'utf8',
		maxBuffer: 8 * 1024 * 1024,
		timeout: 15000,
	});
	const result = JSON.parse(output);
	assert.equal(result.hostZone, zone);
	assert.equal(result.charts.length, 51);
	return result.charts;
}

describe('timezone/DST demo host independence', () => {
	let reference;
	before(function() {
		this.timeout(20000);
		reference = capture(zones[0]);
	});

	for (const zone of zones) {
		it(`preserves all 51 pinned charts under ${zone}`, function() {
			this.timeout(20000);
			const actual = zone == zones[0] ? reference : capture(zone);
			actual.forEach((chart, i) => {
				assert.deepEqual(chart, reference[i], zone + ' chart ' + chart.id + ': ticks, labels, scales, and legend');
			});
		});
	}
});
