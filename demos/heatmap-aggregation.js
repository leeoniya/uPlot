import uPlot from '../src/uPlot.js';
import { heatmapPlugin } from './lib/heatmapPlugin.js';
import { aggregateHeatmap } from './lib/heatmapAggregation.js';
import { bindBucketControls } from './lib/heatmapBucketControls.js';
import { generatePoints } from './lib/heatmapSamples.js';

const $ = id => document.getElementById(id);
const samplers = $('samplers'), nxInput = $('nx'), nyInput = $('ny');
const host = $('plot'), hover = $('hover'), status = $('status');
const colors = ['#b6e4db', '#8dd3c7', '#62bfbd', '#3ba6b3', '#25889f', '#1e6b89', '#195273', '#163858', '#102440'];
const colorRamp = $('color-ramp'), colorMax = $('color-max');
let selected = samplers.querySelector('[aria-pressed="true"]');
let points, seed, resampleMs, xStep;

const hint = 'Hover a cell to inspect its bounds and count.';
const fmt = v => Number(v.toPrecision(5));
hover.textContent = hint;
const heatmap = heatmapPlugin({
	fields: ['xMax', 'yMin', 'yMax', 'count'],
	colors, colorScale: 'sqrt', colorDomain: [0, null],
	onColorScale({max, stops}) {
		colorMax.textContent = max.toLocaleString();
		colorRamp.style.background = `linear-gradient(to right, ${stops.map(([offset, color]) => `${color} ${offset * 100}%`).join(', ')})`;
	},
	onHover(u, i) {
		if (i == null) {
			hover.textContent = hint;
			return;
		}
		const [xs, lo, hi, counts] = u.data[1];
		hover.textContent = `X: ${fmt(xs[i] - xStep)} to ${fmt(xs[i])} · Y: ${fmt(lo[i])} to ${fmt(hi[i])} · Count: ${counts[i]}`;
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
	series: [{}, {label: 'Count'}],
	plugins: [heatmap],
}, null, host);

function run(button) {
	const nx = nxInput.valueAsNumber, ny = nyInput.valueAsNumber;
	try {
		if (button) {
			let nextSeed;
			do { nextSeed = Math.floor(Math.random() * 2 ** 32); } while (nextSeed === seed);
			const start = performance.now();
			points = generatePoints(button.value, 250_000, nextSeed);
			resampleMs = performance.now() - start;
			seed = nextSeed;
			selected.setAttribute('aria-pressed', 'false');
			selected = button;
			selected.setAttribute('aria-pressed', 'true');
		}
		const start = performance.now();
		const result = aggregateHeatmap(...points, nx, ny);
		const aggregateMs = performance.now() - start;
		const occupied = result.data[1][3].length;
		xStep = result.grid.x.step;
		heatmap.setFrame(result);
		status.textContent = `${selected.textContent} · ${nx} × ${ny} buckets · ${occupied.toLocaleString()} occupied (${(100 * occupied / (nx * ny)).toFixed(2)}%) · seed ${seed}` +
					` · last resample: ${resampleMs.toFixed(2)} ms · aggregation: ${aggregateMs.toFixed(2)} ms`;
	}
	catch (error) {
		status.textContent = `Cannot draw heatmap: ${error.message}`;
		console.error(error);
	}
}

for (const button of samplers.querySelectorAll('button'))
	button.addEventListener('click', () => run(button));
bindBucketControls($('grid'), run);
window.addEventListener('resize', () => plot.setSize(plotSize()));
run(selected);
