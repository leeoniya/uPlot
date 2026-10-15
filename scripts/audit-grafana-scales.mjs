// Audit artifact, not a Mocha test. Node 26; uses existing dependencies only.
// Run: node scripts/audit-grafana-scales.mjs /absolute/path/to/grafana-main
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { isAbsolute, join } from 'node:path';
import './instrument.mjs';
import CurrentSource from '../src/uPlot.js';
import CurrentDist from '../dist/uPlot.esm.js';

const root = process.argv[2];
assert.ok(root && isAbsolute(root), 'Usage: node scripts/audit-grafana-scales.mjs /absolute/grafana/root');
const revision = 'e995b061e9fc5476a6d862cd2fb2ebc7452ca012';
const repository = new URL('../', import.meta.url);
const candidateHead = execFileSync('git', ['rev-parse', 'HEAD'], {
	cwd: repository,
	encoding: 'utf8',
	timeout: 10000,
}).trim();
const candidateStatus = execFileSync('git', [
	'--no-optional-locks', 'status', '--short', '--',
	'src/uPlot.js',
	'dist/uPlot.esm.js',
	'dist/uPlot.cjs.js',
	'dist/uPlot.iife.js',
	'dist/uPlot.iife.min.js',
	'dist/uPlot.d.ts',
], {
	cwd: repository,
	encoding: 'utf8',
	timeout: 10000,
}).trim();
const historical = execFileSync('git', ['--no-pager', 'show', `${revision}:dist/uPlot.esm.js`], {
	cwd: new URL('../', import.meta.url),
	encoding: 'utf8',
	timeout: 10000,
	maxBuffer: 4 * 1024 * 1024,
});
const { default: Old } = await import(`data:text/javascript;base64,${Buffer.from(historical).toString('base64')}`);
const sources = [];
const candidateArtifacts = [];

function candidateArtifact(path, tested) {
	const text = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
	candidateArtifacts.push({
		path,
		tested,
		sha256: createHash('sha256').update(text).digest('hex'),
	});
}

candidateArtifact('src/uPlot.js', 'behavior matrix');
candidateArtifact('dist/uPlot.esm.js', 'behavior matrix');
candidateArtifact('dist/uPlot.cjs.js', 'generated, identified');
candidateArtifact('dist/uPlot.iife.js', 'generated, identified');
candidateArtifact('dist/uPlot.iife.min.js', 'generated, identified');
candidateArtifact('dist/uPlot.d.ts', 'public declarations');

function source(path) {
	const text = readFileSync(join(root, path), 'utf8');
	sources.push({ path, sha256: createHash('sha256').update(text).digest('hex') });
	return text;
}

function between(text, start, end) {
	const a = text.indexOf(start);
	const b = text.indexOf(end, a + start.length);
	assert.ok(a >= 0 && b > a, `Source extraction failed: ${start} ... ${end}`);
	return text.slice(a + start.length, b).trim().replace(/,$/, '');
}

function evaluate(ts, bindings = {}) {
	const js = stripTypeScriptTypes(`(function() {\n${ts}\n})`, { mode: 'strip' });
	return Function(...Object.keys(bindings), `return ${js}();`)(...Object.values(bindings));
}

function callback(expression, bindings) {
	return evaluate(`return (${expression});`, bindings);
}

const timeSeries = between(
	source('public/app/core/components/TimeSeries/utils.ts'),
	'range: () =>',
	'\n    });',
);
const timeline = between(
	source('public/app/core/components/TimelineChart/utils.ts'),
	'range: (u) =>',
	'\n  });',
);
const numeric = between(
	source('packages/grafana-ui/src/graveyard/TimeSeries/utils.ts'),
	'range: (u, dataMin, dataMax) =>',
	'\n    });',
);
const histogramSource = source('public/app/plugins/panel/histogram/Histogram.tsx');
const histogram = between(histogramSource, 'range: useLogScale', '\n  });');
const helpers = evaluate(
	`${between(histogramSource, "from './panelcfg.gen';", 'export interface HistogramProps')}\nreturn { incrRoundUp, incrRoundDn };`,
);
const volume = between(source('public/app/plugins/panel/candlestick/CandlestickPanel.tsx'), 'opts.range = ', ';');
const builderSource = source('packages/grafana-ui/src/components/uPlot/config/UPlotScaleBuilder.ts');

// Actual scale builder, with a constructor-only base and schema constants as stubs.
// Helpers have the same ceil/floor definitions as Grafana data's histogram helpers.
const builderBindings = {
	PlotConfigBuilder: class {
		constructor(props) {
			this.props = props;
		}
	},
	ScaleDistribution: { Linear: 'linear', Ordinal: 'ordinal', Log: 'log', Symlog: 'symlog' },
	StackingMode: { None: 'none', Normal: 'normal', Percent: 'percent' },
	isBooleanUnit: unit => unit && unit.startsWith('bool'),
	...helpers,
};

