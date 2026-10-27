import {WIDTH, HEIGHT, CHARTS} from './common.mjs';

export function createDashboardLayout(document, {interactive = false} = {}) {
	const fixture = document.createElement('div');
	fixture.id = 'benchmark-fixture';
	document.body.replaceChildren(fixture);
	const style = document.createElement('style');
	style.textContent = `
		html, body { margin: 0; padding: 0; }
		#benchmark-fixture {
			position: absolute; left: 0; top: 0; width: ${WIDTH * 4}px; height: ${HEIGHT * 5}px;
			display: grid; grid-template-columns: repeat(4, ${WIDTH}px);
			grid-template-rows: repeat(5, ${HEIGHT}px); gap: 0; pointer-events: ${interactive ? 'auto' : 'none'};
		}
		#benchmark-fixture .u-legend { font-size: 10px; }
		#benchmark-fixture > .dashboard-chart {
			position: relative; box-sizing: border-box; width: ${WIDTH}px; height: ${HEIGHT}px;
			min-width: 0; min-height: 0; margin: 0; padding: 0; border: 0; overflow: hidden;
		}
	`;
	document.head.append(style);
	return {fixture, style};
}

export function createDashboardHosts(fixture, id) {
	const document = fixture.ownerDocument;
	return Array.from({length: CHARTS}, (_, i) => {
		const host = document.createElement('div');
		host.id = `dashboard-${id}-${i}`;
		host.className = 'dashboard-chart';
		fixture.append(host);
		// Vendor drawing areas stay empty; adapter status writes use detached nodes.
		const wait = document.createElement('h2');
		wait.textContent = 'Rendering...';
		return {host, wait};
	});
}
