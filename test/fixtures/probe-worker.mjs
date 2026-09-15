import { writeFileSync, writeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serveProbes } from '../../scripts2/probe-worker.mjs';

const mode = process.env.UPLOT_WORKER_TEST_MODE;

if (mode == 'startup-hang') {
	setInterval(() => {}, 1000);
	await new Promise(() => {});
}
else if (mode == 'startup-crash')
	process.exit(17);
else if (['wrong-result', 'bad-exit', 'shutdown-hang'].includes(mode)) {
	process.on('message', message => {
		if (message.type == 'run') {
			process.send({ type: 'result', name: mode == 'wrong-result' ? 'other-probe' : message.name, ok: true }, () => {
				if (mode == 'bad-exit')
					process.exit(23);
			});
		}
		else if (message.type == 'stop') {
			if (mode == 'shutdown-hang')
				while (true) {}
			process.exit(23);
		}
	});
	process.send({ type: 'ready' });
}
else {
	let count = 0;
	serveProbes({
		count() { return ++count; },
		pid() { return process.pid; },
		environment() {
			return { nodeOptions: process.env.NODE_OPTIONS, coverageDir: process.env.UPLOT_COVERAGE_DIR ?? null };
		},
		async coverage() {
			const { rangeNum } = await import('../../src/utils.js');
			rangeNum(0, 10, 0.1, true);
			const filename = fileURLToPath(new URL('../../src/utils.js', import.meta.url));
			const counters = globalThis.__coverage__?.[filename];
			return counters != null && Object.values(counters.f).some(count => count > 0);
		},
		fail() { throw new Error('intentional assertion failure'); },
		crash() {
			writeSync(2, 'intentional crash diagnostic\n');
			process.exit(23);
		},
		hang() { while (true) {} },
		flushOnExit() {
			process.on('exit', () => { writeFileSync(process.env.UPLOT_WORKER_EXIT_FILE, 'flushed'); });
		},
	});
}
