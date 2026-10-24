import {libraryCases, echartsOptions, chartjsOptions, echartsSelected} from './decimation-libs.js';
import {groupedLibraries, minute} from './reduction-accuracy-grouped.js';
import {demoDependencies} from '../bench/demo-dependencies.mjs';
import {loadDependency} from '../bench/demo.mjs';

const width = 580, height = 250;
const green = '#008000', blue = '#0066cc';
const pointsOf = ([xs, ys]) => xs.map((x, i) => [x, ys[i]]);
const uniform = () => [Array.from({length: 10002}, (_, i) => i), Array(10002).fill(0)];
const isolated = uniform();
isolated[1][5005] = 100;
const pulse = uniform();
pulse[1].fill(100, 5005, 5011);
const gap = uniform();
gap[1].fill(40);
gap[1].fill(null, 5005, 5011);

export const accuracyCases = [
	...libraryCases.map(item => ({...item,
		// Define one shared millisecond-grid fixture. FusionTime's %Q parser
		// rejects fractional milliseconds; Date also has millisecond precision.
		data: [item.data[0].map(x => Math.round(x * minute) / minute), item.data[1]],
		detail: item.detail ?? [0, 100], ...({
		opposite: {label: 'Nearby opposite spikes', description: '+100 and −100 occur five samples apart. Averaging can cancel them. One selected point cannot retain both.'},
		sparse: {label: 'Nonuniform x spacing', description: '9,981 samples occupy the first 10% of the range. Count-based budgets can undersample the sparse region.'},
		adjacent: {label: 'Two upward spikes', description: 'Two +100 spikes occur 20 samples apart. A triangle-based selection can omit one even across different buckets.'},
	})[item.id]})),
	{id: 'isolated', label: 'Isolated spike', data: isolated, detail: [4980, 5060], description: 'One +100 sample interrupts a zero baseline. Averaging can attenuate it; first or last selection can omit it.'},
	{id: 'pulse', label: 'Short plateau', data: pulse, detail: [4980, 5060], description: 'Six consecutive +100 samples form a plateau. Retaining its maximum does not guarantee its width, shape, or area.'},
	{id: 'gap', label: 'Short missing interval', data: gap, detail: [4980, 5060], description: 'Six null samples interrupt a +40 signal. At DPR 1 this gap is narrower than one uPlot pixel column and can disappear after rounding. Gap marker counts do not prove rendered gap preservation.'},
];

export function summarizePoints(points) {
	let min = Infinity, max = -Infinity, positive = 0, negative = 0, gaps = 0;
	for (const [, y] of points) {
		if (!Number.isFinite(y)) { gaps++; continue; }
		min = Math.min(min, y);
		max = Math.max(max, y);
		if (y === 100) positive++;
		if (y === -100) negative++;
	}
	return {count: points.length, min: min === Infinity ? null : min, max: max === -Infinity ? null : max, positive, negative, gaps};
}

