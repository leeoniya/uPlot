import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import demos, { coreDemos, pluginDemos } from '../demos.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

describe('consolidated failure report', function() {

	it('collects every mismatched plot and removes the report after a passing run', { timeout: 30000 }, async () => {
		const combined = [...coreDemos, ...pluginDemos];
		assert.equal(new Set(combined).size, combined.length);
		assert.deepEqual(combined.sort(), [...demos].sort());
		assert.ok(coreDemos.includes('area-fill'));
		assert.ok(pluginDemos.includes('multi-bars'));

		const output = path.join(root, 'test/output');
		fs.mkdirSync(output, { recursive: true });
		const cwd = fs.mkdtempSync(path.join(output, 'consolidated-'));
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

			const args = [
				...(process.versions.bun ? [] : ['--max-old-space-size=512', '--throw-deprecation']),
				path.join(root, 'scripts/test.mjs'), '--no-coverage',
				path.join(root, 'test/test.mjs'),
				path.join(root, 'test/plugins/test.mjs'),
				'--test-name-pattern', '^(area-fill 0-0|multi-bars 0-variable-colors)$',
			];
			const run = () => spawnSync(process.execPath, args, {
				cwd, env: { ...process.env, NODE_OPTIONS: '' },
				encoding: 'utf8', timeout: 12000,
			});
			const failed = run();
			assert.ifError(failed.error);
			const failedOutput = failed.stdout + failed.stderr;
			assert.equal(failed.status, 1, failedOutput);
			assert.match(failedOutput, /(?:fail 2\b|\b2 fail\b)/);
			assert.equal((failedOutput.match(/Visual comparisons: test\/output\/index\.html \(3 failed snapshots\)/g) ?? []).length, 1, failedOutput);
			const reportDir = path.join(cwd, 'test/output');
			assert.deepStrictEqual(fs.readdirSync(reportDir), ['index.html']);
			const report = path.join(reportDir, 'index.html');
			window = new Window({ settings: { disableJavaScriptEvaluation: true } });
			window.document.write(fs.readFileSync(report, 'utf8'));
			// Native runners can load the selected files in a different order.
			assert.deepStrictEqual(Array.from(window.document.querySelectorAll('h2'), heading => heading.textContent).sort(), [
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
			assert.match(passed.stdout + passed.stderr, /(?:pass 2\b|\b2 pass\b)/);
			assert.equal(fs.existsSync(report), false);
		}
		finally {
			await window?.happyDOM.close();
			fs.rmSync(cwd, { recursive: true, force: true });
		}
	});
});
