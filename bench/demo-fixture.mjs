import {demoDependencies} from './demo-dependencies.mjs';

let stylesReady;

export async function applyDemoStyles() {
	if (!stylesReady) {
		stylesReady = new Promise((resolve, reject) => {
			const link = document.createElement('link');
			link.rel = 'stylesheet';
			link.href = new URL('./demo.css', import.meta.url).href;
			link.onload = () => resolve();
			link.onerror = () => reject(new Error(`Failed to load ${link.href}`));
			document.head.append(link);
		});
	}

	await stylesReady;
}

export function setupDemo(variant, parent) {
	if (!Object.hasOwn(demoDependencies, variant))
		throw new Error(`Unknown demo variant: ${variant}`);

	parent.classList.remove(...Object.keys(demoDependencies));
	parent.classList.add('bench-demo', variant);

	const host = document.createElement('div');
	if (variant === 'd3') {
		host.innerHTML = `
			<h3>Server Events</h3>
			<div class="legend">
				<span id="cpu-value" style="color: red">CPU: --</span>
				<span id="ram-value" style="color: blue">RAM: --</span>
				<span id="tcp-value" style="color: green">TCP Out: --</span>
			</div>
			<div class="chart">
				<canvas id="plot"></canvas>
				<canvas id="overlay"></canvas>
			</div>
		`;
	}
	else if (variant === 'chartjs') {
		host.className = 'chart-container';
		host.innerHTML = '<canvas id="chart1"></canvas>';
	}
	else if (variant === 'echarts')
		host.id = 'chart';
	else if (variant === 'flot') {
		host.className = 'demo-container';
		host.innerHTML = '<div id="placeholder" class="demo-placeholder"></div>';
	}
	else if (variant === 'dygraphs')
		host.id = 'graphdiv';

	parent.append(host);
	return host;
}
