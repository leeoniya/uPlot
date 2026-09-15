// The detector borrows data. Prepare again after any input change.
// Finite values retain their original positions, including gaps between samples.
function prepareDbscan1d(data) {
	const length = data.length;
	let size = 0;
	let ascending = true;
	let previous = -Infinity;

	for (let i = 0; i < length; i++) {
		const value = data[i];
		if (Number.isFinite(value)) {
			size++;
			if (value < previous)
				ascending = false;
			previous = value;
		}
	}

	const sorted = new Uint32Array(size);
	for (let i = 0, j = 0; i < length; i++) {
		if (Number.isFinite(data[i]))
			sorted[j++] = i;
	}

	if (!ascending)
		sorted.sort((a, b) => data[a] - data[b]);

	const output = Array(length).fill(null);
	const core = new Uint8Array(length);

	// minPoints includes self. A finite radius counts sample positions, not elapsed time.
	// Global labels: cluster ID >= 0. Local labels: 0 = inlier (not a cluster ID).
	// Both modes: -1 = noise, null = missing. The returned buffer is reused by default.
	function detect({epsilon, minPoints, windowRadius = Infinity}, labels = output) {
		if (!Number.isFinite(epsilon) || epsilon < 0)
			throw new RangeError("epsilon must be a finite, non-negative number.");

		if (!Number.isInteger(minPoints) || minPoints < 1)
			throw new RangeError("minPoints must be a positive integer.");

		if (windowRadius !== Infinity && (!Number.isInteger(windowRadius) || windowRadius < 0))
			throw new RangeError("windowRadius must be a non-negative integer or Infinity.");

		if (!Array.isArray(labels) || labels.length !== length || labels === data)
			throw new TypeError("labels must be a separate Array with the same length as data.");

		labels.fill(null);
		for (let i = 0; i < size; i++)
			labels[sorted[i]] = -1;

		if (windowRadius !== Infinity) {
			core.fill(0);

			// Count within centered windows. Missing values do not shrink the time axis.
			for (let i = 0; i < length; i++) {
				if (labels[i] === null)
					continue;

				const start = Math.max(0, i - windowRadius);
				const end = Math.min(length - 1, i + windowRadius);
				let count = 0;

				for (let j = start; j <= end; j++) {
					if (labels[j] !== null && Math.abs(data[j] - data[i]) <= epsilon && ++count >= minPoints) {
						core[i] = 1;
						break;
					}
				}
			}

			// Border points are inliers too. Only core points can establish this status.
			for (let i = 0; i < length; i++) {
				if (labels[i] === null)
					continue;

				if (core[i]) {
					labels[i] = 0;
					continue;
				}

				const start = Math.max(0, i - windowRadius);
				const end = Math.min(length - 1, i + windowRadius);

				for (let j = start; j <= end; j++) {
					if (core[j] && Math.abs(data[j] - data[i]) <= epsilon) {
						labels[i] = 0;
						break;
					}
				}
			}

			return labels;
		}

		let left = 0;
		let right = 0;
		let covered = 0;
		let lastCore = -1;
		let cluster = -1;

		// Sorted neighborhoods have monotone boundaries: O(n) per global detection.
		for (let i = 0; i < size; i++) {
			const value = data[sorted[i]];

			while (value - data[sorted[left]] > epsilon)
				left++;

			while (right < size && data[sorted[right]] - value <= epsilon)
				right++;

			if (right - left < minPoints)
				continue;

			// A shared border point cannot merge clusters and joins the lower-valued one.
			if (lastCore === -1 || value - data[sorted[lastCore]] > epsilon)
				cluster++;

			for (let j = Math.max(left, covered); j < right; j++)
				labels[sorted[j]] = cluster;

			covered = right;
			lastCore = i;
		}

		return labels;
	}

	return {detect};
}

// One-shot compatibility helper. Use prepareDbscan1d for repeated threshold changes.
function dbscan1d(data, epsilon, minPoints) {
	return prepareDbscan1d(data).detect({epsilon, minPoints});
}
