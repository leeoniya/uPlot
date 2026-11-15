import uPlot from '../src/uPlot.js';
import { closestIdx } from '../src/utils.js';
import { candlestickPlugin } from './lib/candlestickPlugin.js';
import { readText } from './demoResources.js';
import { plotStep } from './renderDemo.js';

// Source: https://github.com/grafana/grafana/blob/main/pkg/tsdb/grafana-testdata-datasource/data/ohlc_dogecoin.csv
export const dataUrl = 'data/ohlc_dogecoin.csv';
export const initialRange = [
	Date.parse('2021-07-14T01:07:58.420Z') / 1e3,
	Date.parse('2021-07-14T01:31:14.094Z') / 1e3,
];

export function parseCsv(csv) {
	const rows = csv.trim().split(/\r?\n/);
	const names = rows.shift().split(',');
	const data = names.map(() => []);

	// This dataset has a timestamp first and unquoted numeric fields after it.
	for (const row of rows) {
		row.split(',').forEach((value, i) => {
			data[i].push(i == 0 ? Date.parse(value) / 1e3 : value == '' ? null : +value);
		});
	}

	return {data, fields: Object.fromEntries(names.map((name, i) => [name, i]))};
}

function columnInterval(times) {
	let interval = Infinity;
	for (let i = 1; i < times.length; i++) {
		const delta = times[i] - times[i - 1];
		if (delta > 0 && delta < interval)
			interval = delta;
	}
	// A single timestamp cannot supply a sampling interval.
	return Number.isFinite(interval) ? interval : 1;
}

function columnRange(times, min, max) {
	if (times.length == 0 || min == null || max == null)
		return [null, null];

	const interval = columnInterval(times);
	const half = interval / 2;
	let i0 = closestIdx(min + half, times);
	let i1 = closestIdx(max - half, times);
	if (times[i0] - half > min && i0 > 0)
		i0--;
	if (times[i1] + half < max && i1 < times.length - 1)
		i1++;

	// Anchor each edge to nearby data, including when gaps are not interval multiples.
	const left = times[i0] - half;
	const right = times[i1] + half;
	return [
		left + Math.floor((min - left) / interval) * interval,
		right + Math.ceil((max - right) / interval) * interval,
	];
}

function columnHighlightPlugin() {
	const highlight = document.createElement('div');
	Object.assign(highlight.style, {
		pointerEvents: 'none', display: 'none', position: 'absolute',
		left: 0, top: 0, height: '100%', background: 'rgba(128,128,128,0.2)',
	});
	let prevIdx, interval;

	function update(u, force = false) {
		const idx = u.cursor.left < 0 || u.cursor.top < 0 ? null : u.cursor.idx;
		if (idx === prevIdx && !force)
			return;
		prevIdx = idx;
		const time = u.data[0][idx];
		if (idx == null || time == null) {
			highlight.style.display = 'none';
			return;
		}
		const left = u.valToPos(time - interval / 2, 'x');
		const right = u.valToPos(time + interval / 2, 'x');
		highlight.style.transform = `translateX(${Math.round(left)}px)`;
		highlight.style.width = Math.max(1, Math.round(right - left)) + 'px';
		highlight.style.display = '';
	}

	return {
		hooks: {
			init: u => u.under.appendChild(highlight),
			setData: u => { interval = columnInterval(u.data[0]); },
			setCursor: update,
			draw: u => update(u, true),
		},
	};
}

