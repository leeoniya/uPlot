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
	{ name: '20% zero gap', start: 20, spread: 100, descr: 'The 20% zero gap exceeds the default 10% affinity threshold. Padding and tick rounding can still reach zero. Explicit 20% affinity anchors zero.' },
	{ name: 'Outside the threshold', start: 25, spread: 100, descr: 'The 25% zero gap exceeds both affinity thresholds. Padding and tick rounding can still reach zero. Explicit soft zero anchors zero here. Without padding or zero affinity, the range stays closer to the data.' },
	{ name: 'Far from zero', start: 1000, spread: 100, descr: 'Padding and tick rounding keep automatic ranges far from zero here. Soft-zero and the fixed-zero partial range extend to zero. A hard minimum alone does not.' },
	{ name: 'Small magnitude', start: .002, spread: .01, descr: 'This smaller range has the same 20% zero gap as the first preset. Padding and tick rounding can reach zero outside the default 10% affinity threshold.' },
	{ name: 'Negative data', start: -120, spread: 100, descr: 'The upper edge has a 20% zero gap, outside the default 10% affinity threshold. Padding and tick rounding can still reach zero. The two hard-minimum-zero policies exclude all data and cannot produce a range.' },
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
			descr: 'The defaults use 10% padding and 10% zero affinity, both relative to the raw data span. There is no automatic soft limit. Padding and tick rounding can reach zero outside the affinity threshold.',
			code: 'range omitted',
		},
		{
			title: 'No zero affinity',
			descr: 'A zeroIf threshold of 0 disables the proximity rule. Default 10% padding and tick rounding can still reach zero.',
			code: 'range: {zeroIf: 0, min: {}, max: {}}',
			range: { zeroIf: 0, min: {}, max: {} },
		},
		{
			title: '20% zero affinity',
			descr: 'A zeroIf threshold of 0.2 extends zero affinity to 20% of the raw data span. Padding remains at the default 10%.',
			code: 'range: {zeroIf: .2, min: {}, max: {}}',
			range: { zeroIf: .2, min: {}, max: {} },
		},
		{
			title: 'Explicit 10% padding',
			descr: 'Explicit 10% padding is equivalent to the default padding. Active anchors override padding on their side. The opposite side retains padding based on the raw data span.',
			code: 'range: {min: {pad: .1}, max: {pad: .1}}',
			range: { min: { pad: .1 }, max: { pad: .1 } },
		},
		{
			title: 'Explicit soft zero',
			descr: 'Explicit soft zero anchors the endpoint while the raw extremum stays inside the limit. It overrides zero affinity and padding, but not hard limits.',
			code: 'range: {min: {soft: 0}, max: {soft: 0}}',
			range: { min: { soft: 0 }, max: { soft: 0 } },
		},
		{
			title: 'No padding or zero affinity',
			descr: 'This policy adds no padding or zero affinity. Tick rounding still applies.',
			code: 'range: {zeroIf: 0, min: {pad: 0}, max: {pad: 0}}',
			range: {
				zeroIf: 0,
				min: { pad: 0 },
				max: { pad: 0 },
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
