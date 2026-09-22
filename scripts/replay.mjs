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
	'globalAlpha',
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
		if (name === 'canvas.width' || name === 'canvas.height') {
			for (const value of entries)
				ctx.canvas[name.slice(7)] = value;
		}
		else if (props.has(name)) {
			for (const value of entries)
				ctx[name] = replayArg(value, ctx);
		}
		else {
			for (const args of entries)
				ctx[name](...args.map(arg => replayArg(arg, ctx)));
		}
	}
}

function plotSpec({ html, width, height, ctxlog }) {
	return { html, width, height, ctxlog };
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
	const sections = entries.map(entry => `
  <section class="failure">
    <h2>${escapeHtml(entry.title)}</h2>
    <p class="chart-title" hidden></p>
    <p class="view-state" aria-live="polite">Showing expected</p>
    <div class="comparison">
      <canvas role="img" aria-label="Expected rendering"></canvas>
    </div>
  </section>`).join('\n');
	const safeTitle = escapeHtml(title);
	const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <title>${safeTitle}</title>
  <style>
    body { margin: 24px; color: #222; background: #fff; font: 14px system-ui, sans-serif; }
    .failure { margin-bottom: 32px; }
    .chart-title { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 16px; }
    .comparison { position: relative; max-width: 100%; border: 1px solid #ccc; }
    canvas { position: absolute; top: 0; left: 0; display: block; max-width: 100%; height: auto; }
  </style>
</head>
<body>
  <h1>${safeTitle}</h1>
  <p>${entries.length} failed snapshot${entries.length === 1 ? '' : 's'}</p>
  ${sections}
  <script>
    const props = new Set(${JSON.stringify([...props])});
    ${replayArg.toString()}
    ${replay.toString()}

    const failures = ${data};
    document.querySelectorAll('.failure').forEach((section, index) => {
      const failure = failures[index];
      const image = section.querySelector('canvas');
      const comparison = section.querySelector('.comparison');
      const viewState = section.querySelector('.view-state');
      const chartTitle = section.querySelector('.chart-title');
      const titles = [failure.expected, failure.actual].map(spec => {
        // Parse in an inert template; never insert recorded HTML into the report.
        const template = document.createElement('template');
        template.innerHTML = spec.html || '';
        return template.content.querySelector('.u-title')?.textContent || '';
      });
      chartTitle.textContent = titles[0] === titles[1] ? titles[0] :
        'Expected: ' + (titles[0] || '(untitled)') + '\\nActual: ' + (titles[1] || '(untitled)');
      chartTitle.hidden = !titles[0] && !titles[1];
      let showingExpected = true;

      // Keep the hover target stable when the two recordings have different dimensions.
      const width = Math.max(1, failure.expected.width, failure.actual.width);
      const height = Math.max(1, failure.expected.height, failure.actual.height);
      comparison.style.width = width + 'px';
      comparison.style.aspectRatio = width + ' / ' + height;

      function draw() {
        const spec = showingExpected ? failure.expected : failure.actual;
        // Reset the bitmap and context state before each replay.
        image.width = spec.width;
        image.height = spec.height;
        // Scale both recordings equally within the fixed comparison area.
        image.style.width = 100 * spec.width / width + '%';
        replay(spec.ctxlog, image.getContext('2d'));
        image.setAttribute('aria-label', showingExpected ? 'Expected rendering' : 'Actual rendering');
        viewState.textContent = showingExpected ? 'Showing expected' : 'Showing actual';
      }

      comparison.addEventListener('mouseenter', () => {
        showingExpected = false;
        draw();
      });
      comparison.addEventListener('mouseleave', () => {
        showingExpected = true;
        draw();
      });

      draw();
    });
  </script>
</body>
</html>
`;

	fs.mkdirSync(path.dirname(filename), { recursive: true });
	fs.writeFileSync(filename, html);
}