export function createCharts({data, fields}, target) {
	const xRange = (u, min, max) => columnRange(u.data[0], min, max);
	const [xMin, xMax] = columnRange(data[0], ...initialRange);
	const fmtPrice = new Intl.NumberFormat('en-US', {
		style: 'currency', currency: 'USD', minimumFractionDigits: 3, maximumFractionDigits: 7,
	}).format;
	const fmtVolume = new Intl.NumberFormat('en-US', {notation: 'compact', maximumFractionDigits: 1}).format;
	function priceTicks(u, splits) {
		const dec = uPlot.numDec(splits);
		return splits.map(value => value == null ? '' : '$' + value.toFixed(dec));
	}
	const fmtDate = uPlot.fmtDate('{YYYY}-{MM}-{DD} {HH}:{mm}:{ss} UTC');
	const tzDate = ts => uPlot.tzDate(new Date(ts * 1e3), 'Etc/UTC');
	const overlays = [fields.sma, fields.bolup, fields.boldn];
	const variants = [
		{title: 'Price & Volume', mode: 'candles+volume', overlays: true},
		{title: 'Price Only, Hollow Candles', mode: 'candles', colorStrategy: 'close-close'},
		{title: 'Price Only, OHLC Bars', mode: 'candles', candleStyle: 'ohlcbars', upColor: '#3274d9'},
		{title: 'Volume Only, Alt Colors, 100% Opacity', mode: 'volume', upColor: '#e0b400', volumeAlpha: 1},
	];

	return variants.map(variant => {
		const price = variant.mode != 'volume';
		const volume = variant.mode != 'candles';
		const host = target.appendChild(document.createElement('div'));
		const series = Object.keys(fields).map(name => ({
			label: name[0].toUpperCase() + name.slice(1),
			show: false,
			stroke: '#000',
			points: {show: false},
			value: (u, value) => value == null ? '' : fmtPrice(value),
		}));
		series[0] = {label: 'Time', value: (u, value) => value == null ? '' : fmtDate(tzDate(value))};
		for (const name of ['open', 'high', 'low', 'close'])
			series[fields[name]].show = price;
		Object.assign(series[fields.volume], {
			show: volume, scale: 'volume',
			value: (u, value) => value == null ? '' : uPlot.fmtNum(value),
		});
		for (const si of overlays)
			Object.assign(series[si], {show: !!variant.overlays, stroke: '#3274d9', width: 1, dash: [10, 10]});
		Object.assign(series[fields.sma], {label: 'SMA', stroke: '#ff780a', width: 5, dash: [0, 20], cap: 'round'});
		series[fields.bolup].label = 'Bollinger upper';
		Object.assign(series[fields.boldn], {label: 'Bollinger lower', stroke: '#e0b400'});

		function volumeTicks(u, splits) {
			const last = splits.findIndex(value => value > u.series[fields.volume].max);
			return splits.map((value, i) => last == -1 || i <= last ? value : null);
		}

		const observer = new ResizeObserver(([entry]) => {
			const width = Math.floor(entry.contentRect.width);
			if (width > 0 && width != u.width)
				u.setSize({width, height: 420});
		});
		const u = new uPlot({
			title: variant.title,
			width: host.clientWidth || 600,
			height: 420,
			tzDate,
			series,
			plugins: [candlestickPlugin({fields, ...variant}), columnHighlightPlugin()],
			legend: {show: !!variant.overlays, live: false, filter: (u, si) => overlays.includes(si)},
			tooltip: {show: true, markers: {show: false}, filter: (u, si) => u.series[si].show},
			cursor: {
				x: false, y: false, points: {show: false},
				drag: {x: true, y: false, setRange: (u, key, min, max) => key == 'x' ? xRange(u, min, max) : [min, max]},
				sync: {key: 'dogecoin', scales: ['x', null]},
			},
			scales: {
				x: {min: xMin, max: xMax, range: xRange},
				y: {axis: 1},
				volume: {
					axis: 2,
					range: price ? (u, min, max) => [0, Math.max(1, max ?? 0) * 7] : [0, null],
				},
			},
			axes: [
				{},
				{show: price, size: 'auto', values: priceTicks},
				{
					show: volume, scale: 'volume', side: price ? 1 : 3, size: 'auto',
					grid: {show: !price},
					values: (u, splits) => splits.map(value => value == null ? '' : fmtVolume(value)),
					...(price ? {space: 20, filter: volumeTicks, ticks: {filter: volumeTicks}} : {}),
				},
			],
			bands: variant.overlays ? [{series: [fields.bolup, fields.boldn], fill: 'rgba(50,116,217,0.08)'}] : [],
			hooks: {destroy: [() => observer.disconnect()]},
		}, data, host);
		observer.observe(host);
		return u;
	});
}

export async function createDemo(target = document.body) {
	return createCharts(parseCsv(await readText(dataUrl)), target);
}

export default [{
	steps: [plotStep(createDemo)],
}];
