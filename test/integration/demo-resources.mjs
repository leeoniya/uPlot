import {describe, it, beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import '../../scripts/instrument.mjs';
import uPlot from '../../src/uPlot.js';
import { loadFixture } from '../../demos/demoResources.js';
import barsGroups from '../../demos/multi-bars.js';
import timezoneGroups from '../../demos/timezones-dst.js';

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
		const html = await readFile(new URL('../../demos/timezones-dst.html', import.meta.url), 'utf8');
		const wrapper = document.createElement('div');
		wrapper.innerHTML = html.match(/<style\b[^]*?<\/style>/)[0] + html.match(/<section\b[^]*?<\/section>/g).join('');
		document.body.appendChild(wrapper);
		try {
			const sections = [...wrapper.querySelectorAll('section')];
			assert.equal(sections.length, 17, 'include all 11 original and 6 calendar sections');
			assert.equal(timezoneGroups.length, sections.length, 'each demo group has a section');
			for (let i = 0; i < timezoneGroups.length; i++) {
				const group = timezoneGroups[i];
				const heading = sections[i].querySelector('h3');
				assert.ok(heading?.textContent.trim(), 'section ' + i + ' has a heading');
				if (group.id != null)
					assert.equal(sections[i].id, group.id, 'stable group ID matches its section');
				for (const step of group.steps) {
					const plots = await step.render();
					try {
						assert.equal(plots.length, 1, sections[i].id + ': each step returns one chart');
						assert.equal(plots[0].root.parentElement, sections[i], sections[i].id + ': mount inside the section');
						assert.equal(sections[i].firstElementChild, heading);
						if (group.id != null) {
							const note = plots[0].root.querySelector('.dst-note');
							const style = window.getComputedStyle(note);
							assert.equal(style.gridColumn, '2', 'notes share the plot column rather than widen the side columns');
							assert.equal(style.gridRow, '-1', 'notes follow the explicit chart rows');
						}
					}
					finally {
						for (const plot of plots)
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
