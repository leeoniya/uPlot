// vega@6.4.0/build/vega.min.js exposes vega (BSD-3-Clause).
function prepData(packed) {
	const fields = packed[0];
	const data = new Array((packed.length - fields - 1) / fields);

	for (let i = fields + 1, j = 0; i < packed.length; i += fields, j++) {
		data[j] = {
			time: packed[i] * 60000,
			cpu: Math.round((100 - packed[i + 1]) * 1000) / 1000,
			ram: Math.round(100 * packed[i + 5] / (packed[i + 5] + packed[i + 6]) * 100) / 100,
			tcp: packed[i + 3],
		};
	}

	return data;
}

async function makeChart(data, host, wait) {
	let view;
	try {
		const spec = {
			width: 1920,
			height: 600,
			autosize: {type: 'fit', contains: 'padding'},
			padding: 10,
			title: {text: 'Server Events'},
			// Vega adds tuple IDs. Copy inside timed initialization, not in hidden setup.
			data: [{name: 'table', values: data.map(row => ({...row}))}],
			scales: [
				{name: 'x', type: 'time', domain: {data: 'table', field: 'time'}, range: 'width'},
				{name: 'percent', type: 'linear', domain: {data: 'table', fields: ['cpu', 'ram']}, range: 'height', zero: false, nice: true},
				{name: 'tcp', type: 'linear', domain: {data: 'table', field: 'tcp'}, range: 'height', zero: false, nice: true},
				{name: 'color', type: 'ordinal', domain: ['CPU', 'RAM', 'TCP Out'], range: ['red', 'blue', 'green']},
			],
			axes: [
				{scale: 'x', orient: 'bottom', tickCount: 10},
				{scale: 'percent', orient: 'left', grid: true, encode: {labels: {update: {text: {signal: "datum.label + '%'"}}}}},
				{scale: 'tcp', orient: 'right', encode: {labels: {update: {text: {signal: "datum.label + ' MB'"}}}}},
			],
			legends: [{stroke: 'color', orient: 'bottom', direction: 'horizontal', symbolType: 'stroke'}],
			// One wide dataset avoids a fold transform and its threefold tuple expansion.
			marks: ['cpu', 'ram', 'tcp'].map((field, i) => ({
				name: field,
				type: 'line',
				from: {data: 'table'},
				encode: {update: {
					x: {scale: 'x', field: 'time'},
					y: {scale: i === 2 ? 'tcp' : 'percent', field},
					stroke: {scale: 'color', value: ['CPU', 'RAM', 'TCP Out'][i]},
					strokeWidth: {value: 1 / devicePixelRatio},
				}},
			})),
		};
		// Vega normally logs dataflow errors and resolves runAsync even after failure.
		const logger = vega.logger(vega.Warn);
		logger.error = error => { throw error instanceof Error ? error : new Error(String(error)); };
		// Parsing, tuple ingestion, domains, layout, and Canvas rendering are all timed.
		view = new vega.View(vega.parse(spec), {renderer: 'canvas', logger});
		view.initialize(host);
		await view.runAsync();
		if (wait)
			wait.textContent = 'Done!';
		return view;
	}
	catch (error) {
		try { if (view) destroyChart(view); }
		finally { throw error; }
	}
}

function makeEmptyChart(host, wait) {
	return makeChart([], host, wait);
}

async function updateChart(view, input, host, wait) {
	// As in makeChart, do not let Vega's tuple IDs mutate prepared input.
	view.change('table', vega.changeset().remove(() => true).insert(input.map(row => ({...row}))));
	await view.runAsync();
	if (wait) wait.textContent = 'Done!';
}

function destroyChart(view) {
	const host = view.container();
	try { view.finalize(); }
	finally {
		// finalize releases listeners and timers, but leaves the rendered DOM in place.
		host?.replaceChildren();
	}
}

export {prepData, makeChart, destroyChart, makeEmptyChart, updateChart};
