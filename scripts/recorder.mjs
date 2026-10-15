import fs from 'fs';
import path from 'node:path';

import assert from 'node:assert/strict';

import stringify from "json-stringify-pretty-compact";

import './instrument.mjs';
import { withSeededRandom } from './withSeededRandom.mjs';
import { getDemoSteps, captureStep } from './demoSteps.mjs';
import demos from '../test/demos.mjs';

// console.time('import uPlot');
const { default: uPlot } = await import('../src/uPlot.js');
// console.timeEnd('import uPlot');

global.uPlot = uPlot;

// todo: other setters
// todo: canvas width/height setters
// todo: dom ops
// uplot hooks
// css
// cursor
// dppx
// sync

// await new Promise(r => setTimeout(r, 2000));
// console.log('go!');

const update = process.env.UPDATE === '1';
const outputDir = path.resolve('test/output');
const report = path.join(outputDir, 'index.html');
const failures = [];

if (process.env.UPDATE != null && !update)
	throw new Error('UPDATE must be "1" when set.');

if (!update)
	fs.rmSync(outputDir, { recursive: true, force: true });

after(async () => {
	if (failures.length > 0) {
		const { writeFailureReport } = await import('./replay.mjs');
		writeFailureReport(failures, report);
		console.log(`Visual comparisons: ${path.relative('.', report)} (${failures.length} failed snapshots)`);
	}
});

for (const name of demos) {
	const { default: groups } = await import(`../demos/${name}.js`);
	const steps = getDemoSteps(groups);

	describe(name, () => {
		const dir = path.resolve('test/demos', name);

		for (const { id, step } of steps) {
			it(id, async () => {
				let firstError;

				await withSeededRandom(() => captureStep(step, id, async (actual, snapshotId) => {
					const filename = path.join(dir, `${snapshotId}.json`);
					if (update) {
						fs.mkdirSync(path.dirname(filename), { recursive: true });
						fs.writeFileSync(filename, stringify(actual, { indent: 2, maxLength: 160 }) + '\n');
					}
					else {
						const expected = JSON.parse(fs.readFileSync(filename, 'utf8'));

						try {
							assert.deepStrictEqual(actual, expected);
						}
						catch (error) {
							// Preserve the recording before plot cleanup or later steps can change it.
							failures.push({ title: `${name} ${snapshotId}`, expected, actual: JSON.parse(JSON.stringify(actual)) });
							error.message += `\nVisual comparisons: ${path.relative('.', report)}`;
							firstError ??= error;
						}
					}
				}));

				if (firstError)
					throw firstError;
			});
		}
	});
}
