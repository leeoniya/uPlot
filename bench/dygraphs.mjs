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

	let data = Array(packed.length/numFields);

	for (let i = 0, j = 0; i < packed.length; i += numFields, j++) {
		let rec = Array(4);
		rec[0] = new Date(packed[i] * 60 * 1000);
		rec[1] = round3(100 - packed[i+1]);
		rec[2] = round2(100 * packed[i+5] / (packed[i+5] + packed[i+6]))
		rec[3] = packed[i+3];

		data[j] = rec;
	}

	console.timeEnd('prep');

	return data;
}

function makeChart(data, host, wait) {
	console.time('chart');

	let dateFormat = fmtDate('{M}/{DD}/{YY}\n{h}:{mm}{aa}');

	var dyCpuMem = new Dygraph(host, data, {
		width: 1920,
		height: 600,
		labels: [
			'Time',
			'CPU',
			'RAM',
			'TCP Out',
		],
	/*	series: {
		  'TCP Out': {
			axis: 'y2'
		  },
		},
	*/
		colors: [
			'rgba(255,0,0,1)',
			'rgba(0,0,255,1)',
		//	'#12007f',
			'#297f00',
		],
		axes: {
			x: {
				axisLabelFormatter: function (d, gran) {
					return dateFormat(d);
				},
				valueFormatter: function (d) {
					return dateFormat(new Date(d));
				}
			},
			y: {
				axisLabelFormatter: function (d, gran) {
					return d + "%";
				},
				valueFormatter: function (d) {
					return round2(d) + "%";
				}
			},
			y2: {
				axisLabelFormatter: function (d, gran) {
					return d + " MB";
				},
				valueFormatter: function (d) {
					return d + " MB";
				},
			//	labelsKMB: true,
			//	drawGrid: true,
				independentTicks: true
			}
		}
	});

	wait.textContent = "Done!";
	console.timeEnd('chart');

	return dyCpuMem;
}

export {makeChart, prepData};
