import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const zones = ['Europe/Paris', 'Europe/London', 'Asia/Tokyo', 'America/Chicago', 'UTC'];
const root = fileURLToPath(new URL('../', import.meta.url));

const exec = promisify(execFile);

async function capture(zone, signal) {
	let closed;
	try {
		const pending = exec(process.execPath, ['test/fixtures/timezones-dst.mjs'], {
			cwd: root,
			env: { ...process.env, TZ: zone, NODE_OPTIONS: '' },
			encoding: 'utf8',
			maxBuffer: 8 * 1024 * 1024,
			timeout: 15000,
			signal,
		});
		// Aborting execFile rejects before exit; cleanup must also wait for close.
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
		const controller = new AbortController();
		// At most five children, one per host TZ, not one per chart.
		const captures = zones.map(zone => capture(zone, controller.signal));

		try {
			const results = await Promise.all(captures);
			for (let z = 0; z < zones.length; z++) {
				results[z].forEach((chart, i) => {
					assert.deepEqual(chart, results[0][i], zones[z] + ' chart ' + chart.id + ': ticks, labels, scales, and legend');
				});
			}
		}
		finally {
			controller.abort();
			await Promise.allSettled(captures);
		}
	});
});
