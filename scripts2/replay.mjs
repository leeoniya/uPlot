import fs from 'fs';
import { CanvasRenderingContext2D, createCanvas, loadImage } from 'canvas';
import { applyPath2DToCanvasRenderingContext, Path2D } from "path2d";

applyPath2DToCanvasRenderingContext(CanvasRenderingContext2D);

// global.Path2D = Path2D;

console.time('replay');

const spec = JSON.parse(fs.readFileSync('./area-fill-0-0.json', 'utf8'));

// console.dir(spec, {depth: 100});

const can = createCanvas(spec.width, spec.height);
const ctx = can.getContext('2d');

const set = new Set(['strokeStyle', 'fillStyle', 'lineWidth', 'font', 'textAlign', 'textBaseline', 'lineJoin', 'lineCap']);

function draw(cmds, ctx) {
  for (let i = 0; i < cmds.length; i++) {
    let batch = cmds[i];
    let name = batch[0];

    // isProp?
    if (set.has(name))
      ctx[name] = batch[1];
    else {
      for (let i = 1; i < batch.length; i++) {
        let args = batch[i];

        // if Path2D, build it
        if (args[0]?.log != null) {
          let p = new Path2D();
          draw(args[0]?.log, p);
          args = [p];
        }

        ctx[name](...args);
      }
    }
  }
}

console.time('draw');
draw(spec.ctxlog, ctx);
console.timeEnd('draw');

const out = fs.createWriteStream('./image3.png');
const stream = can.createPNGStream();
stream.pipe(out);
out.on('finish', () => {
  console.timeEnd('replay');
});