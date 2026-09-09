import fs from 'fs';
import path from 'node:path';

import assert from 'node:assert/strict';

import stringify from "json-stringify-pretty-compact";

import './instrument.mjs';
import { withSeededRandom } from './withSeededRandom.mjs';
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

if (process.env.UPDATE != null && !update)
  throw new Error('UPDATE must be "1" when set.');

if (!update)
  fs.rmSync(outputDir, { recursive: true, force: true });

for (const name of demos) {
  const { default: groups } = await import(`../demos/${name}.js`);

  describe(name, () => {
    const dir = path.resolve('test/demos', name);

    groups.forEach((group, groupIdx) => {
      group.steps.forEach((step, stepIdx) => {
        const id = `${groupIdx}-${stepIdx}`;
        const filename = path.join(dir, `${id}.json`);

        it(id, async () => {
          await withSeededRandom(async () => {
            const plots = await step.render();

            const u = plots[0];

            const actual = {
              html: u.root.outerHTML,
              width: u.ctx.width,
              height: u.ctx.height,
              ctxlog: u.ctx.log,
            };

            try {
              if (update) {
                fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(filename, stringify(actual, { indent: 2, maxLength: 160 }) + '\n');
              }
              else {
                const expected = JSON.parse(fs.readFileSync(filename, 'utf8'));

                try {
                  assert.deepStrictEqual(actual, expected);
                }
                catch (error) {
                  const { writeFailureReport } = await import('./replay.mjs');
                  const report = path.join(outputDir, name, `${id}.html`);

                  writeFailureReport(expected, actual, report, `${name} ${id}`);
                  error.message += `\nVisual comparison: ${path.relative('.', report)}`;

                  throw error;
                }
              }
            }
            finally {
              for (const plot of plots)
                plot.destroy();
            }
          });
        });
      });
    });
  });
}