const mode = (value, label) => ({value, label});
export const libraries = {
	echarts: {
		label: 'ECharts',
		modes: [mode('lttb', 'Opt-in LTTB, default sampling budget'), mode('average', 'Opt-in average, default sampling budget'), mode('min', 'Opt-in minimum, default sampling budget'), mode('max', 'Opt-in maximum, default sampling budget'), mode('minmax', 'Opt-in min/max, default sampling budget'), mode('raw', 'Default: sampling disabled')],
		note: 'Sampling is opt-in. ECharts derives its budget from the plot width and DPR. Readouts use the processed series, not the input option.',
		async render(host, data, selection) {
			const chart = globalThis.echarts.init(host);
			try {
				const options = echartsOptions(data, selection === 'raw' ? false : selection);
				options.series[0].lineStyle.color = blue;
				chart.setOption(options);
				return {points: echartsSelected(chart), destroy: () => chart.dispose()};
			}
			catch (error) { chart.dispose(); throw error; }
		},
	},
	chartjs: {
		label: 'Chart.js',
		modes: [mode('lttb', 'Opt-in LTTB, default sampling budget'), mode('min-max', 'Opt-in decimation, default min/max and budget'), mode('raw', 'Default: decimation disabled')],
		note: 'Decimation is opt-in and requires parsing: false. Neither samples nor threshold is overridden. Min/max is the plugin’s default algorithm.',
		async render(host, data, selection) {
			const canvas = document.createElement('canvas');
			canvas.width = width; canvas.height = height;
			host.append(canvas);
			let chart;
			try {
				const options = chartjsOptions(data, selection === 'raw' ? false : selection);
				options.data.datasets[0].borderColor = blue;
				chart = new globalThis.Chart(canvas, options);
				return {points: chart.data.datasets[0].data.map(({x, y}) => [x, y]), destroy: () => chart.destroy()};
			}
			catch (error) { (chart ?? globalThis.Chart.getChart(canvas))?.destroy(); throw error; }
		},
	},
	apexcharts: {
		label: 'ApexCharts',
		modes: [mode('lttb', 'Opt-in LTTB reducer, default sampling budget'), mode('raw', 'Default: reducer disabled')],
		note: 'The scalar-line reducer uses LTTB. Only enabled is set; threshold and targetPoints keep vendor defaults. Readouts use getState().',
		async render(host, data, selection) {
			const chart = new globalThis.ApexCharts(host, {
				chart: {type: 'line', width, height, parentHeightOffset: 0, renderer: 'canvas', animations: {enabled: false}, dataReducer: {enabled: selection !== 'raw'}, toolbar: {show: false}, zoom: {enabled: false}},
				series: [{name: 'Value', data: pointsOf(data)}], colors: [blue],
				stroke: {curve: 'straight', width: 1}, markers: {size: 0}, dataLabels: {enabled: false},
				xaxis: {type: 'numeric', min: data[0][0], max: data[0].at(-1)},
				yaxis: {min: -120, max: 120}, legend: {show: false}, tooltip: {enabled: false},
			});
			try {
				await chart.render();
				const state = chart.getState();
				return {points: state.seriesX[0].map((x, i) => [x, state.series[0][i]]), destroy: () => chart.destroy()};
			}
			catch (error) { chart.destroy(); throw error; }
		},
	},
	...groupedLibraries,
};

export function referenceOptions(data) {
	return {
		width, height, legend: {show: false}, cursor: {show: false}, select: {show: false},
		scales: {x: {time: false, range: () => [data[0][0], data[0].at(-1)]}, y: {range: () => [-120, 120]}},
		series: [{}, {stroke: green, width: 1, points: {show: false}}],
	};
}

function detailFrame(canvas, range) {
	const ctx = canvas.getContext('2d');
	ctx.clearRect(0, 0, canvas.width, canvas.height);
	const x = value => 40 + (value - range[0]) / (range[1] - range[0]) * (canvas.width - 60);
	const y = value => 10 + (120 - value) / 240 * (canvas.height - 30);
	ctx.strokeStyle = '#ccc';
	ctx.beginPath(); ctx.moveTo(40, y(0)); ctx.lineTo(canvas.width - 20, y(0)); ctx.stroke();
	ctx.font = '12px sans-serif'; ctx.fillStyle = '#555';
	ctx.fillText(range[0].toFixed(0), 40, canvas.height - 2);
	ctx.fillText(range[1].toFixed(0), canvas.width - 50, canvas.height - 2);
	ctx.fillText('+100', 0, y(100)); ctx.fillText('−100', 0, y(-100));
	ctx.save(); ctx.beginPath(); ctx.rect(40, 0, canvas.width - 60, canvas.height - 20); ctx.clip();
	return {ctx, x, y};
}

function drawPoints(canvas, points, range) {
	const {ctx, x, y} = detailFrame(canvas, range);
	ctx.strokeStyle = blue; ctx.lineWidth = 1; ctx.beginPath();
	let move = true;
	for (const [px, py] of points) {
		if (!Number.isFinite(px) || !Number.isFinite(py)) { move = true; continue; }
		if (move) ctx.moveTo(x(px), y(py)); else ctx.lineTo(x(px), y(py));
		move = false;
	}
	ctx.stroke(); ctx.restore();
}

function drawReference(canvas, chart, range) {
	const {ctx} = detailFrame(canvas, range);
	// Magnify the actual cached, pixel-rounded path. Do not zoom or rebuild it.
	const paths = chart.series[1]._paths;
	const left = chart.valToPos(range[0], 'x', true);
	const right = chart.valToPos(range[1], 'x', true);
	const sx = (canvas.width - 60) / (right - left), sy = (canvas.height - 30) / chart.bbox.height;
	const transform = new DOMMatrix([sx, 0, 0, sy, 40 - left * sx, 10 - chart.bbox.top * sy]);
	const mapped = path => { const result = new Path2D(); result.addPath(path, transform); return result; };
	if (paths.clip) ctx.clip(mapped(paths.clip));
	ctx.strokeStyle = green; ctx.lineWidth = 1;
	if (paths.stroke) ctx.stroke(mapped(paths.stroke));
	ctx.restore();
}

