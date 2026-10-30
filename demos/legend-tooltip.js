import uPlot from '../src/uPlot.js';

export function legendTooltipPlugin() {
	const gap = 5;
	let legendEl, syncRect, observer;
	let width = 0, height = 0;

	function update(u, rect) {
		if (legendEl == null)
			return;

		rect ??= u.rect;
		const {left, top, idx} = u.cursor;
		const x = rect.left + left;
		const y = rect.top + top;
		const viewportWidth = document.documentElement.clientWidth;
		const viewportHeight = document.documentElement.clientHeight;
		const visible = idx != null && left >= 0 && top >= 0 && left <= rect.width && top <= rect.height
			&& x >= 0 && y >= 0 && x <= viewportWidth && y <= viewportHeight;

		legendEl.style.display = visible ? '' : 'none';

		if (visible) {
			const tx = x + width + gap > viewportWidth ? x - width - gap : x + gap;
			const ty = y + height + gap > viewportHeight ? y - height - gap : y + gap;
			legendEl.style.transform = `translate(${tx}px, ${ty}px)`;
		}
	}

	function mount(u, el) {
		legendEl = el;
		legendEl.classList.add('u-tooltip');
		u.over.appendChild(legendEl);

		// uPlot invalidates u.rect on scroll; refresh even without a mousemove.
		syncRect = () => u.syncRect();
		window.addEventListener('scroll', syncRect, true);
		window.addEventListener('resize', syncRect);
		observer = new ResizeObserver(([entry]) => {
			const {inlineSize, blockSize} = entry.borderBoxSize[0];
			// display:none reports zero; retain the last visible size for re-entry.
			if (inlineSize > 0 && blockSize > 0) {
				width = inlineSize;
				height = blockSize;
				update(u);
			}
		});
		observer.observe(legendEl, {box: 'border-box'});
		update(u);
	}

	return {
		opts: (u, opts) => {
			uPlot.assign(opts, {legend: {show: true, live: true, mode: 'table', mount}});
		},
		hooks: {
			setCursor: u => update(u),
			setSize: u => update(u),
			syncRect: update,
			destroy: () => {
				observer?.disconnect();
				window.removeEventListener('scroll', syncRect, true);
				window.removeEventListener('resize', syncRect);
				legendEl = null;
			},
		},
	};
}

export function createDemo(host, {stats = true} = {}) {
	const data = [[], [], [], []];
	for (let i = 0; i <= 100; i++) {
		data[0].push(i);
		data[1].push(50 + 20 * Math.sin(i / 8));
		data[2].push(45 + 15 * Math.cos(i / 12));
		data[3].push(30 + 10 * Math.sin(i / 5));
	}

	const size = () => ({width: host.clientWidth, height: Math.max(240, window.innerHeight - host.getBoundingClientRect().top - 24)});
	const value = (u, value) => value?.toFixed(2);
	const values = (u, si) => {
		if (!stats)
			return {};

		const {min, max} = u.scales.x;
		let low = Infinity, high = -Infinity, count = 0;
		for (let i = 0; i < u.data[0].length; i++) {
			if (u.data[0][i] >= min && u.data[0][i] <= max) {
				const value = u.data[si][i];
				low = Math.min(low, value);
				high = Math.max(high, value);

				count++;
			}
		}
		return {Min: count ? low.toFixed(2) : '--', Max: count ? high.toFixed(2) : '--', Last: u.data[si].at(-1)?.toFixed(2) ?? '--'};
	};
	const resize = () => u.setSize(size());
	const u = new uPlot({
		...size(),
		legend: {mode: stats ? 'table' : 'inline', valueSrc: 'values'},
		tooltip: {show: true, mode: 'table', valueSrc: 'value', filter: (u, si) => u.series[si].show},
		cursor: {focus: {prox: 30}},
		scales: {x: {time: false}},
		series: [
			{label: 'Sample'},
			{label: 'North', stroke: '#e45858', value, values},
			{label: 'South', stroke: '#3484d2', value, values},
			{label: 'West', stroke: '#279965', value, values},
		],
		hooks: {destroy: [() => window.removeEventListener('resize', resize)]},
	}, data, host);

	window.addEventListener('resize', resize);
	return u;
}
