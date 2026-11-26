// A data: URL has no directory. Resolve the plugin's static imports against its source file.
const pluginUrl = new URL('../demos/lib/heatmapPlugin.js', import.meta.url);
export function heatmapModuleUrl(source) {
	const text = source.replace(/\bfrom\s+(['"])(\.\/[^'"]+)\1/g, (_, quote, path) =>
		`from ${JSON.stringify(new URL(path, pluginUrl).href)}`);
	return `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`;
}
