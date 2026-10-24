import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as plotly from '../../bench/plotly.mjs';
import * as plotlySvg from '../../bench/plotly-svg.mjs';
import * as canvasjs from '../../bench/canvasjs.mjs';
import * as zingchart from '../../bench/zingchart.mjs';

const packed = Object.freeze(JSON.parse(readFileSync(new URL('../../bench/data.json', import.meta.url))));
const modules = {plotly, canvasjs, zingchart};

function point(name, data, series, row) {
	return name === 'plotly' ? [data[0][row], data[series + 1][row]] :
		name === 'canvasjs' ? [data[series][row].x, data[series][row].y] : data[series][row];
}

describe('additional benchmark adapters B', () => {
	const saved = new Map();
	beforeEach(() => {
		for (const key of ['Plotly', 'CanvasJS', 'zingchart', 'devicePixelRatio'])
			saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		globalThis.devicePixelRatio = 2;
	});
	afterEach(() => {
		for (const [key, descriptor] of saved) {
			if (descriptor)
				Object.defineProperty(globalThis, key, descriptor);
			else
				delete globalThis[key];
		}
	});

	for (const [name, source] of Object.entries(modules)) {
		it(`${name}: preserves all 55,550 rows and prepares independent data without mutation`, () => {
			assert.deepEqual(Object.keys(source).filter(key => key !== 'makeEmptyChart' && key !== 'updateChart').sort(), name === 'plotly' ?
				['destroyChart', 'makeChart', 'makeChartWithOptions', 'prepData'] : ['destroyChart', 'makeChart', 'prepData']);
			const first = source.prepData(packed);
			const second = source.prepData(packed);
			assert.equal(first[0].length, 55550);
			assert.notEqual(first, second);
			for (let row = 0, i = packed[0] + 1; i < packed.length; row++, i += packed[0]) {
				const x = packed[i] * 60000;
				const values = [Math.round((100 - packed[i + 1]) * 1000) / 1000,
					Math.round(100 * packed[i + 5] / (packed[i + 5] + packed[i + 6]) * 100) / 100,
					packed[i + 3]];
				for (let s = 0; s < 3; s++)
					assert.deepEqual(point(name, first, s, row), [x, values[s]]);
			}
			if (name === 'plotly') first[1][0] = -1;
			else if (name === 'canvasjs') first[0][0].y = -1;
			else first[0][0][1] = -1;
			assert.notEqual(point(name, second, 0, 0)[1], -1);
		});
	}

	it('CanvasJS and ZingChart retain explicit timestamps for irregular input', () => {
		const fields = packed[0];
		const irregular = packed.slice(0, fields + 1 + 3 * fields);
		irregular[fields + 1 + 2 * fields] += 9;
		Object.freeze(irregular);
		for (const name of ['canvasjs', 'zingchart']) {
			const data = modules[name].prepData(irregular);
			for (let s = 0; s < 3; s++) {
				assert.equal(point(name, data, s, 1)[0] - point(name, data, s, 0)[0], 60000);
				assert.equal(point(name, data, s, 2)[0] - point(name, data, s, 1)[0], 600000);
			}
		}
	});

	for (const [name, source, type] of [['GL', plotly, 'scattergl'], ['SVG', plotlySvg, 'scatter']]) {
		it(`Plotly ${name} awaits newPlot, uses two autoranged y axes, and purges`, async () => {
			const host = {id: 'benchmark-plotly'}, wait = {};
			const data = source.prepData(packed);
			let finish, purged;
			globalThis.Plotly = {
				newPlot(target, traces, layout, config) {
					assert.equal(target, host);
					assert.equal(layout.width, 1920);
					assert.equal(layout.height, 600);
					assert.deepEqual(layout.xaxis.range, [data[0][0], data[0].at(-1)]);
					assert.deepEqual(traces.map(t => t.yaxis), ['y', 'y', 'y2']);
					assert.equal(layout.yaxis2.overlaying, 'y');
					for (const axis of [layout.yaxis, layout.yaxis2]) {
						assert.equal(axis.autorange, true);
						assert.equal(axis.range, undefined);
					}
					for (const [i, trace] of traces.entries()) {
						assert.equal(trace.type, type);
						assert.equal(trace.y, data[i + 1]);
						assert.ok(trace.x instanceof Float64Array);
						assert.ok(trace.y instanceof Float64Array);
						assert.equal(Object.hasOwn(trace.line, 'simplify'), false);
						assert.equal(trace.mode, 'lines');
						assert.equal(trace.x, data[0]);
						assert.equal(trace.line.width, 0.5);
					}
					assert.equal(layout.transition.duration, 0);
					assert.equal(config.plotGlPixelRatio, 2);
					return new Promise(resolve => { finish = resolve; });
				},
				purge(target) { purged = target; },
			};
			const pending = source.makeChart(data, host, wait, {type: 'not-a-renderer'});
			await Promise.resolve();
			assert.notEqual(wait.textContent, 'Done!');
			finish(host);
			assert.equal(await pending, host);
			assert.equal(wait.textContent, 'Done!');
			source.destroyChart(host);
			assert.equal(purged, host);
			for (const async of [false, true]) {
				const error = new Error('newPlot failed');
				purged = null;
				Plotly.newPlot = () => { if (async) return Promise.reject(error); throw error; };
				const failedWait = {textContent: 'Rendering...'};
				await assert.rejects(source.makeChart(data, host, failedWait), e => e === error);
				assert.equal(failedWait.textContent, 'Rendering...');
				assert.equal(purged, host);
			}
		});
	}

	it('Plotly SVG shares prep and cleanup and changes only the trace type', async () => {
		assert.equal(plotlySvg.prepData, plotly.prepData);
		assert.equal(plotlySvg.destroyChart, plotly.destroyChart);
		const data = plotly.prepData(packed);
		const host = {};
		const calls = [];
		globalThis.Plotly = {
			newPlot(target, traces, layout, config) {
				calls.push({traces, layout, config});
				for (const [i, trace] of traces.entries()) {
					assert.equal(trace.x, data[0]);
					assert.equal(trace.y, data[i + 1]);
				}
				return Promise.resolve(target);
			},
		};
		await plotly.makeChart(data, host);
		await plotlySvg.makeChart(data, host);
		assert.deepEqual(calls[1], {
			...calls[0],
			traces: calls[0].traces.map(trace => ({...trace, type: 'scatter'})),
		});
	});

	it('CanvasJS returns synchronously after render, uses two axes, and destroys on failure', () => {
		const host = {id: 'benchmark-canvasjs'}, wait = {};
		const data = canvasjs.prepData(packed);
		let rendered = false, destroyed = false, fail = false;
		globalThis.CanvasJS = {Chart: class {
			constructor(target, options) {
				assert.equal(target, host);
				assert.equal(options.animationEnabled, false);
				assert.equal(options.width, 1920);
				assert.equal(options.height, 600);
				assert.deepEqual(options.data.map(s => s.axisYType), ['primary', 'primary', 'secondary']);
				for (const axis of [options.axisX ?? {}, options.axisY, options.axisY2]) {
					assert.equal(axis.minimum, undefined);
					assert.equal(axis.maximum, undefined);
				}
				for (const [i, series] of options.data.entries()) {
					assert.equal(series.markerSize, 0);
					assert.equal(series.type, 'line');
					assert.equal(series.dataPoints, data[i]);
					assert.equal(series.dataPoints.length, 55550);
				}
			}
			render() { if (fail) throw new Error('render failed'); rendered = true; }
			destroy() { destroyed = true; }
		}};
		const chart = canvasjs.makeChart(data, host, wait);
		assert.equal(chart.then, undefined);
		assert.equal(rendered, true);
		assert.equal(wait.textContent, 'Done!');
		canvasjs.destroyChart(chart);
		assert.equal(destroyed, true);
		fail = true;
		destroyed = false;
		assert.throws(() => canvasjs.makeChart(data, host, {}), /render failed/);
		assert.equal(destroyed, true);
	});

	for (const outcome of ['complete', 'error', 'throw', 'sync-complete']) {
		it(`ZingChart handles ${outcome}, removes listeners, and uses the parent host`, async () => {
			const host = {id: 'benchmark-zingchart'}, wait = {};
			const data = zingchart.prepData(packed);
			const events = new Map();
			let destroyed = false;
			const error = new Error('render failed');
			globalThis.zingchart = {
				bind(id, event, fn) { assert.equal(id, host.id); events.set(event, fn); },
				unbind(id, event, fn) { assert.equal(events.get(event), fn); events.delete(event); },
				exec(id, command) { assert.equal(id, host.id); assert.equal(command, 'destroy'); destroyed = true; },
				render(options) {
					assert.equal(events.size, 2);
					assert.equal(options.id, host.id);
					assert.equal(options.output, 'canvas');
					assert.equal(options.width, 1920);
					assert.equal(options.height, 600);
					const config = options.data;
					assert.equal(config.plot.mode, 'fast');
					assert.equal(config.plot['sampling-step'], 1);
					assert.equal(config.plot.marker.visible, false);
					assert.equal(config.plot['max-trackers'], 0);
					assert.deepEqual(config.plot.animation, {effect: 0, speed: 0});
					assert.equal(config.tooltip.visible, false);
					for (const [i, series] of config.series.entries()) {
						assert.equal(series.values, data[i]);
						assert.equal(series.values.length, 55550);
					}
					assert.equal(config['scale-x'].values, undefined);
					assert.deepEqual(config.series.map(s => s.scales),
						['scale-x,scale-y', 'scale-x,scale-y', 'scale-x,scale-y-2']);
					for (const axis of [config['scale-x'], config['scale-y'], config['scale-y-2']]) {
						assert.equal(axis['min-value'], undefined);
						assert.equal(axis['max-value'], undefined);
					}
					if (outcome === 'throw') throw error;
					if (outcome === 'sync-complete') events.get('complete')();
				},
			};
			const pending = zingchart.makeChart(data, host, wait);
			assert.ok(pending instanceof Promise);
			assert.notEqual(wait.textContent, 'Done!');
			if (outcome === 'error') events.get('error')({error});
			if (outcome === 'complete') events.get('complete')();
			if (outcome === 'complete' || outcome === 'sync-complete') {
				assert.equal(await pending, host);
				assert.equal(wait.textContent, 'Done!');
				assert.equal(destroyed, false);
				zingchart.destroyChart(host);
			}
			else {
				await assert.rejects(pending, /render failed/);
				assert.notEqual(wait.textContent, 'Done!');
			}
			assert.equal(events.size, 0);
			assert.equal(destroyed, true);
		});
	}
});
