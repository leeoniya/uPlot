import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, link, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { Script } from 'node:vm';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { version, bundles, bundlePath, demoPath, patchBundle, rewireDemo, patchDemo, revertDemo } from '../../scripts/patch-bokeh-highp.mjs';

const expectedBundles = ['bokeh', 'bokeh-gl', 'bokeh-api'].map(name => ({
	name,
	url: `https://cdn.bokeh.org/bokeh/release/${name}-3.10.0.js`,
	path: `demos/lib/${name}-3.10.0.js`,
}));
const expectedBundlePath = 'demos/lib/bokeh-gl-3.10.0.highp.js';
const expectedDemoPath = 'demos/heatmap-cells-bokeh.html';
const description = 'This comparison uses the positive log view only. WebGL requires browser support.';
const instructions = 'Serve the repository root over HTTP and check CDN access.';
const scriptTag = src => `<script src="${src}"></script>`;
const cdnScripts = expectedBundles.map(bundle => scriptTag(bundle.url.replace('.js', '.min.js')));
const scriptsFor = mode => mode == 'cdn' ? cdnScripts : expectedBundles.map(bundle =>
	scriptTag('./' + (mode == 'highp' && bundle.name == 'bokeh-gl' ? expectedBundlePath : bundle.path).slice('demos/'.length)));
const html = rewireDemo(await readFile(new URL(`../../${expectedDemoPath}`, import.meta.url), 'utf8'), 'cdn');

function shaderModule(id, name, body = 'precision mediump float;\nprecision mediump int;\nvoid main() { gl_Position = vec4(0.0); }') {
	return `${id}: /* models/glyphs/webgl/${name}.js */ function _(require, module, exports, __esModule, __esExport) {\n    __esModule();\n    const shader = \`\n${body}\n\`;\n    exports.default = shader;\n},`;
}

const vertex = shaderModule(651, 'marker.vert');
const fragment = shaderModule(652, 'marker.frag', 'precision mediump float;\nprecision mediump int;\nvoid main() { gl_FragColor = vec4(1.0); }');
const otherShaders = [
	shaderModule(650, 'line.vert'),
	shaderModule(653, 'line.frag'),
	shaderModule(654, 'image.frag', 'precision highp float;\nvoid main() { gl_FragColor = vec4(1.0); }'),
].join('\n');
const source = `/* upstream license: preserve verbatim */\nconst modules = {\n${vertex}\n${fragment}\n${otherShaders}\n};\n`;
const highp = text => text.replace('precision mediump float;', 'precision highp float;');
const sources = ['/* core license */\nconst Bokeh = {version: "3.10.0"};\n', source, '/* API license */\nconst api = {};\n'];
const response = text => ({ ok: true, status: 200, text: async () => text });
const fetchSources = async url => {
	const index = expectedBundles.findIndex(bundle => bundle.url == url);
	assert.notEqual(index, -1, `Unexpected download: ${url}`);
	return response(sources[index]);
};
const artifactPaths = [...expectedBundles.map(bundle => bundle.path), expectedBundlePath];

async function fixture(run) {
	const directory = await mkdtemp(`${tmpdir()}/uplot-patch-bokeh-`);
	const root = pathToFileURL(`${directory}/`);
	try {
		await mkdir(new URL('demos/lib/', root), { recursive: true });
		await writeFile(new URL(expectedDemoPath, root), html);
		await writeFile(new URL('demos/other-demo.html', root), 'Other demos must not change');
		await writeFile(new URL('demos/lib/unrelated.js', root), '/* Other libraries must not change */');
		await run(root);
	}
	finally {
		await rm(directory, { recursive: true, force: true });
	}
}

async function snapshot(root, prefix = '') {
	const files = {};
	for (const entry of await readdir(new URL(prefix, root), { withFileTypes: true })) {
		const path = prefix + entry.name;
		if (entry.isDirectory()) Object.assign(files, await snapshot(root, path + '/'));
		else files[path] = await readFile(new URL(path, root), 'utf8');
	}
	return files;
}

async function seedArtifacts(root) {
	for (const path of artifactPaths) await writeFile(new URL(path, root), `Existing ${path}`);
}

