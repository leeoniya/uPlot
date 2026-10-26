import {SERIES} from './common.mjs';
import {handle, live, trackGL, ready, destroy, failedCreation, done, pixelRatio, countSeries} from './custom-common.mjs';
import {frame, domains, canvas, PLOT_WIDTH, PLOT_HEIGHT} from './custom-d3-frame.mjs';

export const prepData = frame => ({x: [...frame.x], ys: frame.ys.map(ys => [...ys])});

function layers(chart, input) {
	domains(chart, input);
	return SERIES.map(({id, color}, i) => {
		const path = new Float64Array(input.x.length * 2);
		for (let j = 0; j < input.x.length; j++) {
			path[2 * j] = chart.x(input.x[j]);
			path[2 * j + 1] = chart.y(input.ys[i][j]);
		}
		const c = d3.color(color);
		return new deck.PathLayer({
			id: `${chart.element.id}-${id}`, data: [path], getPath: path => path,
			positionFormat: 'XY', coordinateSystem: deck.COORDINATE_SYSTEM.CARTESIAN,
			getColor: [c.r, c.g, c.b, 255], widthUnits: 'pixels', getWidth: 1 / pixelRatio(), widthMinPixels: 0,
			pickable: false, parameters: {depthCompare: 'always', depthWriteEnabled: false},
		});
	});
}

function rendered(chart, resolve) {
	return ({gl}) => {
		try {
			if (gl !== chart.context) throw new Error('deck.gl did not use the supplied WebGL2 context.');
			live(chart);
			gl.flush();
			resolve();
		}
		catch (error) { chart.fail(error); }
	};
}

export async function makeChart(input, host, wait) {
	if (!globalThis.deck) throw new Error('Dashboard requires deck.gl@9.4.0.');
	const chart = handle(host, 'deck.gl');
	try {
		frame(chart);
		const node = canvas(chart);
		const gl = node.getContext('webgl2', {antialias: true, depth: false});
		if (!gl) throw new Error('deck.gl: WebGL2 unavailable; check browser context limits.');
		trackGL(chart, gl, node, true);
		await ready(chart, resolve => {
			chart.onRender = rendered(chart, resolve);
			return () => { chart.onRender = null; };
		}, () => {
			chart.instance = new deck.Deck({
				canvas: node, gl, width: PLOT_WIDTH, height: PLOT_HEIGHT, useDevicePixels: pixelRatio(),
				views: new deck.OrthographicView({id: `${chart.element.id}-view`, flipY: true}),
				viewState: {target: [PLOT_WIDTH / 2, PLOT_HEIGHT / 2, 0], zoom: 0},
				controller: false, layers: layers(chart, input), onError: chart.fail,
				onAfterRender: event => chart.onRender?.(event),
			});
		});
		done(wait);
		return chart;
	}
	catch (error) { failedCreation(chart, error, destroyChart); }
}

export async function updateChart(chart, input, host, wait) {
	await ready(chart, resolve => {
		chart.onRender = rendered(chart, resolve);
		return () => { chart.onRender = null; };
	}, () => {
		chart.instance.setProps({layers: layers(chart, input)});
		chart.instance.redraw(true);
	});
	done(wait);
}

export function validateChart(chart, input, {rows}) {
	live(chart);
	const native = chart.instance.props.layers;
	countSeries(native, rows, layer => layer.props.data.length === 1 ? layer.props.data[0].length / 2 : -1);
	native.forEach((layer, i) => {
		const path = layer.props.getPath(layer.props.data[0]);
		for (let j = 0; j < rows; j++) {
			if (path[j * 2] !== chart.x(input.x[j]) || path[j * 2 + 1] !== chart.y(input.ys[i][j]))
				throw new Error('deck.gl native path differs from dashboard input.');
		}
	});
	return true;
}

export function destroyChart(chart) { destroy(chart, [() => chart.instance?.finalize()]); }
