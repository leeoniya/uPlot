import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';

const root = fileURLToPath(new URL('../', import.meta.url));

describe('consolidated failure report', { timeout: 30000 }, () => {
	it('collects every mismatched plot and removes the report after a passing run', async () => {
		// Outside test/output, which test/test.mjs clears when it loads in a parallel worker.
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'uplot-consolidated-'));
		const snapshots = [
			'area-fill/0-0.json',
			'multi-bars/0-variable-colors/0.json',
			'multi-bars/0-variable-colors/1.json',
		];
		let window;

		try {
			const originals = snapshots.map(name => {
				const original = fs.readFileSync(path.join(root, 'test/demos', name), 'utf8');
				const expected = JSON.parse(original);
				expected.width++;
				const filename = path.join(cwd, 'test/demos', name);
				fs.mkdirSync(path.dirname(filename), { recursive: true });
				fs.writeFileSync(filename, JSON.stringify(expected));
				return { filename, original };
			});

			// Run the snapshot test in a nested Vitest whose cwd holds the modified snapshots.
			const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('VITEST')));
			const args = [
				path.join(root, 'node_modules/vitest/vitest.mjs'), 'run',
				'--root', root, '--project', 'unit', '--reporter', 'dot',
				'-t', '^(area-fill > 0-0|multi-bars > 0-variable-colors)$',
				'test/test.mjs',
			];
			const run = () => spawnSync(process.execPath, args, {
				cwd, env: { ...env, NODE_OPTIONS: '', FORCE_COLOR: '0', NO_COLOR: '1' },
				encoding: 'utf8', timeout: 20000,
			});
			const failed = run();
			assert.ifError(failed.error);
			assert.equal(failed.status, 1, failed.stdout + failed.stderr);
			assert.match(failed.stdout, /Tests\s+2 failed/);
			assert.match(failed.stdout, /Visual comparisons: test\/output\/index\.html/);
			const reportDir = path.join(cwd, 'test/output');
			assert.deepStrictEqual(fs.readdirSync(reportDir), ['index.html']);
			const report = path.join(reportDir, 'index.html');
			window = new Window({ settings: { disableJavaScriptEvaluation: true } });
			window.document.write(fs.readFileSync(report, 'utf8'));
			assert.deepStrictEqual(Array.from(window.document.querySelectorAll('h2'), heading => heading.textContent), [
				'area-fill 0-0',
				'multi-bars 0-variable-colors/0',
				'multi-bars 0-variable-colors/1',
			]);
			assert.equal(window.document.querySelectorAll('canvas').length, 3);

			for (const { filename, original } of originals)
				fs.writeFileSync(filename, original);

			const passed = run();
			assert.ifError(passed.error);
			assert.equal(passed.status, 0, passed.stdout + passed.stderr);
			assert.match(passed.stdout, /Tests\s+2 passed/);
			assert.equal(fs.existsSync(report), false);
		}
		finally {
			await window?.happyDOM.close();
			fs.rmSync(cwd, { recursive: true, force: true });
		}
	});
});
