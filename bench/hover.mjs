// Keep the same browser-verified capability snapshot in each isolated worker.
// ECharts sampling can select another series; Highcharts Boost's table-backed
// hover points lack y/index in the pinned release. Neither passes value checks.
export const hoverVariants = [
	'idle', 'uplot', 'uplot-release', 'd3', 'd3-minmax', 'd3-svg', 'd3-svg-minmax',
	'd3fc', 'd3fc-canvas', 'deckgl', 'chartjs', 'dygraphs',
	'highcharts-svg', 'plotly', 'plotly-svg', 'lightweight',
	'bokeh', 'bokeh-canvas', 'canvasjs', 'apexcharts', 'billboard', 'anychart',
	'recharts', 'devextreme',
];

export function hoverTargets(length, project) {
	if (!Number.isSafeInteger(length) || length < 12)
		throw new Error('Hover requires at least twelve data rows.');
	return Array.from({length: 10}, (_, i) => {
		const index = Math.round((i + 1) * (length - 1) / 11);
		const seriesIndex = i % 3;
		return {index, seriesIndex, ...project(index, seriesIndex)};
	});
}

export function nearHoverIndex(actual, target, tolerance) {
	return Number.isSafeInteger(actual) && actual >= 0 &&
		Number.isFinite(tolerance) && tolerance >= 0 && Math.abs(actual - target.index) <= tolerance;
}

export function visibleText(element) {
	if (!element?.isConnected) return '';
	const view = element.ownerDocument.defaultView;
	// A tooltip child can have visible styles inside a hidden ancestor.
	for (let node = element; node?.nodeType === 1; node = node.parentElement) {
		const style = view.getComputedStyle(node);
		if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0)
			return '';
	}
	const rect = element.getBoundingClientRect();
	return rect.width > 0 && rect.height > 0 ? element.textContent.trim() : '';
}

export function validateHoverPlan(plan, width, height) {
	if (!plan || !Array.isArray(plan.targets) || plan.targets.length !== 10 || typeof plan.verify !== 'function')
		throw new Error('Hover adapter must provide ten targets and a value-display verifier.');
	const indices = new Set();
	for (const [i, target] of plan.targets.entries()) {
		if (!Number.isFinite(target.x) || !Number.isFinite(target.y) ||
			target.x < 0 || target.x >= width || target.y < 0 || target.y >= height ||
			!Number.isSafeInteger(target.index) || target.index < 0 || indices.has(target.index) || target.seriesIndex !== i % 3)
			throw new Error(`Invalid hover target ${i}: ${JSON.stringify(target)}`);
		indices.add(target.index);
	}
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Node paces the entire sequence. The renderer receives only the final
// acknowledgement, and never calls an adapter's verifier during measurement.
export async function runHover(targets, {moveBatch = globalThis.benchmarkMoveMouseBatch} = {}) {
	if (typeof moveBatch !== 'function')
		throw new Error('Hover requires the batched browser mouse-input bridge.');
	await moveBatch(targets);
	return {count: targets.length, intervalMs: 50};
}

// Harness-development diagnostic only. Never called by benchmark captures or
// as a preflight that could warm hover caches before a measured sequence.
export async function verifyHover(plan, {move = globalThis.benchmarkMoveMouse, wait = delay} = {}) {
	if (typeof move !== 'function')
		throw new Error('Hover requires the browser mouse-input bridge.');
	const moves = [];
	const indices = new Set();
	for (const target of plan.targets) {
		await move(target.x, target.y);
		await wait(50);
		const evidence = plan.verify(target);
		if (!evidence)
			throw new Error(`Hover did not display a value for series ${target.seriesIndex}, row ${target.index} at (${target.x}, ${target.y}).`);
		if (!Number.isSafeInteger(evidence.index) || evidence.index < 0 || indices.has(evidence.index) ||
			evidence.seriesIndex !== target.seriesIndex || !plan.idle &&
			(!Number.isFinite(evidence.value) || typeof evidence.text !== 'string' || !evidence.text.trim()))
			throw new Error('Hover verifier returned invalid, duplicate, or non-displayed datapoint evidence.');
		indices.add(evidence.index);
		moves.push({x: target.x, y: target.y, targetIndex: target.index, ...evidence});
	}
	return {count: moves.length, intervalMs: 50, moves};
}
