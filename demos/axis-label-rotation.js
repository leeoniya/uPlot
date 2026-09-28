import uPlot from '../src/uPlot.js';
import { barChartPlugin } from './lib/barChartPlugin.js';
import { createBarControls } from './lib/barControls.js';

function seededRandom(seed) {
	let state = 2166136261;
	for (let i = 0; i < seed.length; i++)
		state = Math.imul(state ^ seed.charCodeAt(i), 16777619);

	// Mulberry32 keeps each dataset independent of other calls to Math.random().
	return () => {
		state = (state + 0x6D2B79F5) | 0;
		let t = Math.imul(state ^ state >>> 15, 1 | state);
		t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
		return ((t ^ t >>> 14) >>> 0) / 4294967296;
	};
}

export function createDemo(root) {
	const adjectives = ['Tiny', 'Bright', 'Quiet', 'Swift', 'Gentle', 'Bold', 'Silver', 'Merry'];
	const nouns = ['fox', 'owl', 'panda', 'otter', 'tiger', 'robin', 'badger', 'raven'];
	const verbs = ['runs', 'jumps', 'sings', 'rests', 'dances', 'glides', 'swims', 'plays'];
	const newSeed = () => Math.floor(Math.random() * 4294967296).toString(36);
	let seed = new URL(window.location.href).searchParams.get('seed') ?? newSeed();
	let copyStatus = root.querySelector('#copy-status');
	copyStatus = copyStatus.firstChild ?? copyStatus.appendChild(document.createTextNode(''));
	copyStatus.data = '';
	root.querySelector('#copy-link').addEventListener('click', copyLink);
	let bars;
	let u;
	let controls = createBarControls(root, {
		getPlot: () => u,
		getControls: () => bars._controls,
		rebuild(size) {
			const { data, pxRatio } = u;
			const shown = u.series.map(series => series.show);
			u.destroy();
			u = createPlot(data, size, pxRatio, shown);
		},
		regenerate() {
			seed = newSeed();
			copyStatus.data = '';
			u.setData(newData());
		},
	});

	async function copyLink() {
		const copiedSeed = seed;
		const url = new URL(window.location.href);
		url.searchParams.set('seed', copiedSeed);
		try {
			await window.navigator.clipboard.writeText(url.href);
			if (root && seed == copiedSeed)
				copyStatus.data = 'Link copied.';
		}
		catch {
			if (root && seed == copiedSeed) {
				copyStatus.data = 'Clipboard unavailable. Copy the URL from the dialog.';
				window.prompt('Copy this URL:', url.href);
			}
		}
	}

	function newData() {
		const random = seededRandom(seed);
		const pick = words => words[Math.floor(random() * words.length)];
		const names = Array.from({ length: 3 + Math.floor(random() * 13) }, () => {
			const count = 1 + Math.floor(random() * 3);
			const words = count == 1 ? [pick(nouns)] : [pick(adjectives), pick(nouns)];
			if (count == 3)
				words.push(pick(verbs));
			return words.join(' ');
		});
		const magnitude = 10 ** (Math.floor(random() * 13) - 5);
		const offset = magnitude * (random() * 2 - 1);
		const spread = magnitude * (.5 + random() * 1.5);
		return [names, names.map(() => offset + spread * random()), names.map(() => offset + spread * random())];
	}

	function createPlot(data, size, pxRatio, shown) {
		const mode = controls.stacking();
		const percent = mode == 'percent';
		bars = barChartPlugin(controls.options());
		return new uPlot({
			...size,
			pxRatio,
			stack: mode == 'grouped' ? undefined : { groups: [{ series: [1, 2], dir: 0 }], percent },
			...(percent ? {
				scales: { y: { range: (u, min, max) => min < 0 ? [-1, max > 0 ? 1 : 0] : [0, 1] } },
				axes: [{}, { values: (u, splits) => splits.map(value => `${Math.round(value * 100)}%`) }],
			} : {}),
			series: [
				{ label: 'Item' },
				{ label: 'Value', fill: 'royalblue' },
				{ label: 'Other value', fill: 'darkorange' },
			].map((series, i) => ({ ...series, show: shown?.[i] ?? true })),
			plugins: [bars],
			hooks: { draw: [controls.readout] },
		}, data, root.querySelector('#plot'));
	}

	u = createPlot(newData(), controls.initialSize());

	return {
		get plot() { return u; },
		destroy() {
			controls?.destroy();
			root?.querySelector('#copy-link').removeEventListener('click', copyLink);
			u?.destroy();
			u = bars = controls = copyStatus = root = null;
		},
	};
}
