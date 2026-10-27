import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { killBenchmarkBrowser } from '../../scripts/bench-browser-process.mjs';
import { parseProcStat } from '../../scripts/bench-process-memory.mjs';

const browser = () => ({pid: 10, exitCode: null, signalCode: null});
const failure = code => Object.assign(new Error(code), {code});
const stat = (pid, ppid, startTime = String(pid * 100)) =>
	`${pid} (chrome ) worker) S ${ppid} ${Array(17).fill('0').join(' ')} ${startTime} 0 0\n`;

function fixture() {
	// Deliberately unordered: root, child, grandchild, sibling, and an unrelated tree.
	const files = new Map([
		[30, stat(30, 20)], [91, stat(91, 90)], [20, stat(20, 10)],
		[10, stat(10, 1)], [40, stat(40, 10)], [90, stat(90, 1)],
	]);
	const calls = [];
	const reads = new Map();
	const options = {
		platform: 'linux',
		readdir(path) {
			assert.equal(path, '/proc');
			return [...files.keys()].map(String).concat('self', 'thread-self', 'meminfo');
		},
		readFile(path, encoding) {
			assert.equal(encoding, 'utf8');
			const pid = Number(/^\/proc\/(\d+)\/stat$/.exec(path)?.[1]);
			assert.ok(pid > 0);
			reads.set(pid, (reads.get(pid) ?? 0) + 1);
			const value = files.get(pid);
			if (value instanceof Error)
				throw value;
			if (value === undefined)
				throw failure('ENOENT');
			return value;
		},
		kill(pid, signal) { calls.push([pid, signal]); },
	};
	return {files, calls, reads, options, run: () => killBenchmarkBrowser(browser(), options)};
}

function assertErrors(run, codes) {
	assert.throws(run, error => {
		assert.ok(error instanceof AggregateError);
		assert.deepEqual(error.errors.map(error => error.code), codes);
		return true;
	});
}

describe('benchmark browser process cleanup', () => {
	it('synchronously kills descendants deepest-first, then root, never unrelated PIDs or groups', () => {
		const f = fixture();
		assert.equal(f.run(), undefined);
		assert.deepEqual(f.calls, [30, 40, 20, 10].map(pid => [pid, 'SIGKILL']));
		assert.equal(f.reads.get(10), 2);
	});

	it('does nothing for absent browsers or observed exits, without even scanning proc', () => {
		const unexpected = () => assert.fail('cleanup must not run');
		const options = {readFile: unexpected, readdir: unexpected, kill: unexpected};
		for (const child of [null, undefined, {...browser(), exitCode: 0}, {...browser(), signalCode: 'SIGKILL'}])
			assert.equal(killBenchmarkBrowser(child, options), undefined);
	});

	it('rejects invalid active PIDs before any scan or signal', () => {
		const unexpected = () => assert.fail('cleanup must not run');
		for (const pid of [undefined, null, 0, -1, -10, 1.5, NaN, Infinity, '10', Number.MAX_SAFE_INTEGER + 1])
			assert.throws(() => killBenchmarkBrowser({...browser(), pid}, {
				readFile: unexpected, readdir: unexpected, kill: unexpected,
			}), TypeError);
	});

	it('uses only root SIGKILL on non-Linux systems', () => {
		const f = fixture();
		f.options.platform = 'darwin';
		f.options.readFile = f.options.readdir = () => assert.fail('no proc on fallback');
		f.run();
		assert.deepEqual(f.calls, [[10, 'SIGKILL']]);
	});

	it('ignores proc exit races during discovery and a missing root', () => {
		for (const code of ['ENOENT', 'ESRCH']) {
			const f = fixture();
			f.files.set(30, failure(code));
			f.run();
			assert.deepEqual(f.calls, [40, 20, 10].map(pid => [pid, 'SIGKILL']));
			f.calls.length = 0;
			f.files.set(10, failure(code));
			f.run();
			assert.deepEqual(f.calls, []);
		}
	});

	it('ignores ESRCH from signals and keeps killing the rest of the tree', () => {
		const f = fixture();
		const kill = f.options.kill;
		f.options.kill = (pid, signal) => {
			kill(pid, signal);
			throw failure('ESRCH');
		};
		f.run();
		assert.deepEqual(f.calls, [30, 40, 20, 10].map(pid => [pid, 'SIGKILL']));
	});

	it('continues after permission errors and reports them, including root kill failures', () => {
		const f = fixture();
		const kill = f.options.kill;
		f.options.kill = (pid, signal) => {
			kill(pid, signal);
			if (pid === 30 || pid === 10)
				throw failure('EPERM');
		};
		assertErrors(f.run, ['EPERM', 'EPERM']);
		assert.deepEqual(f.calls, [30, 40, 20, 10].map(pid => [pid, 'SIGKILL']));
	});

	it('reports unreadable proc entries but still kills known targets', () => {
		const f = fixture();
		f.files.set(91, failure('EACCES'));
		assertErrors(f.run, ['EACCES']);
		assert.deepEqual(f.calls, [30, 40, 20, 10].map(pid => [pid, 'SIGKILL']));
	});

	it('attempts root cleanup and reports failed proc access', () => {
		for (const operation of ['readFile', 'readdir']) {
			const f = fixture();
			f.options[operation] = () => { throw failure('EACCES'); };
			assertErrors(f.run, ['EACCES']);
			assert.deepEqual(f.calls, [[10, 'SIGKILL']]);
		}
	});

	it('does not signal PIDs that exit or get reused between discovery and signaling', () => {
		const f = fixture();
		const readFile = f.options.readFile;
		f.options.readFile = (path, encoding) => {
			if (path === '/proc/30/stat' && f.reads.get(30) === 1)
				f.files.delete(30);
			if (path === '/proc/20/stat' && f.reads.get(20) === 1)
				f.files.set(20, stat(20, 90, '999999'));
			if (path === '/proc/10/stat' && f.reads.get(10) === 1)
				f.files.set(10, stat(10, 90, '999999'));
			return readFile(path, encoding);
		};
		f.run();
		assert.deepEqual(f.calls, [[40, 'SIGKILL']]);
	});

	it('still kills an observed descendant reparented after discovery', () => {
		const f = fixture();
		const readFile = f.options.readFile;
		f.options.readFile = (path, encoding) => {
			if (path === '/proc/30/stat' && f.reads.get(30) === 1)
				f.files.set(30, stat(30, 1));
			return readFile(path, encoding);
		};
		f.run();
		assert.deepEqual(f.calls, [30, 40, 20, 10].map(pid => [pid, 'SIGKILL']));
	});
});

