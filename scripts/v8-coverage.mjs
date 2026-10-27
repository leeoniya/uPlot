import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeScriptCovs } from '@bcoe/v8-coverage';
import coverage from 'istanbul-lib-coverage';
import v8ToIstanbul from 'v8-to-istanbul';
import { coverageFiles } from './coverage-files.mjs';

function filenameFor(url) {
	if (url.startsWith('file:'))
		return fileURLToPath(url);
	return isAbsolute(url) ? url : null;
}

export async function convertV8Coverage(rawDir, config) {
	const selection = coverageFiles(config);
	const files = readdirSync(rawDir).filter(name => name.endsWith('.json')).sort();
	if (files.length === 0)
		throw new Error('No V8 coverage files found in ' + rawDir);

	const groups = new Map();
	for (const name of files) {
		const raw = JSON.parse(readFileSync(resolve(rawDir, name), 'utf8'));
		if (!Array.isArray(raw?.result))
			throw new Error('Invalid V8 coverage result in ' + name);

		for (const script of raw.result) {
			if (typeof script?.url !== 'string')
				throw new Error('Invalid V8 script in ' + name);
			const filename = filenameFor(script.url);
			if (filename == null || !selection.shouldInstrument(filename))
				continue;

			if (!Array.isArray(script.functions) || script.functions.some(fn =>
				!Array.isArray(fn?.ranges) || fn.ranges.length === 0 || fn.ranges.some(range =>
					!Number.isInteger(range.startOffset) || !Number.isInteger(range.endOffset) ||
					range.startOffset < 0 || range.endOffset < range.startOffset ||
					!Number.isFinite(range.count) || range.count < 0)))
				throw new Error('Invalid V8 function ranges for ' + filename + ' in ' + name);

			const cached = raw['source-map-cache']?.[script.url];
			const sourceMap = cached?.data == null ? null : { data: cached.data, lineLengths: cached.lineLengths };
			// Different loader transforms can use the same filename with different offsets.
			const key = JSON.stringify([filename, sourceMap]);
			let group = groups.get(key);
			if (group == null) {
				group = { filename, sourceMap, scripts: [] };
				groups.set(key, group);
			}
			group.scripts.push({ ...script, url: filename });
		}
	}

	const map = coverage.createCoverageMap({});
	for (const { filename, sourceMap, scripts } of groups.values()) {
		const sources = {};
		if (sourceMap != null) {
			sources.sourceMap = { sourcemap: sourceMap.data };
			// Only generated line lengths are needed to map offsets to source locations.
			if (sourceMap.lineLengths != null)
				sources.source = sourceMap.lineLengths.map(length => '.'.repeat(length) + '\n').join('');
		}
		const converter = v8ToIstanbul(filename, 0, sources);
		try {
			await converter.load();
			// Missing child ranges inherit their parent's count. Merge before conversion.
			converter.applyCoverage(mergeScriptCovs(scripts).functions);
			// Multi-source maps can use file URLs or relative paths internally.
			// Apply exclusions only after the converter resolves the final filenames.
			for (const [path, file] of Object.entries(converter.toIstanbul())) {
				if (selection.shouldInstrument(path))
					map.addFileCoverage(file);
			}
		}
		catch (error) {
			throw new Error('Cannot convert V8 coverage for ' + filename, { cause: error });
		}
	}
	return map;
}

if (process.argv[1] != null && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const [rawDir, outputDir] = process.argv.slice(2);
	if (rawDir == null || outputDir == null)
		throw new Error('Usage: node scripts/v8-coverage.mjs <raw-directory> <output-directory>');
	const cwd = fileURLToPath(new URL('../', import.meta.url));
	const config = process.env.NYC_CONFIG == null
		? { ...JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).nyc, cwd }
		: JSON.parse(process.env.NYC_CONFIG);
	const map = await convertV8Coverage(rawDir, config);
	mkdirSync(outputDir, { recursive: true });
	writeFileSync(resolve(outputDir, 'coverage.json'), JSON.stringify(map.toJSON()));
}
