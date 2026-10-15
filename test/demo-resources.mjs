import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';
import { loadFixture } from '../demos/demoResources.js';
import barsGroups from '../demos/multi-bars.js';
import timezoneGroups from '../demos/timezones-dst.js';

describe('demo resources and containers', () => {
	let previous;

	beforeEach(() => {
		previous = globalThis.uPlot;
		globalThis.uPlot = uPlot;
	});

	afterEach(() => {
		globalThis.uPlot = previous;
	});

	it('returns fresh fixture data after callers mutate a previous load', async () => {
		const first = await loadFixture('../bench/results.json');
		const original = structuredClone(first);
		first[0][0] = 'changed';
		first.pop();
		assert.deepStrictEqual(await loadFixture('../bench/results.json'), original);
	});

	it('retains the benchmark library toggle controls', async () => {
		const [plot] = await barsGroups[0].steps[2].render();
		try {
			const button = plot.root.querySelector('.lib-toggles button');
			const count = plot.data[0].length;
			assert.ok(button);
			button.click();
			await Promise.resolve();
			assert.equal(plot.data[0].length, count - 1);
			assert.equal(button.classList.contains('hidden'), true);
			button.click();
			await Promise.resolve();
			assert.equal(plot.data[0].length, count);
			assert.equal(button.classList.contains('hidden'), false);
		}
		finally {
			plot.destroy();
		}
	});

	it('mounts timezone groups in their original section containers', async () => {
		const html = await readFile(new URL('../demos/timezones-dst.html', import.meta.url), 'utf8');
		const wrapper = document.createElement('div');
		wrapper.innerHTML = html.match(/<section\b[^]*?<\/section>/g).join('');
		document.body.appendChild(wrapper);
		try {
			const sections = [...wrapper.querySelectorAll('section')];
			assert.equal(sections.length, 11);
			assert.equal(timezoneGroups.length, sections.length);
			for (let i = 0; i < timezoneGroups.length; i++) {
				const heading = sections[i].querySelector('h3');
				assert.ok(heading.textContent.length > 0);
				for (const step of timezoneGroups[i].steps) {
					const [plot] = await step.render();
					try {
						assert.equal(plot.root.parentElement, sections[i]);
						assert.equal(sections[i].firstElementChild, heading);
					}
					finally {
						plot.destroy();
					}
				}
			}
		}
		finally {
			wrapper.remove();
		}
	});
});
