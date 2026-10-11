import uPlot from '../src/uPlot.js';
import { barChartPlugin } from './lib/barChartPlugin.js';
import { createBarControls } from './lib/barControls.js';
import { withBarTotals } from './lib/barTotals.js';

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
	const params = new URL(window.location.href).searchParams;
	let seed = params.get('seed') ?? newSeed();
	const count = params.get('series');
	if (/^[1-5]$/.test(count))
		root.querySelector('#series-count').value = count;
	const colors = ['royalblue', 'darkorange', 'seagreen', 'orchid', 'crimson'];
	let copyStatus = root.querySelector('#copy-status');
	copyStatus = copyStatus.firstChild ?? copyStatus.appendChild(document.createTextNode(''));
	copyStatus.data = '';
	root.querySelector('#copy-link').addEventListener('click', copyLink);
	let bars;
	let u;
	let hasTotals = false;
	let totalsShown = [true, true];
	let controls = createBarControls(root, {
		getPlot: () => u,
		getControls: () => bars._controls,
		rebuild(size, resetData = false) {
			const { pxRatio } = u;
			const data = resetData ? newData() : rawData(u, hasTotals);
			if (resetData)
				copyStatus.data = '';
			const shown = componentVisibility(u, hasTotals);
			if (hasTotals)
				totalsShown = u.series.slice(1, 3).map(series => series.show);
			u.destroy();
			u = createPlot(data, size, pxRatio, shown);
		},
		regenerate() {
			seed = newSeed();
			copyStatus.data = '';
			const data = newData();
			u.setData(hasTotals ? withBarTotals(data, componentVisibility(u, hasTotals)) : data);
		},
	});

	async function copyLink() {
		const copiedSeed = seed;
		const copiedCount = controls.seriesCount();
		const url = new URL(window.location.href);
		url.searchParams.set('seed', copiedSeed);
		if (copiedCount == 2)
			url.searchParams.delete('series');
		else
			url.searchParams.set('series', copiedCount);
		try {
			await window.navigator.clipboard.writeText(url.href);
			if (root && seed == copiedSeed && controls.seriesCount() == copiedCount)
				copyStatus.data = 'Link copied.';
		}
		catch {
			if (root && seed == copiedSeed && controls.seriesCount() == copiedCount) {
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
		return [names, ...Array.from({ length: controls.seriesCount() }, () => names.map(() => offset + spread * random()))];
	}

	function rawData(plot, totals) {
		return totals ? [plot.data[0], ...plot.data.slice(3)] : plot.data;
	}

	function componentVisibility(plot, totals) {
		return [plot.series[0].show, ...plot.series.slice(totals ? 3 : 1).map(series => series.show)];
	}

	function createPlot(data, size, pxRatio, shown) {
		const mode = controls.stacking();
		const percent = mode == 'percent';
		const totals = hasTotals = controls.totals();
		let visible = data.map((_, i) => shown?.[i] ?? true);
		const components = data.slice(1).map((_, i) => i + 1);
		const series = [
			{ label: 'Item' },
			...components.map(si => ({
				label: si == 1 ? 'Value' : si == 2 ? 'Other value' : `Value ${si}`,
				fill: colors[si - 1],
			})),
		].map((series, i) => ({ ...series, show: visible[i] }));
		if (totals) {
			data = withBarTotals(data, visible);
			series.splice(1, 0,
				{ label: 'Positive total', fill: 'lightgray', show: totalsShown[0] },
				{ label: 'Negative total', fill: 'silver', show: totalsShown[1] },
			);
		}
		bars = barChartPlugin({ ...controls.options(), groupSeries: totals ? [1, 2] : [] });
		return new uPlot({
			...size,
			pxRatio,
			stack: mode == 'grouped' ? undefined : { groups: [{ series: components, dir: 0 }], percent },
			...(percent ? {
				scales: { y: { range: (u, min, max) => min < 0 ? [-1, max > 0 ? 1 : 0] : [0, 1] } },
				axes: [{}, { values: (u, splits) => splits.map(value => `${Math.round(value * 100)}%`) }],
			} : {}),
			series,
			legend: { mount: (u, table) => root.querySelector('#chart-legend').appendChild(table) },
			plugins: [bars],
			hooks: {
				draw: [controls.readout],
				setSeries: [(plot, i, opts) => {
					if (plot !== u || !totals || opts.show == null || (i != null && i < 3))
						return;
					const next = componentVisibility(plot, totals);
					if (next.every((show, si) => show == visible[si]))
						return;
					visible = next;
					// setSeries has already queued autoscale; replace totals before it runs.
					plot.setData(withBarTotals(rawData(plot, totals), visible), false);
				}],
			},
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
