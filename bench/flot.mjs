function round2(val) {
	return Math.round(val * 100) / 100;
}

function round3(val) {
	return Math.round(val * 1000) / 1000;
}

function prepData(packed) {
	console.time('prep');

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

	console.timeEnd('prep');

	return [cpu, ram, tcp];
}

function makeChart(data, host, wait) {
	console.time('chart');

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
			drawOverlay: [
				() => {
					wait.textContent = "Done!";
					console.timeEnd('chart');
				}
			]
		}
	});

	return plot;
}

export {makeChart, prepData};
