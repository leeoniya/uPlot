import uPlot from '../src/uPlot.js';
import { createRandomWalk } from './lib/randomWalk.js';

const samples = 401;
const xs = Array.from({ length: samples }, (_, i) => i);
const blue = '#1769aa';

const fmt = value => value == null ? 'none' : Number(value.toPrecision(6)).toString();

function makeWalk() {
	const values = [0, ...createRandomWalk()(0, samples - 1)];
	const rawMin = Math.min(...values);
	const rawSpan = Math.max(...values) - rawMin || 1;
	return values.map(value => (value - rawMin) / rawSpan);
}

const presets = [
	{ name: 'At the 20% threshold', start: 20, spread: 100, descr: 'At 300px, default affinity includes zero; 10% and no affinity keep a positive minimum.' },
	{ name: 'Outside the threshold', start: 25, spread: 100, descr: 'Default affinity no longer forces zero. Always-soft and mode 2 still anchor zero.' },
	{ name: 'Far from zero', start: 1000, spread: 100, descr: 'Automatic policies preserve detail. Soft-zero and the fixed-zero partial range extend to zero; a hard minimum alone does not.' },
	{ name: 'Small magnitude', start: .002, spread: .01, descr: 'The same 20% threshold at a much smaller magnitude. Compare with the first preset.' },
	{ name: 'Negative data', start: -120, spread: 100, descr: 'Zero affinity acts on the upper edge. The two hard-minimum-zero policies exclude all data and cannot produce a range.' },
	{ name: 'Crossing zero', start: -40, spread: 100, descr: 'Soft zero yields to data on both sides. Hard-minimum-zero policies clip the negative portion.' },
];

function makeScenario(walk, start, spread) {
	const ys = walk.map(value => start + value * spread);
	return {
		data: [xs, ys],
		dataMin: start,
		dataMax: start + spread,
		gapRatio: Math.max(0, start, -(start + spread)) / spread,
	};
}

function policyConfigs() {
	const hardZero = { min: { hard: 0 }, max: {} };
	const partial = [0, null];

	return [
		{
			title: 'Default policy',
			descr: 'Natural endpoint ticks with default 20% zero affinity. Zero affinity is independent of soft limits and modes.',
			code: 'range omitted',
		},
		{
			title: 'No zero affinity',
			descr: 'A zeroIf threshold of 0 disables the proximity rule. Zero can still occur naturally on the selected tick grid.',
			code: 'range: {zeroIf: 0, min: {}, max: {}}',
			range: { zeroIf: 0, min: {}, max: {} },
		},
		{
			title: '10% zero affinity',
			descr: 'A zeroIf threshold of 0.1 reduces zero affinity to 10% of the span.',
			code: 'range: {zeroIf: .1, min: {}, max: {}}',
			range: { zeroIf: .1, min: {}, max: {} },
		},
		{
			title: 'Padding ignored',
			descr: 'The axis-aware ranger ignores pad because its outer bounds are already ticks beyond the data.',
			code: 'range: {min: {pad: .1}, max: {pad: .1}}',
			range: { min: { pad: .1 }, max: { pad: .1 } },
		},
		{
			title: 'Always-soft zero',
			descr: 'Soft mode 1 makes zero the outer tick for one-sided data.',
			code: 'range: {min: {soft: 0, mode: 1}, max: {soft: 0, mode: 1}}',
			range: { min: { soft: 0, mode: 1 }, max: { soft: 0, mode: 1 } },
		},
		{
			title: 'Mode 2 soft zero',
			descr: 'Soft mode 2 uses zero unless the natural endpoint tick crosses it.',
			code: 'range: {min: {soft: 0, mode: 2}, max: {soft: 0, mode: 2}}',
			range: {
				min: { soft: 0, mode: 2 },
				max: { soft: 0, mode: 2 },
			},
		},
		{
			title: 'Hard zero on the min side',
			descr: 'The hard limit clips the range at zero on the data-facing side.',
			code: `range: ${JSON.stringify(hardZero)}`,
			range: hardZero,
		},
		{
			title: 'Mixed hard zero and auto',
			descr: 'A partial range fixes the zero endpoint. The null endpoint retains the default automatic policy.',
			code: `range: ${JSON.stringify(partial)}`,
			range: partial,
		},
	];
}

