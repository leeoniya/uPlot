import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const artifacts = ['dist/uPlot.esm.js', 'dist/uPlot.cjs.js', 'dist/uPlot.iife.js', 'dist/uPlot.iife.min.js'];

describe('legend build artifacts', function() {
	it('loads source and every distribution without a DOM and exposes public utilities', function() {
		this.timeout(6000);

		const output = execFileSync(process.execPath, [
			'--max-old-space-size=128', '--input-type=module', '-e', `
				import assert from 'node:assert/strict';
				import { readFileSync } from 'node:fs';
				import { runInNewContext } from 'node:vm';

				function checkNoDOM(scope) {
					for (const key of ['window', 'document', 'Node', 'Element'])
						assert.equal(typeof scope[key], 'undefined', key + ' must be absent');
				}

				function check(uPlot, filename) {
					assert.equal(typeof uPlot, 'function', filename + ': constructor');
					for (const key of ['assign', 'fmtNum', 'rangeNum', 'rangeLog', 'rangeAsinh', 'scan', 'join', 'fmtDate', 'tzDate', 'sync'])
						assert.equal(typeof uPlot[key], 'function', filename + ': ' + key);
					assert.equal(typeof uPlot.paths.linear, 'function', filename + ': paths.linear');
					assert.equal(uPlot.fmtNum(123), '123', filename + ': fmtNum result');
					assert.equal(uPlot.fmtDate('{YYYY}')(new Date(2020, 0, 2)), '2020', filename + ': fmtDate result');
					const range = uPlot.rangeNum(0, 100, 0.1, true);
					assert.equal(range.length, 2, filename + ': rangeNum length');
					assert.ok(range[0] <= 0 && range[1] >= 100, filename + ': rangeNum bounds');
				}

				checkNoDOM(globalThis);
				for (const filename of ['src/uPlot.js', 'dist/uPlot.esm.js'])
					check((await import('./' + filename)).default, filename);

				for (const filename of ['dist/uPlot.cjs.js', 'dist/uPlot.iife.js', 'dist/uPlot.iife.min.js']) {
					const commonJS = filename.endsWith('.cjs.js');
					const module = { exports: {} };
					// The .cjs.js file is under type: module, so evaluate it as CommonJS in a VM.
					const context = { queueMicrotask, setTimeout, clearTimeout };
					if (commonJS)
						Object.assign(context, { module, exports: module.exports });
					checkNoDOM(context);
					runInNewContext(readFileSync(filename, 'utf8'), context, { filename, timeout: 1000 });
					check(commonJS ? module.exports : context.uPlot, filename);
					checkNoDOM(context);
				}
				checkNoDOM(globalThis);
				console.log('DOM-free loading passed');
			`,
		], {
			cwd: fileURLToPath(root),
			env: { ...process.env, NODE_OPTIONS: '' },
			encoding: 'utf8',
			timeout: 5000,
		});

		assert.equal(output.trim(), 'DOM-free loading passed');
	});

	for (const filename of artifacts) {
		it(`matches source drawing and DOM lifecycle in ${filename}`, function() {
			this.timeout(10000);
			const output = execFileSync(process.execPath, [
				'--max-old-space-size=128', './test/helpers/build-artifact-dom.mjs', filename,
			], {
				cwd: fileURLToPath(root),
				// Compare actual bundle code, not Istanbul-transformed output.
				env: { ...process.env, NODE_OPTIONS: '' },
				encoding: 'utf8',
				timeout: 8000,
			});
			assert.equal(output.trim(), 'DOM build parity passed');
		});
	}

	it('preserves the full and minified JavaScript banners with the package version', () => {
		const { version } = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
		const url = `https://github.com/leeoniya/uPlot (v${version})`;
		for (const filename of artifacts) {
			const code = readFileSync(new URL(filename, root), 'utf8');
			if (filename.endsWith('.min.js'))
				assert.ok(code.startsWith(`/*! ${url} */`), filename + ': short banner');
			else {
				// A checked-in build remains valid after the calendar year changes.
				const copyright = code.match(/^\/\*\*\n\* Copyright \(c\) (\d{4}), Leon Sorokin\n/);
				assert.ok(copyright, filename + ': copyright banner');
				const banner = [
					'/**',
					`* Copyright (c) ${copyright[1]}, Leon Sorokin`,
					'* All rights reserved. (MIT Licensed)',
					'*',
					'* uPlot.js (μPlot)',
					'* A small, fast chart for time series, lines, areas, ohlc & bars',
					`* ${url}`,
					'*/',
					'',
				].join('\n');
				assert.ok(code.startsWith(banner), filename + ': full banner');
			}
		}
	});

	it('preserves the existing CSS minification output', () => {
		const source = readFileSync(new URL('src/uPlot.css', root), 'utf8');
		const expected = source
			.replace(/\s{1,}/g, ' ')
			.replace(/\{\s{1,}/g, '{')
			.replace(/\}\s{1,}/g, '}')
			.replace(/;\s{1,}/g, ';')
			.replace(/\/\*\s{1,}/g, '/*')
			.replace(/\*\/\s{1,}/g, '*/');
		assert.equal(readFileSync(new URL('dist/uPlot.min.css', root), 'utf8'), expected);
	});
});
