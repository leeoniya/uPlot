function round2(val) {
	return Math.round(val * 100) / 100;
}

function round3(val) {
	return Math.round(val * 1000) / 1000;
}

function prepData(packed) {
	console.time('prep');

	// epoch,idl,recv,send,read,writ,used,free

	const numFields = packed[0];
	packed = packed.slice(numFields + 1);

	var cpu = Array(packed.length/numFields);
	var ram = Array(packed.length/numFields);
	var tcp = Array(packed.length/numFields);

	for (let i = 0, j = 0; i < packed.length; i += numFields, j++) {
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

	const plot = $.plot($(host.querySelector("#placeholder")), data, {
		xaxis: { mode: "time", timeBase: "milliseconds"},
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
