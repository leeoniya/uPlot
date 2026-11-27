import uPlot from '../src/uPlot.js';
import { heatmapPlugin } from './lib/heatmapPlugin.js';
import { aggregateHeatmap, getSampleBounds } from './lib/heatmapAggregation.js';
import { bindBucketControls } from './lib/heatmapBucketControls.js';
import { generatePoints } from './lib/heatmapSamples.js';

const $ = id => document.getElementById(id);
const samplers = $('samplers'), sampleInput = $('samples'), nxInput = $('nx'), nyInput = $('ny');
const host = $('plot'), status = $('status');
const colors = ['#b6e4db', '#8dd3c7', '#62bfbd', '#3ba6b3', '#25889f', '#1e6b89', '#195273', '#163858', '#102440'];
const colorRamp = $('color-ramp'), colorScale = $('color-scale');
const colorMin = $('color-min'), colorMax = $('color-max');
let selected = samplers.querySelector('[aria-pressed="true"]');
let points, bounds, seed, xStep;

const fmt = v => Number(v.toPrecision(5));
const heatmap = heatmapPlugin({
	fields: ['xMax', 'yMin', 'yMax', 'count'],
	colors, colorScale: () => colorScale.value,
	onColorScale({min, max, stops}) {
		colorMin.textContent = min.toLocaleString();
		colorMax.textContent = max.toLocaleString();
		colorRamp.style.background = `linear-gradient(to right, ${stops.map(([offset, color]) => `${color} ${offset * 100}%`).join(', ')})`;
	},

});

function plotSize() {
	const width = host.clientWidth;
	return {width, height: Math.min(width, 560)};
}

const plot = new uPlot({
	mode: 2, ...plotSize(), legend: {show: false},
	scales: {x: {time: false, axis: 0}, y: {axis: 1}},
	axes: [{dom: false}, {dom: false}],
	tooltip: {
		show: true, transpose: true, markers: {show: false},
		filter: (u, si) => u.tooltip.idxs[si] != null,
	},
	series: [{}, {
		label: 'Cell',
		values(u, si, i) {
			// The tooltip requests its field names before the first frame is installed.
			if (u.data == null || i == null) return {X: '', Y: '', Count: ''};
			const [xs, lo, hi, counts] = u.data[si];
			return {X: `${fmt(xs[i] - xStep)} to ${fmt(xs[i])}`, Y: `${fmt(lo[i])} to ${fmt(hi[i])}`, Count: counts[i]};
		},
	}],
	plugins: [heatmap],
}, null, host);

function run(button) {
	const nx = nxInput.valueAsNumber, ny = nyInput.valueAsNumber;
	try {
		const count = sampleInput.valueAsNumber;
		if (button || count !== points[0].length) {
			let nextSeed = seed;
			if (button) {
				do { nextSeed = Math.floor(Math.random() * 2 ** 32); } while (nextSeed === seed);
			}
			const start = performance.now();
			points = generatePoints((button ?? selected).value, count, nextSeed);
			bounds = getSampleBounds(...points);
			const resampleMs = performance.now() - start;
			$('last-resample').textContent = `last resample: ${resampleMs.toFixed(2)} ms`;
			seed = nextSeed;
			if (button && button !== selected) {
				selected.setAttribute('aria-pressed', 'false');
				selected = button;
				selected.setAttribute('aria-pressed', 'true');
			}
		}
		const start = performance.now();
		const result = aggregateHeatmap(...points, nx, ny, bounds);
		const aggregateMs = performance.now() - start;
		const occupied = result.data[1][3].length;
		xStep = result.grid.x.step;
		heatmap.setFrame(result);
		status.textContent = `${occupied.toLocaleString()} occupied (${(100 * occupied / (nx * ny)).toFixed(2)}%)` +
			` · aggregation: ${aggregateMs.toFixed(2)} ms`;
	}
	catch (error) {
		status.textContent = `Cannot draw heatmap: ${error.message}`;
		console.error(error);
	}
}

for (const button of samplers.querySelectorAll('button'))
	button.addEventListener('click', () => run(button));
bindBucketControls($('grid'), run);
colorScale.addEventListener('change', () => plot.redraw(false, false));
window.addEventListener('resize', () => plot.setSize(plotSize()));
run(selected);
