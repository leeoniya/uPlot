import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';
import { patchBundle } from '../../scripts/patch-bokeh-highp.mjs';

const expectedBundlePath = 'demos/lib/bokeh-gl-3.10.0.highp.js';
const expectedOriginalBundlePath = 'demos/lib/bokeh-gl-3.10.0.js';
const highp = text => text.replace('precision mediump float;', 'precision highp float;');

function withoutGeneratedComment(patched) {
	const match = /^(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\r?\n)/.exec(patched);
	assert.ok(match, 'Expected one leading generated comment');
	assert.match(match[0], /generated/i);
	return patched.slice(match[0].length);
}

describe('Bokeh WebGL highp patch script', () => {
	it('matches an available generated GL bundle and preserves every other byte of upstream source', async function() {
		this.timeout(10000);
		let generated;
		try { generated = await readFile(new URL(`../../${expectedBundlePath}`, import.meta.url), 'utf8'); }
		catch (error) {
			if (error.code == 'ENOENT') return this.skip(); // Run the patch script to enable this integration check.
			throw error;
		}
		const original = await readFile(new URL(`../../${expectedOriginalBundlePath}`, import.meta.url), 'utf8');
		new Script(original);
		new Script(generated);
		assert.equal(generated, patchBundle(original));
		let expected = original;
		for (const name of ['marker.vert', 'marker.frag']) {
			const prefix = `/* models/glyphs/webgl/${name}.js */ function _(require, module, exports, __esModule, __esExport) {\n    __esModule();\n    const shader = \`\nprecision mediump float;`;
			assert.equal(expected.split(prefix).length - 1, 1);
			expected = expected.replace(prefix, highp(prefix));
		}
		assert.equal(withoutGeneratedComment(generated), expected);
	});
});
