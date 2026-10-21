import uPlot from '../src/uPlot.js';
import history from './data/log-scales.js';


const chartHeight = 400;

function rawHoverValue(u, si, lastWhenIdle) {
	const idx = lastWhenIdle && u.cursor.idx == null ? u.data[si].length - 1 : u.legend.idxs[si];
	const value = idx == null ? null : u.data[si][idx];
	return Number.isFinite(value) ? value : null;
}

export function descendingHoverValue(u, a, b, lastWhenIdle = false) {
	const av = rawHoverValue(u, a, lastWhenIdle);
	const bv = rawHoverValue(u, b, lastWhenIdle);
	if (av == null)
		return bv == null ? 0 : 1;
	return bv == null ? -1 : bv - av;
}

export function createConfigs(state = { proximity: 20, limit: 5 }) {
	return [
		{
			id: 'limit',
			title: 'Limit only',
			description: 'Show the selected number of servers in series order, without filtering or sorting. All 12 servers remain plotted. The Time row does not consume the limit.',
			legend: { limit: () => [0, state.limit || Infinity] },
		},
		{
			id: 'latest',
			title: 'Top servers: latest when idle',
			description: 'Show the top servers by player count, up to the selected limit. Without a hover, rank and display the final sample. Hover to use values at the cursor time.',
			lastWhenIdle: true,
			legend: {
				sort: (u, a, b) => descendingHoverValue(u, a, b, true),
				limit: () => [0, state.limit || Infinity],
			},
		},
		{
			id: 'nearby',
			title: 'Nearby servers',
			description: 'Without a hover, show all visible servers. Hover over an outlier or a cluster to select servers within the chosen distance, sorted by player count. Infinity includes all visible servers with a hover value.',
			legend: {
				filter: (u, si) => u.series[si].show && (u.cursor.idx == null ||
									Number.isFinite(u.cursor.dists[si]) && u.cursor.dists[si] <= state.proximity),
				sort: descendingHoverValue,
			},
		},
		{
			id: 'ranked',
			title: 'All servers: ranked by player count',
			description: 'No filter or limit. Move horizontally to rank all servers at that time, regardless of cursor height.',
			legend: { sort: descendingHoverValue },
		},
	];
}

