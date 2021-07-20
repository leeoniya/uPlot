function stack(data, omit) {
	let data2 = [];
	let bands = [];
	let d0Len = data[0].length;
	let accum = Array(d0Len);

	for (let i = 0; i < d0Len; i++)
		accum[i] = 0;

	for (let i = 1; i < data.length; i++)
		data2.push(omit(i) ? data[i] : data[i].map((v, i) => (accum[i] += +v)));

	for (let i = 1; i < data.length; i++)
		!omit(i) && bands.push({
			series: [
				data.findIndex((s, j) => j > i && !omit(j)),
				i,
			],
		});

	bands = bands.filter(b => b.series[1] > -1);

	return {
		data: [data[0]].concat(data2),
		bands,
	};
}

function getOpts(title, series) {
	return {
		scales: {
			x: {
				time: false,
			},
		},
		series
	};
}

function getStackedOpts(title, series, data, interp) {
	let opts = getOpts(title, series);

	let interped = interp ? interp(data) : data;

	let stacked = stack(interped, i => false);
	opts.bands = stacked.bands;

	opts.cursor = opts.cursor || {};
	opts.cursor.dataIdx = (u, seriesIdx, closestIdx, xValue) => {
		return data[seriesIdx][closestIdx] == null ? null : closestIdx;
	};

	opts.series.forEach(s => {
		s.value = (u, v, si, i) => data[si][i];

		s.points = s.points || {};

	    // scan raw unstacked data to return only real points
		s.points.filter = (u, seriesIdx, show, gaps) => {
			if (show) {
				let pts = [];
				data[seriesIdx].forEach((v, i) => {
					v != null && pts.push(i);
				});
				return pts;
			}
		}
	});

	// force 0 to be the sum minimum this instead of the bottom series
	opts.scales.y = {
		range: (u, min, max) => {
			let minMax = uPlot.rangeNum(0, max, 0.1, true);
			return [0, minMax[1]];
		}
	};

	// restack on toggle
	opts.hooks = {
		setSeries: [
			(u, i) => {
				let stacked = stack(data, i => !u.series[i].show);
				u.delBand(null);
				stacked.bands.forEach(b => u.addBand(b));
				u.setData(stacked.data);
			}
		],
	};

	return {opts, data: stacked.data};
}