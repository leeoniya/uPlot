export const lifecycleOperations = ['small-init', 'data-update'];
const legacyOperations = ['empty-init', 'first-data', 'warmup-update', 'data-update'];

export function benchmarkOperations(report) {
	return report.phase === 'chart-population' ? lifecycleOperations
		: report.phase === 'chart-lifecycle' ? legacyOperations : null;
}

// Memory remains session-scoped. Timing expands each session into disjoint,
// independently marked operations; the outer sample represents its last update.
export function benchmarkTimingSamples(report) {
	if (!Array.isArray(report?.samples))
		throw new TypeError('report.samples must be an array');
	const operations = benchmarkOperations(report);
		if (!operations) {
		if (report.samples.some(sample => sample.phases))
			throw new Error('Lifecycle samples require chart-population or legacy chart-lifecycle report metadata.');
		return report.samples;
	}
	return report.samples.flatMap(sample => {
		if (!Array.isArray(sample.phases) || sample.phases.length !== operations.length)
			throw new Error(`Expected ${operations.length} lifecycle operation windows per session.`);
		for (let i = 0; i < operations.length; i++) {
			const phase = sample.phases[i];
			if (phase.operation !== operations[i] || phase.variant !== sample.variant ||
				phase.dpr !== sample.dpr || phase.round !== sample.round ||
				phase.warmup !== (sample.warmup || phase.operation === 'warmup-update'))
				throw new Error('Lifecycle operation metadata does not match its session.');
		}
		const update = sample.phases[sample.phases.length - 1];
		if (sample.id !== update.id || sample.operation !== 'data-update' || sample.jsMs !== update.jsMs)
			throw new Error('The session timing must describe its final data update.');
		return sample.phases;
	});
}