function scaleBuilder(U) {
	return evaluate(
		`${builderSource.replace(/^import .*;\s*$/gm, '').replace(/^export /gm, '')}\nreturn UPlotScaleBuilder;`,
		{ ...builderBindings, uPlot: U },
	);
}

const versions = [
	{ name: 'npm-1.6.32', historical: true, U: Old, Builder: scaleBuilder(Old) },
	{ name: 'current-source', historical: false, U: CurrentSource, Builder: scaleBuilder(CurrentSource) },
	{ name: 'current-dist-esm', historical: false, U: CurrentDist, Builder: scaleBuilder(CurrentDist) },
];

function config(v, props) {
	return new v.Builder({
		orientation: 0,
		direction: 1,
		...props,
	}).getConfig()[props.scaleKey];
}
const flush = () => Promise.resolve();
const bounds = (u, key = 'x') => [u.scales[key].min, u.scales[key].max];

async function plot(v, scales, data, run) {
	const u = new v.U({
		width: 400,
		height: 200,
		ms: 1,
		axes: [],
		cursor: { show: false },
		legend: { show: false },
		scales: { ...scales, x: { time: false, ...scales.x } },
		series: [{}, { points: { show: false }, paths: () => null }],
	}, data, document.body);
	try {
		await flush();
		return await run(u);
	}
	finally {
		u.destroy();
	}
}

async function dragPlot(v, range, dragSetRange, data, run) {
	const u = new v.U({
		width: 400,
		height: 200,
		padding: [0, 0, 0, 0],
		axes: [],
		legend: { show: false },
		cursor: {
			drag: {
				x: true,
				y: false,
				setRange: dragSetRange,
			},
		},
		scales: { x: { time: false, range } },
		series: [{}, { points: { show: false }, paths: () => null }],
	}, data, document.body);

	try {
		await flush();

		const style = u.over.style;
		const box = () => new DOMRect(
			101 + parseFloat(style.left),
			203 + parseFloat(style.top),
			parseFloat(style.width),
			parseFloat(style.height),
		);
		u.over.getBoundingClientRect = box;

		let previous = null;
		function mouse(type, left, top, target = u.over) {
			const rect = box();
			const clientX = rect.left + left;
			const clientY = rect.top + top;
			const event = new MouseEvent(type, {
				bubbles: true,
				cancelable: true,
				button: 0,
				buttons: type == 'mouseup' ? 0 : 1,
				clientX,
				clientY,
			});
			Object.defineProperties(event, {
				movementX: { value: previous == null ? 0 : clientX - previous[0] },
				movementY: { value: previous == null ? 0 : clientY - previous[1] },
			});
			previous = [clientX, clientY];
			target.dispatchEvent(event);
		}

		const rect = box();
		const top = rect.height / 2;
		mouse('mousedown', rect.width / 10, top);
		mouse('mousemove', rect.width * 9 / 10, top);
		mouse('mouseup', rect.width * 9 / 10, top, document);
		await flush();

		return await run(u);
	}
	finally {
		u.destroy();
	}
}

const rows = [];
let failures = 0;

async function check(probe, version, expected, run) {
	let actual;
	try {
		actual = await run();
		assert.deepStrictEqual(actual, expected);
		rows.push({ probe, version, result: JSON.stringify(actual), status: 'PASS' });
	}
	catch (error) {
		failures++;
		rows.push({ probe, version, result: JSON.stringify(actual) ?? '(exception)', status: 'FAIL' });
		console.error(`${probe} / ${version}:`, error);
	}
}

