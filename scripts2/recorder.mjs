import fs from 'fs';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import stringify from "json-stringify-pretty-compact";

import './instrument.mjs';
import { withSeededRandom } from './withSeededRandom.mjs';

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

// from glob
const demos = ['axis-control', 'area-fill', 'missing-data', 'line-paths', 'path-gap-clip', 'thin-bars-stroke-fill', 'high-low-bands', 'custom-scales', 'decimation'];

for (const name of demos) {
  await describe(name, async (t) => {
    const { default: groups } = await import(`../demos/${name}.js`);

    let ig = 0;

    for (const g of groups) {
      let is = 0;

      for (const s of g.steps) {
        let filename = `${name}-${ig}-${is}.json`;

        await it(filename, async () => {
          await withSeededRandom(async () => {
            const plots = await s.render();

            const u = plots[0];

            let out = {
              html: u.root.outerHTML,
              width: u.ctx.width,
              height: u.ctx.height,
              ctxlog: u.ctx.log,
            };

            // fs.writeFileSync(filename, stringify(out, { indent: 2, maxLength: 160 }));

            const result = JSON.parse(fs.readFileSync(filename, 'utf8'));
            assert.deepStrictEqual(out, result);

            u.destroy();
          });
        });

        is++;
      }

      ig++;
    }
  });
}
