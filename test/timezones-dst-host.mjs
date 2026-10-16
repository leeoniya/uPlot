import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const zones = ['Europe/Paris', 'Europe/London', 'Asia/Tokyo', 'America/Chicago', 'UTC'];
const root = fileURLToPath(new URL('../', import.meta.url));

const exec = promisify(execFile);

async function capture(zone) {
	let closed;
	try {
		const pending = exec(process.execPath, ['test/fixtures/timezones-dst.mjs'], {
			cwd: root,
			env: { ...process.env, TZ: zone, NODE_OPTIONS: '' },
			encoding: 'utf8',
			maxBuffer: 8 * 1024 * 1024,
			timeout: 15000,
		});
		// Wait for the child to close before starting another timezone.
		closed = new Promise(resolve => pending.child.once('close', resolve));
		const { stdout } = await pending;
		const result = JSON.parse(stdout);
		assert.equal(result.hostZone, zone);
		assert.equal(result.charts.length, 51);
		return result.charts;
	}
	catch (error) {
		error.message = zone + ': ' + error.message;
		throw error;
	}
	finally {
		await closed;
	}
}

describe('timezone/DST demo host independence', () => {
	it('preserves all 51 pinned charts under ' + zones.join(', '), async function() {
		this.timeout(20000);
		let expected;
		// Each child renders all 51 charts. Run one at a time to limit peak memory.
		for (const zone of zones) {
			const charts = await capture(zone);
			if (expected == null)
				expected = charts;
			else {
				charts.forEach((chart, i) => {
					assert.deepEqual(chart, expected[i], zone + ' chart ' + chart.id + ': ticks, labels, scales, and legend');
				});
			}
		}
	});
});
