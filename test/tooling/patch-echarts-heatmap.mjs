import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { patchBundle, rewireDemo, patchDemo, revertDemo, bundlePath, downloadUrl } from '../../scripts/patch-echarts-heatmap.mjs';

const originalCall = 'this._renderOnGridLike(seriesModel, api, 0, seriesModel.getData().count());';
const patchedCall = 'this._renderOnGridLike(seriesModel, api, 0, seriesModel.getData().count(), false);';
const incrementalCall = 'this._renderOnGridLike(seriesModel, api, params.start, params.end, true);';
const source = `/* upstream license */\n${originalCall}\n${incrementalCall}\n`;
const cdnScript = '<script src="https://fastly.jsdelivr.net/npm/echarts@6.1.0/dist/echarts.min.js"></script>';
const localScript = '<script src="./lib/echarts-6.1.0.heatmap-patched.js"></script>';
const html = `<!doctype html>\n<p>ECharts loads from a CDN and requires network access.</p>\n${cdnScript}\n<script>const message = 'Serve the repository root over HTTP and allow the ECharts CDN request.';</script>\n<!-- preserve other content -->\n`;

async function fixture(run) {
	const directory = await mkdtemp(`${tmpdir()}/uplot-patch-echarts-`);
	const root = pathToFileURL(`${directory}/`);
	try {
		await mkdir(new URL('demos/lib/', root), { recursive: true });
		await writeFile(new URL('demos/heatmap-cells-echarts.html', root), html);
		await writeFile(new URL('demos/heatmap-cells-echarts-gl.html', root), 'GL demo must not change');
		await run(root);
	}
	finally {
		await rm(directory, { recursive: true, force: true });
	}
}

const response = text => ({ ok: true, status: 200, text: async () => text });