// Inline fixture keeps this test self-contained. Every process has a safety deadline,
// even if setup fails before its PID reaches the test. All share the test's process group.
const fixtureSource = `
	const {spawn} = require('node:child_process');
	const depth = Number(process.argv[1]);
	setTimeout(() => process.exit(0), 8000);
	process.send({pid: process.pid, ppid: process.ppid});
	if (depth > 0) {
		const child = spawn(process.execPath, ['-e', process.argv[2], String(depth - 1), process.argv[2]], {
			detached: false, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
		});
		child.on('message', message => process.send(message));
	}
`;

async function waitUntil(check, message) {
	const deadline = Date.now() + 3000;
	while (!check()) {
		assert.ok(Date.now() < deadline, message);
		await delay(10);
	}
}

function isRunning(expected) {
	try {
		const text = readFileSync(`/proc/${expected.pid}/stat`, 'utf8');
		return parseProcStat(text).startTime === expected.startTime &&
			!['Z', 'X'].includes(text.slice(text.lastIndexOf(')') + 1).trim()[0]);
	}
	catch (error) {
		if (error.code === 'ENOENT' || error.code === 'ESRCH')
			return false;
		throw error;
	}
}

describe('benchmark browser process cleanup on Linux', function() {

	it('kills a real root, child, and grandchild without killing an unrelated sibling', { timeout: 10000 }, async t => {
		if (process.platform !== 'linux')
			return t.skip('Requires Linux /proc');
		const handles = [];
		const records = [];
		const errors = [];
		function start(depth) {
			const child = spawn(process.execPath, ['-e', fixtureSource, String(depth), fixtureSource], {
				detached: false, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
				env: {...process.env, NODE_OPTIONS: ''},
			});
			handles.push(child);
			child.on('error', error => errors.push(error));
			child.on('message', message => {
				try {
					const record = parseProcStat(readFileSync(`/proc/${message.pid}/stat`, 'utf8'));
					assert.equal(record.ppid, message.ppid);
					records.push(record);
				}
				catch (error) { errors.push(error); }
			});
			return child;
		}
		try {
			const root = start(2);
			const unrelated = start(0);
			await waitUntil(() => {
				if (errors.length)
					throw errors[0];
				return records.length === 4;
			}, 'fixture did not become ready');
			const child = records.find(record => record.ppid === root.pid);
			const grandchild = records.find(record => record.ppid === child?.pid);
			assert.ok(child && grandchild, 'fixture must include two descendant generations');
			const targets = records.filter(record => record.pid !== unrelated.pid);
			const survivor = records.find(record => record.pid === unrelated.pid);
			assert.ok(records.every(isRunning));

			assert.equal(killBenchmarkBrowser(root), undefined, 'cleanup must be synchronous');
			// Orphaned zombies can await PID 1 reaping; they are dead, not surviving workers.
			await waitUntil(() => targets.every(record => !isRunning(record)) && root.signalCode !== null,
				'browser tree survived SIGKILL');
			assert.equal(root.signalCode, 'SIGKILL');
			assert.equal(unrelated.exitCode, null);
			assert.equal(unrelated.signalCode, null);
			assert.ok(isRunning(survivor), 'unrelated process must survive');
			assert.equal(killBenchmarkBrowser(root), undefined, 'observed exits are no-ops');
		}
		finally {
			// Independent cleanup also runs when the implementation or an assertion fails.
			for (const record of [...records].reverse()) {
				if (isRunning(record)) {
					try { process.kill(record.pid, 'SIGKILL'); }
					catch (error) { if (error.code !== 'ESRCH') throw error; }
				}
			}
			for (const child of handles) {
				if (child.exitCode === null && child.signalCode === null)
					child.kill('SIGKILL');
			}
			await waitUntil(() => handles.every(child => child.exitCode !== null || child.signalCode !== null),
				'fixture cleanup did not finish');
		}
	});
});
