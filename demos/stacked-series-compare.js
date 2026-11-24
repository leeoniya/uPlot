import {createStackedSeriesData, negativeStackData, stackedSeries} from './lib/stackedSeriesData.js';

export const comparisons = [
	{id: 'uplot', name: 'uPlot', version: 'local build', note: 'Two native stacks use dir: 1 and dir: -1. The negative stack mirrors the raw rows below across y = 0. Colors identify the same layers in both stacks. Each stack paints strokes from D toward A, nearest zero. Fills, points, and hooks keep their existing order.'},
	{id: 'chartjs', name: 'Chart.js', version: '4.6.1', note: 'Each sign has its own stack ID. Each base fills to zero; other layers fill to the previous dataset. Chart.js paints datasets in reverse order.'},
	{id: 'echarts', name: 'ECharts', version: '6.1.0', note: 'Line series share one stack ID per sign. Numeric axes stack these aligned samples by index.'},
	{id: 'd3', name: 'D3', version: '7.9.0', note: 'd3.stack() with linear area fills and separate upper-edge strokes. This example paints each layer from A to D, fill then stroke. D3 does not impose a paint order or supply a legend.'},
	{id: 'apexcharts', split: true, name: 'ApexCharts', version: '8.4.1', note: 'Native stacked area chart with straight strokes and solid fills. The SVG renderer paints stacked series in reverse order. Each fill extends to zero, so translucent fills overlap and blend.'},
	{id: 'highcharts', name: 'Highcharts', version: '13.1.1', note: 'Two area stacks use normal stacking. With reversedStacks: false, A is nearest zero in both stacks.'},
	{id: 'plotly', name: 'Plotly.js', version: '4.1.2', note: 'Each sign uses its own stackgroup. Each base fills to zero. Other traces fill to the previous boundary with tonexty.'},
	{id: 'recharts', name: 'Recharts', version: '3.10.1', note: 'Native AreaChart with separate stackId values and stackOffset: "none". React 19.3.1 renders the linear areas.'},
	{id: 'agcharts', name: 'AG Charts Community', version: '14.2.0', note: 'Native area series with one stackGroup per sign. The renderer paints fills in background groups and strokes in foreground groups.'},
	{id: 'amcharts', name: 'amCharts', version: '5.21.4', note: 'Each group starts with an unstacked base, followed by stacked LineSeries. Both axes use numeric values. Series animations are disabled; the vendor logo keeps its native animation and interaction.'},
	{id: 'googlecharts', split: true, name: 'Google Charts', version: '52', note: 'Classic AreaChart with isStacked: true. The Google loader requests frozen corechart release 52. Google can apply critical fixes to frozen releases.'},
	{id: 'vega', name: 'Vega', version: '6.4.0', note: 'The stack transform uses signed values. At x=14, negative B–D collapse at y = 0, not at −5. Each layer paints its fill, then its outer stroke.'},
	{id: 'g2', name: 'AntV G2', version: '5.4.8', note: 'Native stackY transform with linear area marks. G2 strokes each complete area outline, including lower edges and end caps. Negative zero-height layers collapse at y = 0, not at the preceding negative boundary. Areas retain native A–D paint order.'},
	{id: 'billboard', split: true, name: 'billboard.js', version: '4.1.3', note: 'Native SVG area series with data.groups and order: null. Raw columns stay in A–D order. The example keeps native zero handling and paint order.'},
	{id: 'dygraphs', split: true, name: 'dygraphs', version: '2.2.2', note: 'Native stackedGraph with area fills. dygraphs stacks the last input column at the bottom. Raw columns, labels, and colors use D–A order to place A at the bottom.'},
	{id: 'muicharts', name: 'MUI X Charts', version: '9.16.0', note: 'Native LineChart areas share one stack per sign. MUI paints fills from D to A, then upper-edge strokes from A to D. The default brightness filter is disabled to preserve the shared colors.'},
	{id: 'nivo', split: true, name: 'Nivo', version: '0.99.0', note: 'Native Line with a stacked Y scale and area fills. Nivo paints all fills, then upper-edge strokes, each from D to A. Each fill extends to zero, so translucent fills overlap and blend.'},
	{id: 'victory', name: 'Victory', version: '38.1.1', note: 'Each sign has its own VictoryStack with VictoryArea children. At x=2, negative B is zero. Its stroke goes to y = 0 rather than meeting negative A at −5.'},
	{id: 'canvasjs', split: true, name: 'CanvasJS', version: '3.17.8', note: 'Native stackedArea series paint from A to D, each upper-edge stroke before its fill. CanvasJS accumulates rounded pixel heights, which can slightly shift cumulative boundaries. Vendor credits remain enabled.'},
	{id: 'bokeh', name: 'Bokeh', version: '3.10.1', note: 'Native Stack expressions drive VArea fills and separate upper-edge Line glyphs. This example paints A through D, each fill followed by its line. VArea has no stroke properties.'},
];

