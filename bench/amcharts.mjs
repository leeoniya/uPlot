// @amcharts/amcharts5 5.21.4; browser globals: am5, am5xy.
// Minified standalone builds (the npm entry points require a bundler):
// https://cdn.jsdelivr.net/gh/amcharts/amcharts5-dist@5.21.4/index.js
// https://cdn.jsdelivr.net/gh/amcharts/amcharts5-dist@5.21.4/xy.js
// Free linkware use requires the original LICENSE and unmodified branding.
// https://www.amcharts.com/docs/v5/getting-started/root-element/

export function prepData(packed) {
	const fields = packed[0];
	const start = fields + 1;
	const data = new Array((packed.length - start) / fields);

	for (let i = start, j = 0; i < packed.length; i += fields, j++) {
		data[j] = {
			date: packed[i] * 60000,
			cpu: Math.round((100 - packed[i + 1]) * 1000) / 1000,
			ram: Math.round(100 * packed[i + 5] / (packed[i + 5] + packed[i + 6]) * 100) / 100,
			tcp: packed[i + 3],
		};
	}

	return data;
}

function staticBranding(root, version) {
	const logo = root._logo;
	if (!logo)
		return;
	// Requested private-API exception: review branding/license terms before publishing results.
	// 5.21.4 hard-codes a delayed entrance animation, outside theme settings.
	// Keep its final graphics, click handler, tooltip, and hover states intact.
	if (version !== '5.21.4' || logo.children.length !== 2)
		throw new Error('Review the static amCharts branding adapter for this library version.');
	logo.children.each(glyph => {
		const animate = glyph.animate;
		glyph.animate = function(options) {
			return animate.call(this, options.key === 'dx' || options.key === 'strokeOpacity'
				? {...options, duration: 0} : options);
		};
		// The original delayed callback now reapplies this state without animation.
		glyph.setAll({dx: 0, strokeOpacity: 1});
	});
}

export function makeChart(data, host, wait, runtimeOptions) {
	return makeChartWithOptions(data, host, wait, runtimeOptions);
}

export async function makeChartWithOptions(data, host, wait, runtimeOptions, {sampling = false} = {}) {
	const {am5, am5xy} = globalThis;
	if (!am5 || !am5xy)
		throw new Error('Load the amCharts 5.21.4 index.js and xy.js browser bundles before makeChart().');

	const root = am5.Root.new(host);
	try {
		root.autoResize = false;
		staticBranding(root, am5.registry.version);
		// The default theme has no series animations. Do not load Animated or call appear().
		const chart = root.container.children.push(am5xy.XYChart.new(root, {
			layout: root.verticalLayout,
		}));
		const xAxis = chart.xAxes.push(am5xy.DateAxis.new(root, {
			baseInterval: {timeUnit: 'minute', count: 1},
			groupData: sampling,
			...(sampling ? {
				groupCount: 1920,
				groupIntervals: [
					{timeUnit: 'minute', count: 1},
					{timeUnit: 'minute', count: 10},
					{timeUnit: 'hour', count: 1},
				],
			} : {}),
			interpolationDuration: 0,
			renderer: am5xy.AxisRendererX.new(root, {}),
		}));
		const percentAxis = chart.yAxes.push(am5xy.ValueAxis.new(root, {
			numberFormat: "#' %'",
			interpolationDuration: 0,
			renderer: am5xy.AxisRendererY.new(root, {opposite: false}),
		}));
		const tcpAxis = chart.yAxes.push(am5xy.ValueAxis.new(root, {
			numberFormat: "#' MB'",
			interpolationDuration: 0,
			renderer: am5xy.AxisRendererY.new(root, {opposite: true}),
		}));

		for (const [name, field, yAxis, color] of [
			['CPU', 'cpu', percentAxis, 0xff0000],
			['RAM', 'ram', percentAxis, 0x0000ff],
			['TCP Out', 'tcp', tcpAxis, 0x008000],
		]) {
			const series = chart.series.push(am5xy.LineSeries.new(root, {
				name,
				xAxis,
				yAxis,
				valueXField: 'date',
				valueYField: field,
				stroke: am5.color(color),
				fill: am5.color(color),
				interpolationDuration: 0,
				stateAnimationDuration: 0,
				...(sampling ? {valueYGrouped: 'average', minDistance: 1} : {
					// Keep every line segment at its original timestamp.
					minDistance: 0,
					exactLocationX: true,
				}),
			}));
			series.strokes.template.setAll({strokeWidth: 1});
			series.data.setAll(data);
		}

		const legend = chart.children.push(am5.Legend.new(root, {}));
		legend.data.setAll(chart.series.values);

		await new Promise(resolve => {
			// In 5.21.4 animationTime becomes null when the render loop has no work.
			// Check after frameended dispatch, not after an arbitrary debounce delay.
			const listener = root.events.on('frameended', () => {
				queueMicrotask(() => {
					if (root.animationTime === null) {
						listener.dispose();
						resolve();
					}
				});
			});
			root.addDisposer(listener);
		});

		if (wait)
			wait.textContent = 'Done!';
		return root;
	}
	catch (error) {
		root.dispose();
		throw error;
	}
}

export function makeEmptyChart(host, wait) {
	return makeChart([], host, wait);
}

export async function updateChart(root, input, host, wait) {
	const chart = root.container.children.getIndex(0);
	await new Promise((resolve, reject) => {
		const listener = root.events.on('frameended', () => {
			queueMicrotask(() => {
				if (root.animationTime === null) {
					listener.dispose();
					resolve();
				}
			});
		});
		try {
			chart.series.each(series => series.data.setAll(input));
		}
		catch (error) {
			listener.dispose();
			reject(error);
		}
	});
	if (wait) wait.textContent = 'Done!';
}

export function destroyChart(chart) {
	chart.dispose();
}