export function createDemo(root) {
	const preset = root.querySelector('#preset');
	const presetDescription = root.querySelector('#preset-description');
	const height = root.querySelector('#height');
	const heightValue = root.querySelector('#height-value');
	const scenarioOutput = root.querySelector('#scenario');
	const policiesRoot = root.querySelector('#policies');
	const plots = [];
	const state = { scenario: null, policies: [] };
	const walk = makeWalk();
	let presetIndex = 0;
	const presetButtons = presets.map((config, i) => {
		const button = document.createElement('button');
		button.type = 'button';
		button.value = i;
		button.textContent = config.name;
		preset.appendChild(button);
		return button;
	});

	function chartWidth(host) {
		return Math.max(360, host.clientWidth || 560);
	}

	function readout(output, u, scenario) {
		const axis = u.axes[1];
		output.value = `data ${fmt(scenario.dataMin)} … ${fmt(scenario.dataMax)}\nrange ${fmt(u.scales.y.min)} … ${fmt(u.scales.y.max)} | ${axis._splits?.length ?? 0} ticks | increment ${fmt(axis._found?.[0])}`;
	}

	function scenarioFromControls() {
		const config = presets[presetIndex];
		return makeScenario(walk, config.start, config.spread);
	}

	function updateScenario(scenario) {
		state.scenario = scenario;
		presetDescription.textContent = presets[presetIndex].descr;
		presetButtons.forEach((button, i) => button.setAttribute('aria-pressed', String(i == presetIndex)));
		scenarioOutput.value = `start ${fmt(scenario.dataMin)} | spread ${fmt(scenario.dataMax - scenario.dataMin)} | data ${fmt(scenario.dataMin)} … ${fmt(scenario.dataMax)} | zero gap ${(scenario.gapRatio * 100).toPrecision(4)}% of span`;
	}

	function setScenario(event) {
		const index = presetButtons.indexOf(event.target);
		if (index < 0 || index == presetIndex)
			return;
		presetIndex = index;
		const scenario = scenarioFromControls();
		updateScenario(scenario);
		plots.forEach(u => u.setData(scenario.data));
	}

	const scenario = scenarioFromControls();
	const policies = state.policies = policyConfigs();
	updateScenario(scenario);

	for (const policy of policies) {
		const card = document.createElement('article');
		card.className = 'policy';
		const title = document.createElement('h2');
		title.textContent = policy.title;
		const descr = document.createElement('p');
		descr.textContent = policy.descr;
		const code = document.createElement('code');
		code.textContent = policy.code;
		const stats = document.createElement('output');
		stats.className = 'policy-stats';
		const host = document.createElement('div');
		host.className = 'plot';
		card.append(title, descr, code, stats, host);
		policiesRoot.appendChild(card);

		const scale = { axis: 1 };
		if (policy.range != null)
			scale.range = policy.range;

		const u = new uPlot({
			width: chartWidth(host),
			height: height.valueAsNumber,
			padding: [8, 8, 0, 0],
			cursor: { drag: { x: true, y: false } },
			legend: { show: false },
			scales: {
				x: { time: false },
				y: scale,
			},
			axes: [
				{ size: 40 },
				{ size: 80, stroke: blue },
			],
			series: [
				{},
				{ stroke: blue, width: 1.5, points: { show: false } },
			],
			hooks: {
				draw: [u => readout(stats, u, state.scenario)],
			},
		}, scenario.data, host);
		plots.push(u);
	}

	function resize() {
		heightValue.value = `${height.value}px`;
		plots.forEach(u => u.setSize({ width: chartWidth(u.root.parentNode), height: height.valueAsNumber }));
	}

	function destroy() {
		window.removeEventListener('resize', resize);
		height.removeEventListener('input', resize);
		preset.removeEventListener('click', setScenario);

		plots.splice(0).forEach(u => u.destroy());
	}

	height.addEventListener('input', resize);
	preset.addEventListener('click', setScenario);

	window.addEventListener('resize', resize);
	resize();

	return { plots, state, destroy };
}
