export const lifecycleOperations = ['small-init', 'data-update', 'resize'];
const populationOperations = ['small-init', 'data-update'];
const legacyOperations = ['empty-init', 'first-data', 'warmup-update', 'data-update'];

export function benchmarkOperations(report) {
	if (report.resizeProtocol !== undefined && (report.resizeProtocol !== 'retained-resize-v1' ||
		report.phase !== 'chart-population' || report.initProtocol !== 'settled-work-v1'))
		throw new Error('Unsupported lifecycle resize protocol or initialization boundary.');
	return report.phase === 'chart-population' ? (report.resizeProtocol ? lifecycleOperations : populationOperations)
		: report.phase === 'chart-lifecycle' ? legacyOperations : null;
}

// Memory remains session-scoped. Timing expands each session into disjoint,
// independently marked operations; the outer sample still represents data-update.
export function benchmarkTimingSamples(report) {
	if (!Array.isArray(report?.samples))
		throw new TypeError('report.samples must be an array');
	const operations = benchmarkOperations(report);
	if (!operations) {
		if (report.samples.some(sample => sample.phases))
			throw new Error('Lifecycle samples require chart-population or legacy chart-lifecycle report metadata.');
		return report.samples;
	}
	const ids = new Set();
	return report.samples.flatMap(sample => {
		if (!Array.isArray(sample.phases) || sample.phases.length !== operations.length)
			throw new Error(`Expected ${operations.length} lifecycle operation windows per session.`);
		for (let i = 0; i < operations.length; i++) {
			const phase = sample.phases[i];
			if (typeof phase.id !== 'string' || !phase.id || ids.has(phase.id))
				throw new Error('Lifecycle operation windows require distinct ids.');
			ids.add(phase.id);
			if (phase.operation !== operations[i] || phase.variant !== sample.variant ||
				phase.dpr !== sample.dpr || phase.round !== sample.round ||
				phase.warmup !== (sample.warmup || phase.operation === 'warmup-update'))
				throw new Error('Lifecycle operation metadata does not match its session.');
		}
		const update = sample.phases.findLast(phase => phase.operation === 'data-update');
		if (sample.id !== update.id || sample.operation !== 'data-update' || sample.jsMs !== update.jsMs)
			throw new Error('The session timing must describe its final data update.');
		return sample.phases;
	});
}
