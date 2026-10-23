import { readFileSync, readdirSync } from 'node:fs';
import { parseProcStat, discoverProcessTree } from './bench-process-memory.mjs';

const gone = error => error.code === 'ENOENT' || error.code === 'ESRCH';

// Call only for a benchmark-owned ChildProcess, on failure/cleanup, never during measurement.
// No CDP, process-group signals, or waits: SIGKILL delivery does not wait for exit/reaping.
// Linux discovery is a non-atomic PPID snapshot. Already-reparented children and new forks
// can escape it. Start-time checks reduce PID reuse races, but cannot make read+kill atomic
// or establish ownership before the first read. Other platforms kill only the root.
export function killBenchmarkBrowser(browser, {
	platform = process.platform, readFile = readFileSync, readdir = readdirSync,
	kill = process.kill.bind(process),
} = {}) {
	if (!browser || browser.exitCode !== null || browser.signalCode !== null)
		return;
	const rootPid = browser.pid;
	if (!Number.isSafeInteger(rootPid) || rootPid <= 0)
		throw new TypeError('browser.pid must be a positive safe integer');

	const errors = [];
	const signal = pid => {
		try {
			kill(pid, 'SIGKILL');
		}
		catch (error) {
			if (error.code !== 'ESRCH')
				errors.push(error);
		}
	};
	const readStat = pid => {
		const stat = parseProcStat(readFile(`/proc/${pid}/stat`, 'utf8'));
		if (stat.pid !== pid)
			throw new Error(`Expected /proc stat for PID ${pid}, read PID ${stat.pid}`);
		return stat;
	};

	if (platform !== 'linux')
		signal(rootPid);
	else {
		let root;
		try {
			root = readStat(rootPid);
		}
		catch (error) {
			if (gone(error))
				return;
			errors.push(error);
			// If proc is unavailable, still attempt root cleanup, but report incomplete discovery.
			signal(rootPid);
		}
		if (root) {
			const stats = [root];
			try {
				for (const name of readdir('/proc')) {
					if (!/^[1-9]\d*$/.test(name))
						continue;
					const pid = Number(name);
					if (!Number.isSafeInteger(pid) || pid === rootPid)
						continue;
					try {
						stats.push(readStat(pid));
					}
					catch (error) {
						if (!gone(error))
							errors.push(error);
					}
				}
			}
			catch (error) {
				errors.push(error);
			}
			for (const expected of discoverProcessTree(stats, rootPid).reverse()) {
				try {
					// Keep targeting an observed child if it was reparented after the snapshot.
					if (readStat(expected.pid).startTime === expected.startTime)
						signal(expected.pid);
				}
				catch (error) {
					if (!gone(error))
						errors.push(error);
				}
			}
		}
	}
	// Try every known target before surfacing failures, including permission errors.
	if (errors.length)
		throw new AggregateError(errors, 'Benchmark browser cleanup failed');
}