export function createDemo(root) {
	const charts = root.querySelector('#charts');
	const plots = [];
	const state = { proximity: 20, limit: 5 };
	const configs = createConfigs(state);
	const behavior = document.createElement('select');
	behavior.name = 'behavior';
	for (const config of configs) {
		const option = document.createElement('option');
		option.value = config.id;
		option.textContent = config.title;
		behavior.appendChild(option);
	}
	behavior.value = configs[0].id;
	const behaviorLabel = document.createElement('label');
	behaviorLabel.append('Behavior: ', behavior);

	const proximity = document.createElement('select');
	proximity.name = 'proximity';
	for (const distance of [5, 10, 15, 20, Infinity]) {
		const option = document.createElement('option');
		option.value = String(distance);
		option.textContent = distance == Infinity ? 'Infinity' : `${distance}px`;
		proximity.appendChild(option);
	}
	proximity.value = String(state.proximity);
	const proximityLabel = document.createElement('label');
	proximityLabel.append('Proximity: ', proximity);
	proximityLabel.hidden = true;

	const mode = document.createElement('select');
	mode.name = 'mode';
	for (const [value, name] of [['inline', 'Inline'], ['table', 'Table']]) {
		const option = document.createElement('option');
		option.value = value;
		option.textContent = name;
		mode.appendChild(option);
	}
	mode.value = 'table';
	const modeLabel = document.createElement('label');
	modeLabel.append('Legend mode: ', mode);

	const position = document.createElement('select');
	position.name = 'position';
	['Top', 'Right', 'Bottom', 'Left'].forEach((name, side) => {
		const option = document.createElement('option');
		option.value = String(side);
		option.textContent = name;
		position.appendChild(option);
	});
	position.value = '1';
	const positionLabel = document.createElement('label');
	positionLabel.append('Legend position: ', position);

	const limit = document.createElement('select');
	limit.name = 'limit';
	for (let count = 0; count <= 50; count += 5) {
		const option = document.createElement('option');
		option.value = String(count);
		option.textContent = count == 0 ? '0 (All)' : String(count);
		limit.appendChild(option);
	}
	limit.value = String(state.limit);
	const limitLabel = document.createElement('label');
	limitLabel.append('Per page: ', limit);

	// Match the log-scale demo's zero-count convention without mutating shared history.
	const data = [history.timestamps.slice(), ...history.graphData.map(counts =>
		counts.map(value => value === 0 ? 1 : value),
	)];
	const initialIdx = Math.floor(data[0].length / 2);

	function chartWidth() {
		return Math.max(280, Math.min(1000, charts.clientWidth || 1000));
	}

	const card = document.createElement('article');
	const description = document.createElement('p');
	description.textContent = configs[0].description;
	const readback = document.createElement('output');
	const host = document.createElement('div');
	card.append(behaviorLabel, modeLabel, positionLabel, description, limitLabel, proximityLabel, readback, host);
	charts.appendChild(card);

	function showReadback(u) {
		readback.value = `count ${u.legend.count} | range [${u.legend.range.join(', ')}) | order [${u.legend.order.join(', ')}]`;
	}

	let config = configs[0];
	let u;

	function createPlot(saved) {
		u = new uPlot({
			width: chartWidth(),
			height: chartHeight,
			cursor: {
				trackDists: true,
				focus: { prox: -1 },
			},
			legend: { ...config.legend, mode: mode.value, side: Number(position.value) },
			scales: { x: saved?.x ?? {}, y: { ...saved?.y, distr: 3 } },
			axes: [{}, { size: 70, label: 'Players (log scale)' }],
			series: [
				{ label: 'Time' },
				...history.servers.map((server, i) => ({
					label: server.name,
					show: saved?.shown[i + 1] ?? true,
					stroke: server.color,
					width: 1,
					spanGaps: true,
					points: { show: false },
					value: (u, value) => Number.isFinite(value) ? uPlot.fmtNum(value) : '--',
				})),
			],
			hooks: {
				init: [u => {
					// Preserve the default Time formatter and keep cursor indices untouched.
					u.series.forEach((series, si) => {
						const format = series.value;
						series.value = (u, value, seriesIdx, idx) => {
							if (config.lastWhenIdle && u.cursor.idx == null) {
								idx = u.data[si].length - 1;
								value = u.data[si][idx];
							}
							return format(u, value, seriesIdx, idx);
						};
					});
				}],
				ready: [u => {
					// Wait for scale and layout initialization before converting coordinates.
					u.setCursor(saved?.cursor ?? { left: u.valToPos(data[0][initialIdx], 'x'), top: u.valToPos(data[5][initialIdx], 'y') });
				}],
				setLegend: [showReadback],
			},
		}, data, host);
		plots[0] = u;
	}

	createPlot();

	function resize() {
		u.setSize({ width: chartWidth(), height: chartHeight });
	}

	function changeBehavior() {
		config = configs.find(config => config.id == behavior.value);
		// Clear omitted stages so the previous behavior cannot affect the new one.
		Object.assign(u.legend, { filter: null, sort: null, limit: null }, config.legend);
		description.textContent = config.description;
		proximityLabel.hidden = config.id != 'nearby';
		limitLabel.hidden = config.legend.limit == null;
		u.setLegend({});
	}

	function changeProximity() {
		state.proximity = Number(proximity.value);
		u.setLegend({});
	}

	function changeLimit() {
		state.limit = Number(limit.value);
		u.setLegend({});
	}

	function changeLayout() {
		const saved = {
			cursor: { left: u.cursor.left, top: u.cursor.top },
			x: { min: u.scales.x.min, max: u.scales.x.max },
			y: { min: u.scales.y.min, max: u.scales.y.max },
			shown: u.series.map(series => series.show),
		};
		u.destroy();
		createPlot(saved);
	}

	behavior.addEventListener('change', changeBehavior);
	mode.addEventListener('change', changeLayout);
	position.addEventListener('change', changeLayout);
	limit.addEventListener('change', changeLimit);
	proximity.addEventListener('change', changeProximity);
	window.addEventListener('resize', resize);

	return {
		plots,
		configs,
		destroy() {
			behavior.removeEventListener('change', changeBehavior);
			mode.removeEventListener('change', changeLayout);
			position.removeEventListener('change', changeLayout);
			limit.removeEventListener('change', changeLimit);
			proximity.removeEventListener('change', changeProximity);
			window.removeEventListener('resize', resize);
			plots.splice(0).forEach(u => u.destroy());
			card.remove();
		},
	};
}
