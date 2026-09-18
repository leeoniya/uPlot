import uPlot from '../src/uPlot.js';
import { createRandomWalk } from './lib/randomWalk.js';

const samples = 401;
const xs = Array.from({ length: samples }, (_, i) => i);
const gapRatios = [0, .025, .075, .1, .1001, .2, .5];
const blue = '#1769aa';

const fmt = value => value == null ? 'none' : Number(value.toPrecision(6)).toString();

function makeScenario() {
	const values = [0, ...createRandomWalk()(0, samples - 1)];
	const rawMin = Math.min(...values);
	const rawMax = Math.max(...values);
	const rawSpan = rawMax - rawMin || 1;
	const magnitude = (1 + Math.random() * 8) * 10 ** (Math.floor(Math.random() * 9) - 4);
	const gapRatio = gapRatios[Math.floor(Math.random() * gapRatios.length)];
	const gap = gapRatio * magnitude;
	const sign = Math.random() < .5 ? -1 : 1;
	const ys = values.map(value => {
		const normalized = (value - rawMin) / rawSpan;
		return sign > 0 ? gap + normalized * magnitude : -gap - normalized * magnitude;
	});

	return {
		data: [xs, ys],
		dataMin: Math.min(...ys),
		dataMax: Math.max(...ys),
		gapRatio,
		sign,
	};
}

function policyConfigs(sign) {
	const zeroSide = sign > 0 ? 'min' : 'max';
	const hardWithPad = sign > 0 ?
		{ min: { pad: .25, hard: 0 }, max: { pad: .1 } } :
		{ min: { pad: .1 }, max: { pad: .25, hard: 0 } };
	const partial = sign > 0 ? [0, null] : [null, 0];

	return [
		{
			title: 'Default policy',
			descr: 'Zero padding. Zero becomes an outer tick when the gap is at most 10% of the raw span.',
			code: 'range omitted',
		},
		{
			title: 'No zero affinity',
			descr: 'An explicit empty policy disables the default zero affinity.',
			code: 'range: {min: {}, max: {}}',
			range: { min: {}, max: {} },
		},
		{
			title: '10% minimum padding',
			descr: 'Each outer tick stays at least 10% of the raw span from its data extremum.',
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
			title: 'Conditioned-soft zero with padding',
			descr: 'Soft mode 3 uses zero when 10% padding reaches it. The other side keeps its minimum padding.',
			code: 'range: {min: {pad: .1, soft: 0, mode: 3}, max: {pad: .1, soft: 0, mode: 3}}',
			range: {
				min: { pad: .1, soft: 0, mode: 3 },
				max: { pad: .1, soft: 0, mode: 3 },
			},
		},
		{
			title: `Hard zero on the ${zeroSide} side`,
			descr: 'The hard zero overrides 25% padding on its side. The opposite side keeps 10% minimum padding.',
			code: `range: ${JSON.stringify(hardWithPad)}`,
			range: hardWithPad,
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
	const randomize = root.querySelector('#randomize');
	const height = root.querySelector('#height');
	const heightValue = root.querySelector('#height-value');
	const scenarioOutput = root.querySelector('#scenario');
	const policiesRoot = root.querySelector('#policies');
	const plots = [];
	const state = { scenario: null, policies: [] };

	function chartWidth(host) {
		return Math.max(360, host.clientWidth || 560);
	}

	function readout(output, u, scenario) {
		const axis = u.axes[1];
		output.value = `data ${fmt(scenario.dataMin)} … ${fmt(scenario.dataMax)}\nrange ${fmt(u.scales.y.min)} … ${fmt(u.scales.y.max)} | ${axis._splits?.length ?? 0} ticks | increment ${fmt(axis._found?.[0])}`;
	}

	function render() {
		plots.splice(0).forEach(u => u.destroy());
		policiesRoot.textContent = '';

		const scenario = state.scenario = makeScenario();
		const policies = state.policies = policyConfigs(scenario.sign);
		const side = scenario.sign > 0 ? 'positive' : 'negative';
		const affinity = scenario.gapRatio <= .1 ? 'inside' : 'outside';
		scenarioOutput.value = `${side} walk | data ${fmt(scenario.dataMin)} … ${fmt(scenario.dataMax)} | zero gap ${(scenario.gapRatio * 100).toPrecision(4)}% of span (${affinity} default affinity)`;

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
					draw: [u => readout(stats, u, scenario)],
				},
			}, scenario.data, host);
			plots.push(u);
		}
	}

	function resize() {
		heightValue.value = `${height.value}px`;
		plots.forEach(u => u.setSize({ width: chartWidth(u.root.parentNode), height: height.valueAsNumber }));
	}

	function destroy() {
		window.removeEventListener('resize', resize);
		height.removeEventListener('input', resize);
		randomize.removeEventListener('click', render);
		plots.splice(0).forEach(u => u.destroy());
	}

	height.addEventListener('input', resize);
	randomize.addEventListener('click', render);
	window.addEventListener('resize', resize);
	render();

	return { plots, state, render, destroy };
}
