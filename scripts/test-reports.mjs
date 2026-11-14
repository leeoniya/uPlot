import fs from 'node:fs';
import path from 'node:path';
import { writeFailureReport } from './replay.mjs';

export function mergeSnapshotReports(directory, filename) {
	const files = fs.readdirSync(directory, { withFileTypes: true })
		.filter(entry => entry.isFile() && entry.name.endsWith('.json'))
		.map(entry => entry.name)
		.sort();
	const failures = files.flatMap(file => JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8')));

	if (failures.length > 0) {
		writeFailureReport(failures, filename);
		console.log(`Visual comparisons: ${path.relative('.', filename)} (${failures.length} failed snapshots)`);
	}

	return failures.length;
}