function describe(points) {
	const s = summarizePoints(points);
	const number = value => value === null ? 'none' : Number(value.toFixed(3));
	return `${s.count.toLocaleString('en-US')} points · min ${number(s.min)} · max ${number(s.max)} · +100: ${s.positive} · −100: ${s.negative} · gap markers: ${s.gaps}`;
}

export async function mount() {
	const librarySelect = document.querySelector('#library'), modeSelect = document.querySelector('#mode'), datasetSelect = document.querySelector('#dataset');
	const status = document.querySelector('#status');
	const referenceHost = document.querySelector('#reference-chart'), vendorHost = document.querySelector('#vendor-chart');
	const controls = [librarySelect, modeSelect, datasetSelect];
	for (const [id, library] of Object.entries(libraries)) librarySelect.add(new Option(library.label, id));
	for (const item of accuracyCases) datasetSelect.add(new Option(item.label, item.id));
	const query = new URLSearchParams(location.search);
	if (libraries[query.get('library')]) librarySelect.value = query.get('library');
	if (accuracyCases.some(item => item.id === query.get('dataset'))) datasetSelect.value = query.get('dataset');
	const updateModes = () => {
		modeSelect.replaceChildren();
		for (const item of libraries[librarySelect.value].modes) modeSelect.add(new Option(item.label, item.value));
	};
	updateModes();
	if (libraries[librarySelect.value].modes.some(item => item.value === query.get('mode'))) modeSelect.value = query.get('mode');
	let reference, current, disposed = false;
	function destroy() {
		disposed = true;
		reference?.destroy(); reference = null;
		current?.destroy(); current = null;
	}
	window.addEventListener('pagehide', destroy, {once: true});
	async function render() {
		controls.forEach(control => { control.disabled = true; });
		status.dataset.state = 'loading'; status.textContent = 'Loading and rendering…';
		const id = librarySelect.value, library = libraries[id];
		const item = accuracyCases.find(item => item.id === datasetSelect.value);
		try {
			reference?.destroy(); reference = null;
			current?.destroy(); current = null;
			referenceHost.replaceChildren(); vendorHost.replaceChildren();
			for (const output of document.querySelectorAll('output')) output.textContent = '';
			for (const canvas of document.querySelectorAll('.detail')) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
			const versions = [...new Set(demoDependencies[id].filter(dep => dep.name).map(dep => `${dep.name} ${dep.version}`))];
			document.querySelector('#vendor-title').textContent = `${library.label} — ${modeSelect.selectedOptions[0].textContent}`;
			document.querySelector('#settings').textContent = `${versions.join(', ')}. ${library.note}`;
			document.querySelector('#case-description').textContent = item.description;
			for (const variant of ['uplot', id])
				for (const dependency of demoDependencies[variant]) await loadDependency(dependency);
			if (disposed) return;
			reference = new globalThis.uPlot(referenceOptions(item.data), item.data, referenceHost);
			current = await library.render(vendorHost, item.data, modeSelect.value);
			if (disposed) { current.destroy(); current = null; return; }
			document.querySelector('#reference-output').textContent = `Input: ${describe(pointsOf(item.data))}. This is not a count of path vertices.`;
			document.querySelector('#vendor-output').textContent = current.points === null ? current.note : `Processed: ${describe(current.points)}. ${current.note ?? ''}`;
			drawReference(document.querySelector('#reference-detail'), reference, item.detail);
			const detail = document.querySelector('#vendor-detail');
			detail.hidden = current.points === null;
			if (current.points !== null) drawPoints(detail, current.points, item.detail);
			document.querySelector('#detail-range').textContent = `Detail: x = ${item.detail.join('…')} minutes. Neither view runs another reduction pass.`;
			status.textContent = `Ready · browser DPR ${devicePixelRatio} · chart size ${width} × ${height} CSS pixels. Plot-area widths differ with native axes.`;
			status.dataset.state = 'ready';
		}
		catch (error) {
			current?.destroy(); current = null;
			status.dataset.state = 'error'; status.textContent = `Cannot render comparison: ${error.message}`;
			console.error(error);
		}
		finally { controls.forEach(control => { control.disabled = false; }); }
	}
	librarySelect.addEventListener('change', () => { updateModes(); render(); });
	modeSelect.addEventListener('change', render);
	datasetSelect.addEventListener('change', render);
	await render();
	return destroy;
}
