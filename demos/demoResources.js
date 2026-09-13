// Cache immutable text; callers receive fresh JSON before sorting or chart mutation.
const texts = new Map();
const isNode = typeof process !== 'undefined' && process.versions?.node != null;

async function readText(path) {
	const url = new URL(path, import.meta.url);

	if (!texts.has(url.href)) {
		texts.set(url.href, (async () => {
			if (isNode && url.protocol === 'file:') {
				const { readFile } = await import('node:fs/promises');
				return readFile(url, 'utf8');
			}

			const response = await fetch(url);
			if (!response.ok)
				throw new Error(`Cannot load ${url}: HTTP ${response.status}`);
			return response.text();
		})());
	}

	return texts.get(url.href);
}

export async function loadFixture(path) {
	return JSON.parse(await readText(path));
}
