// Preserve the full time range without copying the full fixture. Preparation
// creates separate library inputs for the two-point chart and its full update.
export function smallLifecycleData(packed) {
	const fields = packed[0];
	const start = fields + 1;
	if (!Number.isSafeInteger(fields) || fields < 1 ||
		packed.length < start + fields * 2 || (packed.length - start) % fields !== 0)
		throw new Error('Expected a packed header and at least two complete rows.');
	return [...packed.slice(0, start + fields), ...packed.slice(-fields)];
}
