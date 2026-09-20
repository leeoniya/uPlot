import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Opt-in source replacement for the prototype compatibility run. Dist stays on ivi.
const original = new URL('../src/legend-ivi.js', import.meta.url);
const candidate = new URL('../src/legend-dom.js', import.meta.url);
let reported = false;
function report() {
	if (!reported) {
		console.log('Legend prototype: source imports use legend-dom.js (distribution artifacts remain on ivi)');
		reported = true;
	}
}

if (process.versions.bun) {
	const { plugin } = await import('bun');
	plugin({
		name: 'legend-dom-prototype',
		setup(build) {
			build.onResolve({ filter: /legend-ivi\.js$/ }, ({ path, importer }) => {
				if (resolve(dirname(importer), path) === fileURLToPath(original)) {
					report();
					return { path: fileURLToPath(candidate) };
				}
			});
		},
	});
}
else {
	const { registerHooks } = await import('node:module');
	registerHooks({
		resolve(specifier, context, nextResolve) {
			const result = nextResolve(specifier, context);
			if (result.url === original.href) {
				report();
				return { ...result, url: candidate.href };
			}
			return result;
		},
	});
}
