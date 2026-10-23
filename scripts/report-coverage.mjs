import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import coverage from 'istanbul-lib-coverage';
import report from 'istanbul-lib-report';
import SmartTextReport from 'istanbul-smart-text-reporter';

const tempDir = resolve(process.argv[2] ?? '.nyc_output');
const coverageMap = coverage.createCoverageMap({});

function mergeDirectory(dir) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = resolve(dir, entry.name);

		if (entry.isDirectory())
			mergeDirectory(path);
		else if (entry.name.endsWith('.json'))
			coverageMap.merge(JSON.parse(readFileSync(path, 'utf8')));
	}
}

mergeDirectory(tempDir);

const core = coverage.createCoverageMap({});
const plugins = coverage.createCoverageMap({});

for (const filename of coverageMap.files()) {
	const path = relative(process.cwd(), filename).split(sep).join('/');
	const group = path.startsWith('demos/lib/') ? plugins : core;
	group.addFileCoverage(coverageMap.fileCoverageFor(filename));
}

for (const [title, map] of [['uPlot core', core], ['Plugins', plugins]]) {
	if (map.files().length === 0)
		continue;

	console.log('\n' + title);
	new SmartTextReport().execute(report.createContext({
		dir: process.cwd(),
		coverageMap: map,
	}));
}