describe('ECharts heatmap patch script', () => {

	it('patches only normal heatmap rendering and preserves the upstream license and progressive call', () => {
		const patched = patchBundle(source);
		assert.ok(patched.startsWith('// ECharts 6.1.0:'));
		assert.equal(patched.slice(patched.indexOf('\n') + 1), source.replace(originalCall, patchedCall));
		assert.ok(patched.includes('/* upstream license */'));
		assert.ok(patched.includes(incrementalCall));
	});

	for (const [name, input] of [
		['missing match', incrementalCall],
		['duplicate match', source + originalCall],
		['already patched source', source.replace(originalCall, patchedCall)],
		['mixed patched and original source', source + patchedCall],
	]) {
		it(`rejects ${name}`, () => {
			assert.throws(() => patchBundle(input), /exactly one unpatched/);
		});
	}

	it('rewires the script and loading instructions without touching other HTML, and can run again', () => {
		const rewired = rewireDemo(html);
		assert.ok(rewired.includes(localScript));
		assert.ok(!rewired.includes(cdnScript));
		assert.ok(!rewired.includes('requires network access'));
		assert.ok(rewired.includes('node scripts/patch-echarts-heatmap.mjs'));
		assert.ok(rewired.endsWith('<!-- preserve other content -->\n'));
		assert.equal(rewireDemo(rewired), rewired);
	});

	it('restores the exact CDN HTML and supports reverting an already reverted demo', () => {
		assert.equal(rewireDemo(rewireDemo(html), true), html);
		assert.equal(rewireDemo(html, true), html);
	});

	for (const [name, input] of [
		['missing script', html.replace(cdnScript, '')],
		['duplicate script', html + cdnScript],
		['both local and remote scripts', html + localScript],
		['unexpected version', html.replace('@6.1.0/', '@6.0.0/')],
		['changed loading instructions', html.replace('ECharts loads from a CDN and requires network access.', 'User-edited text')],
	]) {
		it(`refuses to rewire ${name}`, () => {
			assert.throws(() => rewireDemo(input), /Cannot safely update/);
			assert.throws(() => rewireDemo(input, true), /Cannot safely update/);
		});
	}

	it('downloads the pinned unminified bundle, installs it, rewires only the plain demo, and supports reruns', async () => {
		await fixture(async root => {
			let calls = 0;
			const fetchBundle = async (url, options) => {
				calls++;
				assert.equal(url, downloadUrl);
				assert.equal(url, 'https://fastly.jsdelivr.net/npm/echarts@6.1.0/dist/echarts.js');
				assert.equal(options.signal.aborted, false);
				return response(source);
			};
			for (let i = 0; i < 2; i++) {
				await patchDemo(root, fetchBundle);
				assert.equal(await readFile(new URL(bundlePath, root), 'utf8'), patchBundle(source));
				assert.equal(await readFile(new URL('demos/heatmap-cells-echarts.html', root), 'utf8'), rewireDemo(html));
				assert.equal(await readFile(new URL('demos/heatmap-cells-echarts-gl.html', root), 'utf8'), 'GL demo must not change');
			}
			assert.equal(calls, 2);
			assert.deepEqual(await readdir(new URL('demos/lib/', root)), ['echarts-6.1.0.heatmap-patched.js']);
			assert.deepEqual((await readdir(new URL('demos/', root))).sort(), ['heatmap-cells-echarts-gl.html', 'heatmap-cells-echarts.html', 'lib']);
		});
	});

	for (const hasBundle of [true, false]) {
		it(`reverts without ${hasBundle ? 'modifying the local bundle' : 'requiring a local bundle'} and leaves GL untouched`, async () => {
			await fixture(async root => {
				if (hasBundle) await writeFile(new URL(bundlePath, root), 'Locally modified bundle');
				await writeFile(new URL('demos/heatmap-cells-echarts.html', root), rewireDemo(html));
				for (let i = 0; i < 2; i++) {
					await revertDemo(root);
					assert.equal(await readFile(new URL('demos/heatmap-cells-echarts.html', root), 'utf8'), html);
					assert.equal(await readFile(new URL('demos/heatmap-cells-echarts-gl.html', root), 'utf8'), 'GL demo must not change');
				}
				if (hasBundle) assert.equal(await readFile(new URL(bundlePath, root), 'utf8'), 'Locally modified bundle');
				else assert.deepEqual(await readdir(new URL('demos/lib/', root)), []);
			});
		});
	}

	it('refuses to revert unexpected HTML without changing files', async () => {
		await fixture(async root => {
			const unexpected = rewireDemo(html).replace(localScript, 'User-edited script');
			await writeFile(new URL('demos/heatmap-cells-echarts.html', root), unexpected);
			await assert.rejects(revertDemo(root), /Cannot safely update/);
			assert.equal(await readFile(new URL('demos/heatmap-cells-echarts.html', root), 'utf8'), unexpected);
		});
	});

	it('handles --revert from another working directory, provides help, and rejects unknown flags', async () => {
		await fixture(async root => {
			await mkdir(new URL('scripts/', root));
			const script = new URL('scripts/patch-echarts-heatmap.mjs', root);
			await writeFile(script, await readFile(new URL('../../scripts/patch-echarts-heatmap.mjs', import.meta.url)));
			await writeFile(new URL('demos/heatmap-cells-echarts.html', root), rewireDemo(html));
			const run = args => promisify(execFile)(process.execPath, [script.pathname, ...args], {
				cwd: new URL('demos/', root), timeout: 10000,
				env: { ...process.env, NODE_OPTIONS: '' },
			});
			const { stdout } = await run(['--revert']);
			assert.match(stdout, /Restored CDN loading/);
			assert.doesNotMatch(stdout, /Downloading/);
			assert.equal(await readFile(new URL('demos/heatmap-cells-echarts.html', root), 'utf8'), html);
			assert.match((await run(['--help'])).stdout, /--revert/);
			await assert.rejects(run(['--typo']), /Usage:/);
			assert.equal(await readFile(new URL('demos/heatmap-cells-echarts.html', root), 'utf8'), html);
		});
	});

	for (const [name, fetchBundle, changedHtml, error] of [
		['HTTP error', async () => ({ ok: false, status: 503 }), html, /HTTP 503/],
		['network error', async () => { throw new Error('Download unavailable'); }, html, /Download unavailable/],
		['unexpected library', async () => response(incrementalCall), html, /exactly one unpatched/],
		['unexpected demo', async () => response(source), html.replace(cdnScript, ''), /Cannot safely update/],
	]) {
		it(`leaves existing files untouched on ${name}`, async () => {
			await fixture(async root => {
				await writeFile(new URL(bundlePath, root), 'Existing library');
				await writeFile(new URL('demos/heatmap-cells-echarts.html', root), changedHtml);
				await assert.rejects(patchDemo(root, fetchBundle), error);
				assert.equal(await readFile(new URL(bundlePath, root), 'utf8'), 'Existing library');
				assert.equal(await readFile(new URL('demos/heatmap-cells-echarts.html', root), 'utf8'), changedHtml);
			});
		});
	}
});
