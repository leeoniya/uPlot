import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import coverage from 'istanbul-lib-coverage';
import report from 'istanbul-lib-report';
import reports from 'istanbul-reports';

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

const context = report.createContext({
	dir: process.cwd(),
	coverageMap,
});

reports.create('text').execute(context);
