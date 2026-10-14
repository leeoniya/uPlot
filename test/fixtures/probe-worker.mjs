import { writeFileSync, writeSync } from 'node:fs';
import { serveProbes } from '../../scripts/probe-worker.mjs';

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
			return { nodeOptions: process.env.NODE_OPTIONS };
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
