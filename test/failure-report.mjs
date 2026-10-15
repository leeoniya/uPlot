import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';

const root = fileURLToPath(new URL('../', import.meta.url));

describe('consolidated failure report', function() {
	this.timeout(30000);

	it('collects every mismatched plot and removes the report after a passing run', async () => {
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
				...(process.versions.bun ? [] : ['--max-old-space-size=512', '--throw-deprecation', '--input-type=module']),
				'-e', `
					const { default: Mocha } = await import(${JSON.stringify(import.meta.resolve('mocha'))});
					const mocha = new Mocha({ reporter: 'dot', grep: /^(area-fill 0-0|multi-bars 0-variable-colors)$/ });
					mocha.addFile(${JSON.stringify(path.join(root, 'test/test.mjs'))});
					await mocha.loadFilesAsync();
					mocha.run(failures => { process.exitCode = failures; });
				`,
			];
			const run = () => spawnSync(process.execPath, args, {
				cwd, env: { ...process.env, NODE_OPTIONS: '' },
				encoding: 'utf8', timeout: 12000,
			});
			const failed = run();
			assert.ifError(failed.error);
			assert.equal(failed.status, 2, failed.stdout + failed.stderr);
			assert.match(failed.stdout, /2 failing/);
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
			assert.match(passed.stdout, /2 passing/);
			assert.equal(fs.existsSync(report), false);
		}
		finally {
			await window?.happyDOM.close();
			fs.rmSync(cwd, { recursive: true, force: true });
		}
	});
});
