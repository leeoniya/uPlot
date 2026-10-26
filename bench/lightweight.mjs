const cleanups = new WeakMap();
const updates = new WeakMap();

function prepData(packed) {
	const fields = packed[0];
	const start = fields + 1;
	const count = (packed.length - start) / fields;
	const cpu = Array(count);
	const ram = Array(count);
	const tcp = Array(count);

	for (let i = start, j = 0; i < packed.length; i += fields, j++) {
		const time = packed[i] * 60;
		cpu[j] = {time, value: Math.round((100 - packed[i + 1]) * 1000) / 1000};
		ram[j] = {time, value: Math.round(100 * packed[i + 5] / (packed[i + 5] + packed[i + 6]) * 100) / 100};
		tcp[j] = {time, value: packed[i + 3]};
	}

	return [cpu, ram, tcp];
}

function makeChart(data, host, wait) {
	const chart = LightweightCharts.createChart(host, {
		width: 1920,
		height: 600,
		layout: {attributionLogo: true},
		leftPriceScale: {visible: true, autoScale: true},
		rightPriceScale: {visible: true, autoScale: true},
		timeScale: {
			timeVisible: true,
			secondsVisible: false,
			// The default 0.5px minimum prevents fitContent() from showing all 55,550 rows.
			minBarSpacing: 0.0001,
			// Native, zoom-dependent rendering; setData() still receives every sample.
			// https://tradingview.github.io/lightweight-charts/docs/api/interfaces/TimeScaleOptions#enableconflation
			enableConflation: true,
		},
	});
	const position = host.style.position;
	const legend = host.ownerDocument.createElement('div');
	legend.style.cssText = 'position:absolute;top:8px;left:80px;right:80px;display:flex;gap:16px;align-items:center;z-index:1;font:12px sans-serif;pointer-events:none';
	host.style.position = 'relative';
	host.append(legend);

	const names = ['CPU', 'RAM', 'TCP Out'];
	const colors = ['red', 'blue', 'green'];
	const series = [];
	const buttons = [];
	const format = (value, index) => `${value == null ? '--' : Number(value.toFixed(2))} ${index === 2 ? 'MB' : '%'}`;
	const updateLegend = param => {
		series.forEach((line, i) => {
			const point = param?.time == null ? data[i][data[i].length - 1] : param.seriesData.get(line);
			buttons[i].textContent = `${names[i]}: ${format(point?.value, i)}`;
		});
	};

	cleanups.set(chart, () => {
		chart.unsubscribeCrosshairMove(updateLegend);
		legend.remove();
		host.style.position = position;
	});

	try {
		for (let i = 0; i < names.length; i++) {
			const line = chart.addSeries(LightweightCharts.LineSeries, {
				title: names[i],
				color: colors[i],
				lineWidth: 1,
				priceScaleId: i === 2 ? 'right' : 'left',
				priceFormat: {type: 'custom', minMove: 0.01, formatter: value => format(value, i)},
				pointMarkersVisible: false,
				lastPriceAnimation: LightweightCharts.LastPriceAnimationMode.Disabled,
				priceLineVisible: false,
			});
			line.setData(data[i]);
			series.push(line);

			const button = host.ownerDocument.createElement('button');
			button.type = 'button';
			button.style.cssText = `color:${colors[i]};background:white;border:0;padding:2px;cursor:pointer;pointer-events:auto`;
			button.setAttribute('aria-pressed', 'true');
			button.onclick = () => {
				const visible = !line.options().visible;
				line.applyOptions({visible});
				button.setAttribute('aria-pressed', String(visible));
				button.style.opacity = visible ? '1' : '0.5';
			};
			buttons.push(button);
			legend.append(button);
		}

		const attribution = host.ownerDocument.createElement('a');
		attribution.href = 'https://www.tradingview.com/';
		attribution.textContent = 'TradingView Lightweight Charts™ — Copyright (с) 2025 TradingView, Inc.';
		attribution.style.cssText = 'margin-left:auto;color:#555;font-size:10px;pointer-events:auto';
		legend.append(attribution);

		updates.set(chart, input => {
			series.forEach((line, i) => line.setData(input[i]));
			data = input;
			updateLegend();
			chart.timeScale().fitContent();
		});
		updateLegend();
		chart.subscribeCrosshairMove(updateLegend);
		chart.timeScale().fitContent();
		if (wait) wait.textContent = 'Done!';
		return chart;
	}
	catch (error) {
		destroyChart(chart);
		throw error;
	}
}

function destroyChart(chart) {
	cleanups.get(chart)?.();
	cleanups.delete(chart);
	updates.delete(chart);
	chart.remove();
}

async function rendered(chart, wait) {
	// setData/fitContent queue the native draw before this callback. The public
	// API has no render-complete event; this is a frame barrier, not a GPU fence.
	await new Promise(resolve => requestAnimationFrame(resolve));
	if (wait) wait.textContent = 'Done!';
	return chart;
}

function makeEmptyChart(host, wait) {
	return makeLifecycleChart([[], [], []], host, wait);
}

export function makeLifecycleChart(data, host, wait) {
	return rendered(makeChart(data, host), wait);
}

function updateChart(chart, input, host, wait) {
	updates.get(chart)(input);
	return rendered(chart, wait);
}

export function resizeChart(chart, {width, height}, host, wait) {
	chart.resize(width, height, true);
	// Preserve the benchmark's all-data view without calling setData again.
	chart.timeScale().fitContent();
	return rendered(chart, wait);
}

export {prepData, makeChart, destroyChart, makeEmptyChart, updateChart};
