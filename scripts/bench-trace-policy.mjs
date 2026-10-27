export const TRACE_ACCOUNTING = 'thread-work-gc-v2';
export const GC_CATEGORIES = ['disabled-by-default-v8.gc', 'cppgc'];

// Explicit collector scopes, not generic worker tasks or GC-labelled waits.
// Unknown Chrome scopes need review before they can change measured totals.
export const BACKGROUND_GC_EVENTS = new Set([
	'V8.GC_MC_BACKGROUND_MARKING',
	'V8.GC_MC_BACKGROUND_SWEEPING',
	'V8.GC_MC_BACKGROUND_EVACUATE_COPY',
	'V8.GC_MC_BACKGROUND_EVACUATE_UPDATE_POINTERS',
	'V8.GC_SCAVENGER_BACKGROUND_SCAVENGE_PARALLEL',
	'V8.GC_SCAVENGER_BACKGROUND_TRACED_HANDLES_COMPUTE_WEAKNESS_PARALLEL',
	'V8.GC_SCAVENGER_BACKGROUND_TRACED_HANDLES_RESET_PARALLEL',
	'V8.GC_MINOR_MS_BACKGROUND_MARKING',
	'V8.GC_MINOR_MS_BACKGROUND_SWEEPING',
	'V8.GC_MC_CLEAR_STRING_TABLE',
	'V8.GC_MC_CLEAR_EXTERNAL_STRING_TABLE',
	'V8.GC_MC_CLEAR_WEAK_LISTS',
	'V8.GC_MC_CLEAR_WEAK_COLLECTIONS',
	'V8.GC_MC_CLEAR_WEAK_GLOBAL_HANDLES',
	'V8.GC_MC_CLEAR_JS_WEAK_REFERENCES',
	'V8.GC_MC_CLEAR_MAPS',
	'V8.GC_MC_CLEAR_FLUSHED_JS_FUNCTIONS',
	'V8.GC_MC_CLEAR_FLUSHABLE_BYTECODE',
	'V8.GC_MC_CLEAR_SWEEP_JS_DISPATCH_TABLE',
	'V8.GC_MC_CLEAR_SWEEP_EXTERNAL_POINTER_TABLE',
	'V8.GC_MC_CLEAR_SWEEP_TRUSTED_POINTER_TABLE',
	'V8.GC_MC_CLEAR_SWEEP_WASM_CODE_POINTER_TABLE',
	'V8.GC_MC_CLEAR_WEAK_REFERENCES_NON_TRIVIAL',
	'V8.GC_MC_CLEAR_WEAK_REFERENCES_TRIVIAL',
	'V8.GC_MC_CLEAR_WEAK_REFERENCES_TRUSTED',
	'ConcurrentMarking::RunMajor Finished',
	'ConcurrentMarking::RunMinor Finished',
	'Sweeper::ConcurrentMajorSweeper Finished',
	'Sweeper::ConcurrentMinorSweeper Finished',
	'CppGC.ConcurrentMark',
	'CppGC.ConcurrentSweep',
	'CppGC.ConcurrentWeakCallback',
]);

export function traceAccountingProtocol(report) {
	const captured = report.trace?.accountingProtocol;
	const analyzed = report.analysis?.accountingProtocol;
	if (captured != null && analyzed != null && captured !== analyzed)
		throw new Error('Trace capture and analysis accounting protocols differ. Reanalyze the capture.');
	const protocol = analyzed ?? captured;
	if (protocol !== TRACE_ACCOUNTING)
		throw new Error(`Unsupported trace accounting protocol: ${protocol}`);
	return protocol;
}
