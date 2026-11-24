import {
	createStackedSeriesData,
	stackLayers,
	stackDimensions,
	stackDomain,
	strokeWidth,
	fillOpacity,
} from './lib/stackedSeriesData.js';

export function prepareData(raw = createStackedSeriesData(), layers = stackLayers(raw)) {
	return Array.from(raw[0], (x, i) => ({x, ...Object.fromEntries(layers.map(layer => [layer.label, layer.values[i]]))}));
}

export async function createDemo(host, data = createStackedSeriesData(), Library = globalThis) {
	const {am5, am5xy} = Library ?? {};
	if (am5?.Root == null || am5xy?.LineSeries == null || am5xy.ValueAxis == null)
		throw new Error('amCharts did not load');

	host.style.width = `${stackDimensions.width}px`;
	host.style.height = `${stackDimensions.height}px`;
	const plot = am5.Root.new(host);
	let frameListener;
	let timer;

	try {
		plot.autoResize = false;
		const chart = plot.container.children.push(am5xy.XYChart.new(plot, {
			layout: plot.verticalLayout,
			panX: false,
			panY: false,
			wheelX: 'none',
			wheelY: 'none',
			pinchZoomX: false,
			pinchZoomY: false,
			interactive: false,
			interactiveChildren: false,
			focusable: false,
			stateAnimationDuration: 0,
		}));
		chart.zoomOutButton.setAll({forceHidden: true, interactive: false, focusable: false});
		chart.plotContainer.setAll({interactive: false, interactiveChildren: false, focusable: false});

		const axisOptions = {
			strictMinMax: true,
			extraMin: 0,
			extraMax: 0,
			zoomable: false,
			interpolationDuration: 0,
			stateAnimationDuration: 0,
			interactive: false,
			focusable: false,
		};
		const xAxis = chart.xAxes.push(am5xy.ValueAxis.new(plot, {
			...axisOptions,
			min: stackDomain.x[0],
			max: stackDomain.x[1],
			renderer: am5xy.AxisRendererX.new(plot, {minGridDistance: 70, pan: 'none'}),
		}));
		const yAxis = chart.yAxes.push(am5xy.ValueAxis.new(plot, {
			...axisOptions,
			min: -stackDomain.y[1],
			max: stackDomain.y[1],
			renderer: am5xy.AxisRendererY.new(plot, {minGridDistance: 40, pan: 'none'}),
		}));

		const layers = stackLayers(data);
		const rows = prepareData(data, layers);
		layers.forEach((item, i) => {
			const series = chart.series.push(am5xy.LineSeries.new(plot, {
				name: item.label,
				xAxis,
				yAxis,
				baseAxis: xAxis,
				valueXField: 'x',
				valueYField: item.label,
				// An unstacked base starts a new stack on the same axes. Don't sign-test zeros.
				stacked: item.group === layers[i - 1]?.group,
				stackToNegative: false,
				stroke: am5.color(item.stroke),
				fill: am5.color(item.stroke),
				minDistance: 0,
				interpolationDuration: 0,
				stateAnimationDuration: 0,
				interactive: false,
				focusable: false,
			}));
			series.strokes.template.setAll({strokeWidth, interactive: false, focusable: false});
			series.fills.template.setAll({visible: true, fillOpacity, interactive: false, focusable: false});
			series.data.setAll(rows);
		});

		const legend = chart.children.push(am5.Legend.new(plot, {width: am5.p100, clickTarget: 'none'}));
		legend.data.setAll(chart.series.values);

		await new Promise((resolve, reject) => {
			timer = setTimeout(() => reject(new Error('amCharts did not finish rendering')), 15000);
			frameListener = plot.events.on('frameended', () => {
				// In 5.21.4, the root clears animationTime after the final frame event.
				queueMicrotask(() => {
					if (plot.animationTime === null)
						resolve();
				});
			});
		});

		return {
			plot,
			destroy() {
				plot.dispose();
			},
		};
	}
	catch (error) {
		plot.dispose();
		throw error;
	}
	finally {
		clearTimeout(timer);
		frameListener?.dispose();
	}
}
