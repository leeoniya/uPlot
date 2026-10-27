export const lifecycleOperations = ['small-init', 'data-update', 'resize', 'hover-10'];
const populationOperations = ['small-init', 'data-update'];

export const dashboardWorkload = Object.freeze({
	protocol: 'dashboard-v1', charts: 20, series: 5, rows: 300,
	columns: 4, gridRows: 5, width: 480, height: 216,
});

export function benchmarkWorkload(report) {
	const workload = report?.workload;
	if (workload === undefined) return null;
	if (!workload || workload.protocol !== 'dashboard-v1' ||
		Object.keys(dashboardWorkload).some(key => key !== 'protocol' &&
			(!Number.isSafeInteger(workload[key]) || workload[key] <= 0)) ||
		workload.rows < 2 || workload.charts !== workload.columns * workload.gridRows)
		throw new Error('Invalid dashboard workload protocol or dimensions.');
	// Canonical key order makes saved snapshots independent of JSON property order.
	return Object.fromEntries(Object.keys(workload).sort().map(key => [key, workload[key]]));
}

export function assertCompatibleWorkloads(reports) {
	if (new Set(reports.map(report => JSON.stringify(benchmarkWorkload(report)))).size > 1)
		throw new Error('Cannot combine different benchmark workloads or dashboard dimensions, including idle controls. Rerun all selected variants.');
}

export function benchmarkOperations(report) {
	if (['phase', 'initProtocol', 'resizeProtocol', 'hoverProtocol', 'hover', 'lifecycle', 'operations', 'workload']
		.every(key => !Object.hasOwn(report, key))) {
		if (!Array.isArray(report.samples) || report.samples.some(sample => sample?.phases !== undefined))
			throw new Error('Lifecycle samples require chart-population report metadata.');
		return null;
	}
	if (report.phase !== 'chart-population' || report.initProtocol !== 'settled-work-v1')
		throw new Error('Lifecycle reports require chart-population and settled-work-v1 initialization.');
	if (benchmarkWorkload(report)) {
		if (report.resizeProtocol !== undefined || report.hoverProtocol !== undefined || report.hover !== undefined ||
			report.lifecycle?.resizeSize !== undefined ||
			JSON.stringify(report.lifecycle?.operations) !== JSON.stringify(populationOperations))
			throw new Error('Dashboard lifecycle requires settled-work-v1 chart-population with small-init and data-update only, without resize or hover.');
		return populationOperations;
	}
	if (JSON.stringify(report.lifecycle?.operations) !== JSON.stringify(lifecycleOperations) ||
		report.lifecycle?.resizeSize?.width !== 1200 || report.lifecycle?.resizeSize?.height !== 400)
		throw new Error('Lifecycle reports require the current operation sequence and 1200x400 resize dimensions.');
	if (report.resizeProtocol !== 'retained-resize-v1')
		throw new Error('Lifecycle reports require retained-resize-v1 resize protocol.');
	if (report.hoverProtocol !== 'hover-ten-v3')
		throw new Error('Lifecycle reports require hover-ten-v3 hover protocol.');
	const hover = report.hover;
	if (hover?.intervalMs !== 50)
		throw new Error('Lifecycle hover-ten-v3 metadata requires intervalMs 50.');
	if (hover.count !== 10 || !Array.isArray(hover.variants) || !hover.variants.includes('idle') ||
		hover.variants.some(variant => typeof variant !== 'string' || !variant.trim() || variant !== variant.trim()) ||
		new Set(hover.variants).size !== hover.variants.length)
		throw new Error('Lifecycle hover metadata requires count 10 and distinct supported variants including idle.');
	return lifecycleOperations;
}

// Memory remains session-scoped. Timing expands each session into disjoint,
// independently marked operations; the outer sample still represents data-update.
export function benchmarkTimingSamples(report) {
	if (!Array.isArray(report?.samples))
		throw new TypeError('report.samples must be an array');
	const operations = benchmarkOperations(report);
	if (!operations)
		return report.samples;
	const ids = new Set();
	return report.samples.flatMap(sample => {
		const sampleOperations = operations.filter(operation => operation !== 'hover-10' || report.hover.variants.includes(sample.variant));
		if (!Array.isArray(sample.phases) || sample.phases.length !== sampleOperations.length)
			throw new Error(`Expected ${sampleOperations.length} lifecycle operation windows per session.`);
		for (let i = 0; i < sampleOperations.length; i++) {
			const phase = sample.phases[i];
			if (typeof phase?.id !== 'string' || !phase.id || ids.has(phase.id))
				throw new Error('Lifecycle operation windows require distinct ids.');
			ids.add(phase.id);
			if (phase.operation !== sampleOperations[i] || phase.variant !== sample.variant ||
				phase.dpr !== sample.dpr || phase.round !== sample.round ||
				phase.warmup !== sample.warmup)
				throw new Error('Lifecycle operation metadata does not match its session.');
		}
		const update = sample.phases.findLast(phase => phase.operation === 'data-update');
		if (sample.id !== update.id || sample.operation !== 'data-update' || sample.jsMs !== update.jsMs)
			throw new Error('The session timing must describe its final data update.');
		return sample.phases;
	});
}
