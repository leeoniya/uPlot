import {stackLayers, stackDimensions, stackDomain, strokeWidth, fillOpacity} from './lib/stackedSeriesData.js';

const keys = ['A', 'B', 'C', 'D', 'negA', 'negB', 'negC', 'negD'];

export function prepareData(raw, layers = stackLayers(raw)) {
	return Array.from(raw[0], (x, i) => {
		const row = {x};
		layers.forEach((layer, j) => { row[keys[j]] = layer.values[i]; });
		return row;
	});
}

export function buildChart(raw, React, Recharts) {
	const h = React.createElement;
	const layers = stackLayers(raw);
	return h(Recharts.AreaChart, {
		width: stackDimensions.width,
		height: stackDimensions.height,
		data: prepareData(raw, layers),
		stackOffset: 'none',
		accessibilityLayer: false,
		tabIndex: -1,
		margin: {top: 20, right: 25, bottom: 10, left: 0},
	},
		h(Recharts.CartesianGrid, {stroke: 'rgba(0,0,0,0.1)'}),
		h(Recharts.XAxis, {
			dataKey: 'x',
			type: 'number',
			scale: 'linear',
			domain: [...stackDomain.x],
			allowDataOverflow: true,
			ticks: Array.from({length: 11}, (_, i) => i * 2),
		}),
		h(Recharts.YAxis, {
			type: 'number',
			scale: 'linear',
			domain: [-stackDomain.y[1], stackDomain.y[1]],
			allowDataOverflow: true,
			ticks: Array.from({length: 9}, (_, i) => (i - 4) * 4),
		}),
		h(Recharts.Legend, {itemSorter: null}),
		// Each stackId accumulates outward from zero, in A–D order.
		...layers.map((series, i) => h(Recharts.Area, {
			key: keys[i],
			dataKey: keys[i],
			name: series.label,
			stackId: series.group,
			type: 'linear',
			stroke: series.stroke,
			strokeWidth,
			fill: series.stroke,
			fillOpacity,
			dot: false,
			activeDot: false,
			isAnimationActive: false,
		})),
	);
}

export async function createDemo(host, data, Library) {
	const {React, ReactDOM, ReactDOMClient, Recharts} = Library ?? {};
	if (!React?.createElement || !ReactDOM?.flushSync || !ReactDOMClient?.createRoot || !Recharts?.AreaChart || !Recharts.Legend)
		throw new Error('Recharts did not load');

	const element = host.ownerDocument.createElement('div');
	const win = host.ownerDocument.defaultView;
	host.appendChild(element);
	let plot;

	function destroy() {
		try {
			if (plot)
				ReactDOM.flushSync(() => plot.unmount());
		}
		finally {
			plot = null;
			element.remove();
		}
	}

	try {
		// Recharts can commit its paths after the initial React render.
		await new Promise((resolve, reject) => {
			const observer = new win.MutationObserver(check);
			const timer = win.setTimeout(() => finish(new Error('Recharts did not render eight stacked areas')), 10000);

			function finish(error) {
				observer.disconnect();
				win.clearTimeout(timer);
				if (error)
					reject(error);
				else
					resolve();
			}

			function check() {
				const complete = ['path.recharts-area-area', 'path.recharts-area-curve'].every(selector => {
					const paths = element.querySelectorAll(selector);
					return paths.length === keys.length && [...paths].every(path => {
						const d = path.getAttribute('d');
						return d && d.includes('L') && !/NaN|Infinity/.test(d);
					});
				});
				if (complete)
					finish();
			}

			observer.observe(element, {subtree: true, childList: true, attributes: true});
			try {
				plot = ReactDOMClient.createRoot(element, {onUncaughtError: finish});
				ReactDOM.flushSync(() => plot.render(buildChart(data, React, Recharts)));
				check();
			}
			catch (error) {
				finish(error);
			}
		});
	}
	catch (error) {
		try { destroy(); }
		finally { throw error; }
	}

	return {plot, destroy};
}
