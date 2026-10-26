function round2(val) {
	return Math.round(val * 100) / 100;
}

function round3(val) {
	return Math.round(val * 1000) / 1000;
}

function prepData(packed) {
	// epoch,idl,recv,send,writ,used,free

	const numFields = packed[0];
	const start = numFields + 1;
	const rows = (packed.length - start) / numFields;

	var cpu = Array(rows);
	var ram = Array(rows);
	var tcp = Array(rows);

	for (let i = start, j = 0; i < packed.length; i += numFields, j++) {
		let date = packed[i] * 60 * 1000;
		cpu[j] = [date, round3(100 - packed[i+1])];
		ram[j] = [date, round2(100 * packed[i+5] / (packed[i+5] + packed[i+6]))];
		tcp[j] = [date, packed[i+3]];
	}

	return [cpu, ram, tcp];
}

function makeChart(data, host, wait) {
	return createChart(data, host, wait, false);
}

function createChart(data, host, wait, lifecycle) {
	const plot = $.plot($(host.querySelector("#placeholder")), [
		{label: 'CPU', data: data[0], yaxis: 1},
		{label: 'RAM', data: data[1], yaxis: 1},
		{label: 'TCP Out', data: data[2], yaxis: 2},
	], {
		xaxis: { mode: "time", timeBase: "milliseconds"},
		yaxes: [
			{position: 'left', tickFormatter: value => value + '%'},
			{position: 'right', tickFormatter: value => value + ' MB'},
		],
		hooks: {
			drawOverlay: lifecycle ? [] : [
				() => {
					wait.textContent = "Done!";
				}
			]
		}
	});

	return plot;
}

async function overlayReady(chart, draw, wait) {
	let complete;
	const ready = new Promise(resolve => { complete = resolve; });
	chart.hooks.drawOverlay.push(complete);
	try {
		draw();
		await ready;
		if (wait) wait.textContent = 'Done!';
		return chart;
	}
	finally {
		const hooks = chart.hooks.drawOverlay;
		hooks.splice(hooks.indexOf(complete), 1);
	}
}

function makeEmptyChart(host, wait) {
	return makeLifecycleChart([[], [], []], host, wait);
}

export function makeLifecycleChart(data, host, wait) {
	const chart = createChart(data, host, wait, true);
	return overlayReady(chart, () => chart.triggerRedrawOverlay(), wait);
}

function updateChart(chart, input, host, wait) {
	return overlayReady(chart, () => {
		chart.setData(chart.getData().map((series, i) => ({...series, data: input[i]})));
		chart.setupGrid();
		chart.draw();
		chart.triggerRedrawOverlay();
	}, wait);
}

export function resizeChart(chart, size, host, wait) {
	return overlayReady(chart, () => {
		// The placeholder is 100% of the host sized by the harness.
		chart.resize();
		chart.setupGrid();
		chart.draw();
		chart.triggerRedrawOverlay();
	}, wait);
}

export {makeChart, prepData, makeEmptyChart, updateChart};