for (const v of versions) {
	const old = v.historical;

	for (const [name, expression] of [
		['TimeSeries', `() => ${timeSeries}`],
		['Timeline', `(u) => ${timeline}`],
	]) {
		for (const migrate of old ? [false] : [false, true]) {
			// Stubs: mutable backend props, builder state, and Timeline coreConfig.xRange.
			let backend = [0, 100];
			let state = { isPanning: false, isTimeRangePending: false };
			const builder = {
				getState: () => state,
				setState: patch => Object.assign(state, patch),
			};
			const actualRange = callback(expression, {
				builder,
				getTimeRange: () => ({ from: backend[0], to: backend[1] }),
				coreConfig: { xRange: () => [...backend] },
			});
			const args = [];
			const x = config(v, {
				scaleKey: 'x',
				isTime: true,
				range: (u, min, max, key) => {
					args.push([min, max]);
					return actualRange(u, min, max, key);
				},
			});
			assert.equal(x.auto, false, 'Grafana time scale builder default');

			if (migrate) {
				Object.assign(x, { auto: true, scan: false });
			}

			const label = `${name}${migrate ? ' auto:true scan:false' : ' auto:false'}`;
			await check(`${label}: backend update`, v.name, old || migrate ? [100, 200] : [0, 100], () => {
				return plot(v, { x }, [[10, 90], [1, 2]], async u => {
					assert.deepStrictEqual(bounds(u), [0, 100]);
					backend = [100, 200];
					u.setData([[110, 190], [3, 4]]);
					await flush();

					if (migrate) {
						assert.deepStrictEqual(args, [[null, null], [null, null]], 'no data extrema passed to range');
					}
					else if (!old) {
						assert.equal(args.length, 1, 'retained concrete X bounds bypass callback');
					}

					return bounds(u);
				});
			});

			backend = [0, 100];
			args.length = 0;
			await check(
				`${label}: pending-pan ack`,
				v.name,
				{ bounds: [100, 200], isPanning: !(old || migrate) },
				() => {
					return plot(v, { x }, [[10, 90], [1, 2]], async u => {
						state = {
							isPanning: true,
							isTimeRangePending: true,
							min: 100,
							max: 200,
						};
						u.setScale('x', { min: 100, max: 200 });
						await flush();
						assert.equal(state.isPanning, true, 'backend has not acknowledged pan yet');
						backend = [100, 200];
						u.setData([[110, 190], [3, 4]]);
						await flush();

						if (migrate) {
							assert.ok(args.every(pair => pair[0] === null && pair[1] === null));
						}

						return { bounds: bounds(u), isPanning: state.isPanning };
					});
				},
			);
		}
	}

	function histogramRange(len, overrides = {}) {
		return callback(`useLogScale ${histogram}`, {
			uPlot: v.U,
			...helpers,
			bucketSize: 10,
			isOrdinalX: false,
			useLogScale: false,
			isOneValue: len === 1,
			bucketFactor: undefined,
			xScaleMin: undefined,
			xScaleMax: undefined,
			...overrides,
		});
	}

	for (const [start, previous, current] of [
		[5, [0, 10], [10, 10]],
		[10, [0, 20], [10, 20]],
		[100, [0, 10], [100, 10]],
		[-10, [-20, 10], [-10, 10]],
	]) {
		await check(`Histogram singleton ${start}`, v.name, old ? previous : current, () => {
			const x = config(v, { scaleKey: 'x', range: histogramRange(1) });
			return plot(v, { x }, [[start], [1]], u => bounds(u));
		});

		if (!old) {
			const original = histogramRange(1);
			// Proposed migration for numeric, linear singleton buckets without overrides.
			// Return actual bucket bounds BEFORE the legacy zero-origin snap, not merely wantedMax += size.
			const migrated = (u, min, max) => {
				if (u.data[0].length === 1) {
					return [u.data[0][0], u.data[0][0] + 10];
				}

				return original(u, min, max);
			};
			await check(
				`Histogram singleton ${start}: dedicated bounds branch`,
				v.name,
				[start, start + 10],
				() => {
					return plot(v, { x: { range: migrated } }, [[start], [1]], u => bounds(u));
				},
			);
		}
	}

	for (const overrides of [false, true]) {
		const rangeArgs = [];
		const range = histogramRange(3, overrides ? { xScaleMin: 0, xScaleMax: 30 } : {});
		const x = {
			range: (u, min, max) => {
				rangeArgs.push([min, max]);
				return range(u, min, max);
			},
		};
		await check(
			`Histogram programmatic setScale [3,27]${overrides ? ' with overrides [0,30]' : ''}`,
			v.name,
			old ? (overrides ? [0, 30] : [10, 20]) : [3, 27],
			() => {
				return plot(v, { x }, [[0, 10, 20], [1, 2, 3]], async u => {
					assert.deepStrictEqual(bounds(u), [0, 30]);
					rangeArgs.length = 0;
					u.setScale('x', { min: 3, max: 27 });
					await flush();
					assert.equal(rangeArgs.length, old ? 1 : 0, 'explicit X range callback invocation');
					return bounds(u);
				});
			},
		);

		if (!old) {
			const dragArgs = [];
			await check(
				`Histogram drag setRange callback [3,27]${overrides ? ' with overrides [0,30]' : ''}`,
				v.name,
				overrides ? [0, 30] : [10, 20],
				() => {
					return dragPlot(
						v,
						range,
						(self, scaleKey, min, max) => {
							dragArgs.push([scaleKey, min, max]);
							if (scaleKey != 'x')
								return [min, max];

							return range(self, min, max);
						},
						[[0, 10, 20], [1, 2, 3]],
						u => {
							assert.equal(dragArgs.length, 1, 'one drag setRange callback invocation');
							assert.equal(dragArgs[0][0], 'x');
							assert.ok(Math.abs(dragArgs[0][1] - 3) < 1e-9, 'drag setRange minimum');
							assert.ok(Math.abs(dragArgs[0][2] - 27) < 1e-9, 'drag setRange maximum');
							return bounds(u);
						},
					);
				},
			);
		}
	}

	if (!old) {
		let rangeCalls = 0;
		await check('Public setRange applies concrete bounds', v.name, [3, 27], () => {
			return plot(v, {
				x: {
					range: (u, min, max) => {
						rangeCalls++;
						return [min, max];
					},
				},
			}, [[0, 10, 20, 30], [1, 2, 3, 4]], async u => {
				rangeCalls = 0;
				u.setRange('x', 3, 27);
				await flush();
				assert.equal(rangeCalls, 0, 'setRange bypasses scale.range');
				return bounds(u);
			});
		});
	}

	const numericRange = callback(`(u, dataMin, dataMax) => ${numeric}`, {
		xField: { config: {} },
	});
	await check('Graveyard numeric singleton 10', v.name, old ? [0, 20] : [10, 10], () => {
		return plot(v, { x: { range: numericRange } }, [[10], [1]], u => bounds(u));
	});

	let yCalls = 0;
	const zoomY = {
		range: () => {
			yCalls++;
			return [0, 100];
		},
	};
	await check('Control: nonempty Y concrete zoom', v.name, [3, 27], () => {
		return plot(v, { y: zoomY }, [[0, 10], [10, 20]], async u => {
			yCalls = 0;
			u.setScale('y', { min: 3, max: 27 });
			await flush();
			assert.equal(yCalls, 0, 'Y concrete zoom already bypassed range historically');
			return bounds(u, 'y');
		});
	});

	const fixedY = config(v, { scaleKey: 'y', min: 0, max: 100 });
	assert.equal(fixedY.auto, false, 'Grafana fixed-range builder default');
	await check('Control: fixed Y zoom retained on setData', v.name, [30, 70], () => {
		return plot(v, { y: fixedY }, [[0, 10], [10, 20]], async u => {
			assert.deepStrictEqual(bounds(u, 'y'), [0, 100]);
			u.setScale('y', { min: 30, max: 70 });
			await flush();
			assert.deepStrictEqual(bounds(u, 'y'), [30, 70], 'concrete Y zoom');
			u.setData([[0, 10], [-500, 500]]);
			await flush();
			return bounds(u, 'y');
		});
	});

	const volumeArgs = [];
	const volumeRange = callback(volume);
	const volumeY = {
		auto: false,
		range: (u, min, max) => {
			volumeArgs.push([min, max]);
			return volumeRange(u, min, max);
		},
	};
	await check('Control: volume auto:false (preexisting)', v.name, [0, 0], () => {
		return plot(v, { y: volumeY }, [[0, 10], [10, 20]], u => {
			assert.deepStrictEqual(volumeArgs, [[null, null]], 'disabled Y scanning passes null max');
			return bounds(u, 'y');
		});
	});
}