async function mountPair(host, data, createDemo) {
	const negativeData = negativeStackData(data);
	const positive = await createDemo(host.querySelector('#plot-positive'), data);
	try {
		const negative = await createDemo(host.querySelector('#plot-negative'), negativeData);
		return {
			plot: positive.plot,
			plots: [positive.plot, negative.plot],
			destroy() {
				try { negative.destroy(); }
				finally { positive.destroy(); }
			},
		};
	}
	catch (error) {
		try { positive.destroy(); }
		finally { throw error; }
	}
}

export async function mountDemo(root, id, createDemo) {
	const comparison = comparisons.find(item => item.id === id);
	if (!comparison)
		throw new Error(`Unknown stacking comparison: ${id}`);

	const {split} = comparison;
	const doc = root.ownerDocument;
	const data = createStackedSeriesData();
	root.dataset.library = id;
	root.innerHTML = `
		<nav aria-label="Stacking comparisons"><a href="stacked-series-index.html">Comparison index</a> · <a href="stacked-series.html">Full uPlot stacking demo</a></nav>
		<h1></h1>
		<p>The negative stack mirrors the positive data across y = 0. Both stack from A to D, with A nearest zero.
		${split ? 'This library uses a separate chart for each sign.' : 'Both stacks share one chart.'}</p>
		<p>Linear paths · 3px strokes · 18% fill opacity · ${id === 'uplot' ? 'Initial ' : ''}X: 0–20 · Y: ${id === 'uplot' ? 'automatic (no padding)' : split ? '0–16 and −16–0' : '−16–16'} · No data-point markers or series animations.</p>
		<p class="note"></p>
		<p>Zero runs: B at <strong>x=2–4</strong>, C at <strong>x=6–8</strong>, and D at <strong>x=10–12</strong>.
		B, C, and D are all zero at <strong>x=14–16</strong>. D also has an isolated zero at <strong>x=18</strong>.</p>
		<p id="status" role="status">Loading chart…</p>
		${id === 'uplot' ? '<p>Hover to see values in the native legend. Click a legend label to toggle a series. Drag horizontally to zoom. Double-click to reset.</p>' : ''}
		<div class="plot-scroll"><div id="plot" class="${split ? 'stack-pair' : 'stack-panel'}" role="group" aria-label="Mirrored positive and negative stacks with separate and shared zero runs">${split ? `
			<h2>Positive stack</h2><div id="plot-positive" class="stack-panel" role="group" aria-label="Positive stack"></div>
			<h2>Negative stack</h2><div id="plot-negative" class="stack-panel" role="group" aria-label="Negative stack"></div>` : ''}</div></div>
		<details><summary>Raw data (zeros are not missing values)</summary><div class="data-scroll"><table><caption>Positive values before stacking. The negative series use their opposites.</caption></table></div></details>
		<p class="libraries"></p>
	`;
	root.querySelector('h1').textContent = `Stacked zeros · ${comparison.name} ${comparison.version}`;
	root.querySelector('.note').textContent = comparison.note;

	const table = root.querySelector('table');
	for (let row = 0; row < data.length; row++) {
		const tr = table.insertRow();
		const label = doc.createElement('th');
		label.scope = 'row';
		label.textContent = row === 0 ? 'X' : stackedSeries[row - 1].label;
		tr.appendChild(label);
		for (const value of data[row]) {
			const cell = tr.insertCell();
			cell.textContent = String(value);
			if (row > 0 && value === 0)
				cell.className = 'zero';
		}
	}

	const links = root.querySelector('.libraries');
	for (const [i, library] of comparisons.entries()) {
		if (i > 0)
			links.appendChild(doc.createTextNode(' · '));
		const link = doc.createElement('a');
		link.href = `stacked-series-${library.id}.html`;
		link.textContent = library.name;
		if (library.id === id)
			link.setAttribute('aria-current', 'page');
		links.appendChild(link);
	}

	if (id === 'apexcharts' || id === 'highcharts' || id === 'amcharts') {
		const notice = doc.createElement('p');
		notice.className = 'license';
		notice.innerHTML = id === 'apexcharts'
			? 'ApexCharts has <a href="https://cdn.jsdelivr.net/npm/apexcharts@8.4.1/LICENSE.md">license restrictions</a>, including use in competing charting products. Review the terms before publication or reuse.'
			: id === 'highcharts'
				? 'Highcharts requires an applicable <a href="https://www.highcharts.com/license">license</a>. Library credits remain enabled.'
				: 'amCharts retains its vendor logo under its <a href="https://www.amcharts.com/online-store/licenses-explained/">license terms</a>.';
		root.appendChild(notice);
	}

	const status = root.querySelector('#status');
	root.dataset.state = 'loading';
	try {
		const host = root.querySelector('#plot');
		const demo = split ? await mountPair(host, data, createDemo) : await createDemo(host, data);
		await new Promise(resolve => doc.defaultView.requestAnimationFrame(resolve));
		status.textContent = 'Ready. Compare the boundary colors across the zero runs and the strokes at x=18.';
		root.dataset.state = 'ready';
		return demo;
	}
	catch (error) {
		status.textContent = `Cannot render chart: ${error.message}. Serve the repository root over HTTP and allow the library hosts listed in the comparison index.`;
		root.dataset.state = 'error';
		console.error(error);
		return null;
	}
}
