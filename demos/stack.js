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


function stack2(series) {
	// for uplot data
	let data = Array(series.length);
	let bands = [];

	let dataLen = series[0].values.length;

	let zeroArr = Array(dataLen).fill(0);

	let stackGroups = new Map();
	let seriesStackKeys = Array(series.length);

	series.forEach((s, si) => {
		let vals = s.values.slice();

		// apply negY
		if (s.negY) {
			for (let i = 0; i < vals.length; i++) {
				if (vals[i] != null)
					vals[i] *= -1;
			}
		}

		if (s.stacking.mode != 'none') {
			let hasPos = vals.some(v => v > 0);
			// derive stacking key
			let stackKey = seriesStackKeys[si] = s.stacking.mode + s.scaleKey + s.stacking.group + (hasPos ? '+' : '-');
			let group = stackGroups.get(stackKey);

			// initialize stacking group
			if (group == null) {
				group = {
					series: [],
					acc: zeroArr.slice(),
					dir: hasPos ? -1 : 1,
				};
				stackGroups.set(stackKey, group);
			}

			// push for bands gen
			group.series.unshift(si);

			let stacked = data[si] = Array(dataLen);
			let { acc } = group;

			for (let i = 0; i < dataLen; i++) {
				let v = vals[i];

				if (v != null)
					stacked[i] = (acc[i] += v);
				else
					stacked[i] = v; // we may want to coerce to 0 here
			}
		}
		else
			data[si] = vals;
	});

	// re-compute by percent
	series.forEach((s, si) => {
		if (s.stacking.mode == 'percent') {
			let group = stackGroups.get(seriesStackKeys[si]);
			let { acc } = group;

			// re-negatify percent
			let sign = group.dir * -1;

			let stacked = data[si];

			for (let i = 0; i < dataLen; i++) {
				let v = stacked[i];

				if (v != null)
					stacked[i] = sign * (v / acc[i]);
			}
		}
	});

	// generate bands between adjacent group series
	stackGroups.forEach(group => {
		let { series, dir } = group;
		let lastIdx = series.length - 1;

		series.forEach((si, i) => {
			if (i != lastIdx) {
				let nextIdx = series[i + 1];
				bands.push({
					// since we're not passing x series[0] for stacking, real idxs are actually +1
					series: [si + 1, nextIdx + 1],
					dir,
				});
			}
		});
	});

	return {
		data,
		bands,
	};
}