console.log(`Grafana root: ${root}`);
console.log(`Historical baseline: npm 1.6.32 (${revision})`);
console.log(`Candidate HEAD: ${candidateHead}`);
console.log(`Candidate working tree: ${candidateStatus || 'clean for identified artifacts'}`);
console.log('Grafana source artifacts:');
console.table(sources);
console.log('Candidate artifacts:');
console.table(candidateArtifacts);
console.table(rows);
console.log(`Assertions: ${rows.length - failures}/${rows.length} probes passed; ${failures} failed.`);
console.log('Scope: extracted Grafana callbacks and scale builder against source and dist ESM; NOT full Grafana or React integration.');
console.log('Stubs: constructor-only PlotConfigBuilder, schema constants, builder state/backend props, Timeline coreConfig.xRange.');
console.log('Graveyard numeric callback: actual extracted source with xField.config = {} stub.');
console.log('Rendering: existing Happy DOM and canvas instrumentation; general probes disable axes, cursor, legend, points, and paths.');
console.log('Drag setRange probes: built-in X drag with mocked overlay geometry; axes, legend, points, and paths disabled.');
console.log('scan:false evidence: range receives [null,null]; primary X endpoints/window/cache may still be read or populated.');
console.log('Histogram scope: numeric linear size-10 buckets; singleton migration excludes overrides, ordinal and log policies.');
console.log('Volume auto:false is imposed to isolate disabled scanning; [0,null * 7] = [0,0] is preexisting, not a new regression.');
console.log('Artifact hashes identify the Grafana snapshot and candidate files; extraction fails loudly if expected source markers change.');
process.exitCode = failures ? 1 : 0;
