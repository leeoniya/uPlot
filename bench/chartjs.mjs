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
		cpu[j] = {x: date, y: round3(100 - packed[i+1])};
		ram[j] = {x: date, y: round2(100 * packed[i+5] / (packed[i+5] + packed[i+6]))};
		tcp[j] = {x: date, y: packed[i+3]};
	}

	console.timeEnd('prep');

	return [cpu, ram, tcp];
}

function makeChart(data, host, wait) {
	console.time('chart');

	var ctx = host.querySelector('#chart1').getContext('2d');
	var cfg = {
		data: {
			datasets: [
				{
					label: 'CPU',
					yAxisID: 'y',
					borderColor: 'rgb(255, 99, 132)',
					data: data[0],
					type: 'line',
					radius: 0,
					fill: false,
					borderWidth: 1
				},
				{
					label: 'RAM',
					yAxisID: 'y',
					borderColor: 'rgb(54, 162, 235)',
					data: data[1],
					type: 'line',
					radius: 0,
					fill: false,
					borderWidth: 1
				},
				{
					label: 'TCP Out',
					yAxisID: 'y2',
					borderColor: 'rgb(75, 192, 192)',
					data: data[2],
					type: 'line',
					radius: 0,
					fill: false,
					borderWidth: 1
				}
			]
		},
		options: {
			animation: false,
			maintainAspectRatio: false,
			parsing: false,
			spanGaps: true,
			normalized: true,
			interaction: {
				mode: 'nearest',
				axis: 'x',
				intersect: false
			},
			scales: {
				x: {
					type: 'time',
					stacked: false,
					ticks: {
						source: 'auto',
						maxRotation: 0,
						autoSkip: true,
						autoSkipPadding: 75,
						sampleSize: 1
					}
				},
				y: {
					type: 'linear',
					position: 'left',
					stacked: false,
					scaleLabel: {
						display: true,
						labelString: '%'
					}
				},
				y2: {
					type: 'linear',
					stacked: false,
					position: 'right',
					scaleLabel: {
						display: true,
						labelString: 'MB'
					}
				}
			},
			plugins: {
				decimation: {
					enabled: true,
					algorithm: 'min-max'
				}
			}
		}
	};

	var chart = new Chart(ctx, cfg);

	wait.textContent = "Done!";
	console.timeEnd('chart');
	return chart;
}

export {makeChart, prepData};
