import fs from 'node:fs';
import path from 'node:path';


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

function replayArg(arg, ctx) {
	if (arg?.log == null)
		return arg;

	if (arg.type === 'linearGradient') {
		const gradient = ctx.createLinearGradient(...arg.args);
		replay(arg.log, gradient);
		return gradient;
	}

	// if Path2D, build it
	const out = new Path2D();
	replay(arg.log, out);

	return out;
}

export function replay(cmds, ctx) {
	for (const [name, ...entries] of cmds) {
		// isProp?
		if (props.has(name)) {
			for (const value of entries)
				ctx[name] = replayArg(value, ctx);
		}
		else {
			for (const args of entries)
				ctx[name](...args.map(arg => replayArg(arg, ctx)));
		}
	}
}

function plotSpec({ width, height, ctxlog }) {
	return { width, height, ctxlog };
}

function escapeHtml(value) {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

export function writeFailureReport(failures, filename, title = 'Demo snapshot failures') {
	if (failures.length === 0)
		return;

	const entries = failures.map(({ title, expected, actual }) => ({
		title,
		expected: plotSpec(expected),
		actual: plotSpec(actual),
	}));
	// Prevent recorded text or failure titles from closing the inline script element.
	const data = JSON.stringify(entries).replaceAll('<', '\\u003c');
	const options = entries.map((entry, i) => `<option value="${i}">${escapeHtml(entry.title)}</option>`).join('\n');
	const safeTitle = escapeHtml(title);
	const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <title>${safeTitle}</title>
  <style>
    body { margin: 24px; color: #222; background: #fff; font: 14px system-ui, sans-serif; }
    button, select { margin-bottom: 16px; padding: 6px 12px; }
    select { max-width: 100%; }
    #comparison { position: relative; max-width: 100%; border: 1px solid #ccc; }
    canvas { position: absolute; top: 0; left: 0; display: block; max-width: 100%; height: auto; }
  </style>
</head>
<body>
  <h1>${safeTitle}</h1>
  <p>${entries.length} failed snapshot${entries.length === 1 ? '' : 's'}</p>
  <label for="failure">Failure:</label>
  <select id="failure">${options}</select>
  <button id="previous" type="button">Previous</button>
  <button id="next" type="button">Next</button>
  <h2 id="case-title"></h2>
  <p>Hover over the chart to show actual. Move away to show expected.</p>
  <p id="view-state" aria-live="polite">Showing expected</p>
  <div id="comparison">
    <canvas id="image" role="img" aria-label="Expected rendering"></canvas>
  </div>
  <script>
    const props = new Set(${JSON.stringify([...props])});
    ${replayArg.toString()}
    ${replay.toString()}

    const failures = ${data};
    const select = document.querySelector('#failure');
    const previous = document.querySelector('#previous');
    const next = document.querySelector('#next');
    const image = document.querySelector('#image');
    const comparison = document.querySelector('#comparison');
    const viewState = document.querySelector('#view-state');
    let selected = 0;
    let showingExpected = true;

    function draw() {
      const failure = failures[selected];
      const spec = showingExpected ? failure.expected : failure.actual;
      document.querySelector('#case-title').textContent = failure.title;
      // Reset the bitmap and context state before each replay.
      image.width = spec.width;
      image.height = spec.height;
      // Scale both recordings equally within the fixed comparison area.
      image.style.width = 100 * spec.width / Math.max(1, failure.expected.width, failure.actual.width) + '%';
      replay(spec.ctxlog, image.getContext('2d'));
      image.setAttribute('aria-label', showingExpected ? 'Expected rendering' : 'Actual rendering');
      viewState.textContent = showingExpected ? 'Showing expected' : 'Showing actual';
    }

    function showFailure(index) {
      if (index < 0 || index >= failures.length)
        return;

      selected = index;
      select.value = String(index);
      showingExpected = true;
      previous.disabled = index === 0;
      next.disabled = index === failures.length - 1;
      // Keep the hover target stable when the two recordings have different dimensions.
      const { expected, actual } = failures[index];
      const width = Math.max(1, expected.width, actual.width);
      const height = Math.max(1, expected.height, actual.height);
      comparison.style.width = width + 'px';
      comparison.style.aspectRatio = width + ' / ' + height;
      draw();
    }

    select.addEventListener('change', () => showFailure(Number(select.value)));
    previous.addEventListener('click', () => showFailure(selected - 1));
    next.addEventListener('click', () => showFailure(selected + 1));

    comparison.addEventListener('mouseenter', () => {
      showingExpected = false;
      draw();
    });
    comparison.addEventListener('mouseleave', () => {
      showingExpected = true;
      draw();
    });

    showFailure(0);
  </script>
</body>
</html>
`;

	fs.mkdirSync(path.dirname(filename), { recursive: true });
	fs.writeFileSync(filename, html);
}