async function assertInstalled(root, mode) {
	for (let i = 0; i < expectedBundles.length; i++)
		assert.equal(await readFile(new URL(expectedBundles[i].path, root), 'utf8'), sources[i]);
	assert.equal(await readFile(new URL(expectedBundlePath, root), 'utf8'), patchBundle(source));
	assert.equal(await readFile(new URL(expectedDemoPath, root), 'utf8'), rewireDemo(html, mode));
	assert.equal(await readFile(new URL('demos/other-demo.html', root), 'utf8'), 'Other demos must not change');
	assert.equal(await readFile(new URL('demos/lib/unrelated.js', root), 'utf8'), '/* Other libraries must not change */');
	assert.deepEqual((await readdir(new URL('demos/lib/', root))).sort(), [...artifactPaths.map(path => path.split('/').pop()), 'unrelated.js'].sort());
	assert.deepEqual((await readdir(new URL('demos/', root))).sort(), ['heatmap-cells-bokeh.html', 'lib', 'other-demo.html']);
}

function withoutGeneratedComment(patched) {
	const match = /^(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\r?\n)/.exec(patched);
	assert.ok(match, 'Expected one leading generated comment');
	assert.match(match[0], /generated/i);
	return patched.slice(match[0].length);
}

describe('Bokeh WebGL highp patch script', () => {
	it('exports the pinned bundle URLs and output paths', () => {
		assert.equal(version, '3.10.0');
		assert.deepEqual(bundles, expectedBundles);
		assert.equal(bundlePath, expectedBundlePath);
		assert.equal(demoPath, expectedDemoPath);
	});

	it('changes only the two marker default float precisions and adds one leading comment', () => {
		new Script(source);
		const patched = patchBundle(source);
		new Script(patched);
		assert.equal(withoutGeneratedComment(patched), source.replace(vertex, highp(vertex)).replace(fragment, highp(fragment)));
		assert.ok(patched.includes(otherShaders));
		assert.throws(() => patchBundle(patched));
	});

	it('matches named shader modules when their numeric IDs change', () => {
		const renumberedVertex = vertex.replace(/^\d+:/, '901:');
		const renumberedFragment = fragment.replace(/^\d+:/, '902:');
		const renumbered = source.replace(vertex, renumberedVertex).replace(fragment, renumberedFragment);
		const patched = patchBundle(renumbered);
		new Script(patched);
		assert.equal(withoutGeneratedComment(patched), renumbered.replace(renumberedVertex, highp(renumberedVertex)).replace(renumberedFragment, highp(renumberedFragment)));
	});

	for (const [name, target] of [['vertex', vertex], ['fragment', fragment]]) {
		for (const [problem, replacement] of [
			['missing module', ''],
			['duplicate module', target + '\n' + target],

			['changed module name', target.replace('marker.', 'renamed.')],
			['changed default precision', target.replace('precision mediump float;', 'precision lowp float;')],
			['already patched module', highp(target)],
			['mixed patched and original modules', target + '\n' + highp(target)],
		]) {
			it(`rejects ${name}: ${problem}`, () => {
				assert.throws(() => patchBundle(source.replace(target, replacement)));
			});
		}
	}

	it('rejects a bundle with both targets already patched', () => {
		assert.throws(() => patchBundle(source.replace(vertex, highp(vertex)).replace(fragment, highp(fragment))));
	});

	it('rewires all three scripts and both instructions, reversibly and idempotently in every mode', () => {
		assert.equal(rewireDemo(html), rewireDemo(html, 'highp'));
		const outputs = new Map();
		for (const mode of ['highp', 'original', 'cdn']) {
			const rewired = rewireDemo(html, mode);
			outputs.set(mode, rewired);
			for (const tag of scriptsFor(mode)) assert.equal(rewired.split(tag).length - 1, 1);
			for (const tag of new Set([...cdnScripts, ...scriptsFor('highp'), ...scriptsFor('original')]))
				if (!scriptsFor(mode).includes(tag)) assert.ok(!rewired.includes(tag));
			assert.ok(rewired.includes(description));
			if (mode != 'cdn') {
				assert.ok(!rewired.includes(description + '</p>'), 'Expected mode-specific description suffix');
				assert.ok(!rewired.includes(instructions));
				assert.ok(rewired.includes('node scripts/patch-bokeh-highp.mjs'));
			}
			assert.equal(rewireDemo(rewired, mode), rewired);
			assert.equal(rewireDemo(rewired, 'cdn'), html);
		}
		assert.notEqual(outputs.get('highp').match(/This comparison[^\n]*<\/p>/)[0], outputs.get('original').match(/This comparison[^\n]*<\/p>/)[0]);
		for (const from of outputs.values())
			for (const [mode, to] of outputs) assert.equal(rewireDemo(from, mode), to);
	});

	for (const [index, bundle] of expectedBundles.entries()) {
		for (const [problem, input] of [
			['missing script', html.replace(cdnScripts[index], '')],
			['duplicate script', html + cdnScripts[index]],
			['both CDN and local scripts', html + scriptsFor('original')[index]],
			['unexpected version', html.replace(cdnScripts[index], cdnScripts[index].replace('3.10.0', '3.9.0'))],
		]) {
			it(`refuses ${bundle.name} HTML with ${problem}`, () => {
				for (const mode of ['highp', 'original', 'cdn']) assert.throws(() => rewireDemo(input, mode));
			});
		}
	}

	for (const [problem, input] of [
		['both original and patched GL references', rewireDemo(html, 'highp') + scriptsFor('original')[1]],
		['changed comparison sentence', html.replace(description, 'User-edited description')],
		['duplicate comparison sentence', html + description],
		['changed error instructions', html.replace(instructions, 'User-edited instructions')],
	]) {
		it(`refuses ${problem}`, () => {
			for (const mode of ['highp', 'original', 'cdn']) assert.throws(() => rewireDemo(input, mode));
		});
	}

	it('downloads sequentially with abort signals, preserves originals, and supports reruns and mode switches', async () => {
		await fixture(async root => {
			let active = false;
			const calls = [];
			let before;
			const fetchBundle = async (url, options) => {
				assert.equal(active, false, 'Previous response must finish before the next download');
				active = true;
				assert.ok(options.signal instanceof AbortSignal);
				assert.equal(options.signal.aborted, false);
				const index = calls.length % 3;
				assert.equal(url, expectedBundles[index].url);
				calls.push(url);
				return { ok: true, status: 200, text: async () => {
					assert.deepEqual(await snapshot(root), before, 'No writes before all downloads and validation finish');
					active = false;
					return sources[index];
				} };
			};
			for (const mode of [undefined, 'highp', 'original', 'original', 'highp']) {
				before = await snapshot(root);
				assert.deepEqual(await patchDemo(root, fetchBundle, mode), { bundlePath: expectedBundlePath, demoPath: expectedDemoPath });
				await assertInstalled(root, mode ?? 'highp');
			}
			assert.equal(calls.length, 15);
		});
	});

	it('atomically replaces existing files instead of truncating their contents', async () => {
		await fixture(async root => {
			await seedArtifacts(root);
			await mkdir(new URL('previous/', root));
			const paths = [...artifactPaths, expectedDemoPath];
			const previous = [];
			for (let i = 0; i < paths.length; i++) {
				previous.push(await readFile(new URL(paths[i], root), 'utf8'));
				await link(new URL(paths[i], root), new URL(`previous/${i}`, root));
			}
			await patchDemo(root, fetchSources);
			await assertInstalled(root, 'highp');
			for (let i = 0; i < paths.length; i++)
				assert.equal(await readFile(new URL(`previous/${i}`, root), 'utf8'), previous[i]);
		});
	});

	const failures = [
		['network error', () => { throw new Error('Download unavailable'); }],
		['HTTP error', () => ({ ok: false, status: 503 })],
		['body read error', () => ({ ok: true, status: 200, text: async () => { throw new Error('Body unavailable'); } })],
		['invalid JavaScript', index => response(sources[index] + '\nconst broken = ;')],
	];
	for (const [index, bundle] of expectedBundles.entries()) {
		for (const [problem, failure] of failures) {
			it(`leaves files untouched on ${bundle.name} ${problem}`, async () => {
				await fixture(async root => {
					for (const existing of [false, true]) {
						if (existing) await seedArtifacts(root);
						const before = await snapshot(root);
						await assert.rejects(patchDemo(root, async url => url == bundle.url ? failure(index) : fetchSources(url)));
						assert.deepEqual(await snapshot(root), before);
					}
				});
			});
		}
	}

	for (const [problem, glSource, demoHtml] of [
		['missing shader target', source.replace(vertex, ''), html],
		['already patched bundle', source.replace(vertex, highp(vertex)).replace(fragment, highp(fragment)), html],
		['unexpected HTML version', source, html.replace(cdnScripts[0], cdnScripts[0].replace('3.10.0', '3.9.0'))],
		['ambiguous HTML references', source, html + scriptsFor('highp')[1]],
	]) {
		it(`validates ${problem} before writing any files`, async () => {
			await fixture(async root => {
				await writeFile(new URL(expectedDemoPath, root), demoHtml);
				for (const existing of [false, true]) {
					if (existing) await seedArtifacts(root);
					const before = await snapshot(root);
					await assert.rejects(patchDemo(root, async url => url == expectedBundles[1].url ? response(glSource) : fetchSources(url)));
					assert.deepEqual(await snapshot(root), before);
				}
			});
		});
	}

	it('does not rewire the demo if installing the patched bundle fails, and removes temporary files', async () => {
		await fixture(async root => {
			await mkdir(new URL(expectedBundlePath + '/', root));
			await assert.rejects(patchDemo(root, fetchSources));
			assert.equal(await readFile(new URL(expectedDemoPath, root), 'utf8'), html);
			const files = await snapshot(root);
			assert.ok(Object.keys(files).every(path => artifactPaths.includes(path) || [expectedDemoPath, 'demos/other-demo.html', 'demos/lib/unrelated.js'].includes(path)));
		});
	});

	for (const mode of ['cdn', 'typo', null]) {
		it(`rejects patch mode ${JSON.stringify(mode)} before downloading or writing`, async () => {
			await fixture(async root => {
				const before = await snapshot(root);
				let calls = 0;
				await assert.rejects(patchDemo(root, async () => { calls++; return response(source); }, mode));
				assert.equal(calls, 0);
				assert.deepEqual(await snapshot(root), before);
			});
		});
	}

	for (const mode of ['highp', 'original']) {
		for (const existing of [false, true]) {
			it(`reverts ${mode} idempotently ${existing ? 'without modifying local files' : 'without local bundles'}`, async () => {
				await fixture(async root => {
					if (existing) await seedArtifacts(root);
					const before = await snapshot(root);
					await writeFile(new URL(expectedDemoPath, root), rewireDemo(html, mode));
					for (let i = 0; i < 2; i++) {
						await revertDemo(root);
						assert.deepEqual(await snapshot(root), before);
					}
				});
			});
		}
	}

	it('refuses to revert ambiguous HTML without changing files', async () => {
		await fixture(async root => {
			await seedArtifacts(root);
			await writeFile(new URL(expectedDemoPath, root), rewireDemo(html) + cdnScripts[1]);
			const before = await snapshot(root);
			await assert.rejects(revertDemo(root));
			assert.deepEqual(await snapshot(root), before);
		});
	});

	it('supports CLI default, --original, --revert, and --help from another working directory', { timeout: 20000 }, async function() {
		await fixture(async root => {
			await mkdir(new URL('scripts/', root));
			const script = new URL('scripts/patch-bokeh-highp.mjs', root);
			const preload = new URL('scripts/mock-fetch.mjs', root);
			await writeFile(script, await readFile(new URL('../../scripts/patch-bokeh-highp.mjs', import.meta.url)));
			await writeFile(preload, `import assert from 'node:assert/strict';
const urls = ${JSON.stringify(expectedBundles.map(bundle => bundle.url))};
const sources = ${JSON.stringify(sources)};
let calls = 0;
globalThis.fetch = async (url, options) => {
	assert.ok(!process.argv.includes('--revert') && !process.argv.includes('--help'), 'Unexpected download');
	assert.equal(url, urls[calls]);
	assert.ok(options.signal instanceof AbortSignal);
	assert.equal(options.signal.aborted, false);
	return {ok: true, status: 200, text: async () => sources[calls++]};
};
process.on('exit', code => {
	if (code == 0 && !process.argv.includes('--revert') && !process.argv.includes('--help')) assert.equal(calls, 3);
});
`);
			const run = args => promisify(execFile)(process.execPath, ['--import', preload.href, script.pathname, ...args], {
				cwd: new URL('demos/', root), timeout: 10000,
				env: { ...process.env, NODE_OPTIONS: '' },
			});
			await run([]);
			await assertInstalled(root, 'highp');
			await run(['--original']);
			await assertInstalled(root, 'original');
			const before = await snapshot(root);
			await run(['--revert']);
			assert.deepEqual(await snapshot(root), { ...before, [expectedDemoPath]: html });
			await run(['--revert']);
			const reverted = await snapshot(root);
			const { stdout } = await run(['--help']);
			assert.match(stdout, /--original/);
			assert.match(stdout, /--revert/);
			await assert.rejects(run(['--typo']));
			await assert.rejects(run(['--original', '--revert']));
			assert.deepEqual(await snapshot(root), reverted);
		});
	});

});
