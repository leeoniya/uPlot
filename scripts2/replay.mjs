import fs from 'node:fs';
import path from 'node:path';

import { CanvasRenderingContext2D, createCanvas } from 'canvas';
import { applyPath2DToCanvasRenderingContext, Path2D } from "path2d";

applyPath2DToCanvasRenderingContext(CanvasRenderingContext2D);

const props = new Set([
  'strokeStyle',
  'fillStyle',
  'lineWidth',
  'font',
  'textAlign',
  'textBaseline',
  'lineJoin',
  'lineCap',
]);

function replayArg(arg) {
  if (arg?.log == null)
    return arg;

  const out = new Path2D();
  replay(arg.log, out);

  return out;
}

export function replay(cmds, ctx) {
  for (const [name, ...entries] of cmds) {
    if (props.has(name)) {
      for (const value of entries)
        ctx[name] = value;
    }
    else {
      for (const args of entries)
        ctx[name](...args.map(replayArg));
    }
  }
}

export function renderPng(spec) {
  const canvas = createCanvas(spec.width, spec.height);
  const ctx = canvas.getContext('2d');

  replay(spec.ctxlog, ctx);

  return canvas.toBuffer('image/png');
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function writeFailureReport(expected, actual, filename, title) {
  const expectedSrc = `data:image/png;base64,${renderPng(expected).toString('base64')}`;
  const actualSrc = `data:image/png;base64,${renderPng(actual).toString('base64')}`;
  const safeTitle = escapeHtml(title);
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <title>${safeTitle}</title>
  <style>
    body { margin: 24px; color: #222; background: #fff; font: 14px system-ui, sans-serif; }
    button { margin-bottom: 16px; padding: 6px 12px; }
    img { display: block; max-width: 100%; border: 1px solid #ccc; }
  </style>
</head>
<body>
  <h1>${safeTitle}</h1>
  <button id="toggle" type="button">Showing expected; show actual</button>
  <img id="image" src="${expectedSrc}" alt="Expected rendering">
  <script>
    const expected = ${JSON.stringify(expectedSrc)};
    const actual = ${JSON.stringify(actualSrc)};
    const image = document.querySelector('#image');
    const toggle = document.querySelector('#toggle');
    let showingExpected = true;

    toggle.addEventListener('click', () => {
      showingExpected = !showingExpected;
      image.src = showingExpected ? expected : actual;
      image.alt = showingExpected ? 'Expected rendering' : 'Actual rendering';
      toggle.textContent = showingExpected
        ? 'Showing expected; show actual'
        : 'Showing actual; show expected';
    });
  </script>
</body>
</html>
`;

  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, html);
}