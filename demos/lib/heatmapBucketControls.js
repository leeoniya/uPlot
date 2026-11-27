export function bindBucketControls(grid, update) {
	const x = grid.querySelector('#nx'), y = grid.querySelector('#ny');
	const xValue = grid.querySelector('#nx-value'), yValue = grid.querySelector('#ny-value');
	const samples = grid.querySelector('#samples'), sampleValue = grid.querySelector('#samples-value');
	const lock = grid.querySelector('#lock-grid');
	const isLocked = () => lock.getAttribute('aria-pressed') === 'true';
	let frame = null, lastInput = x;

	function sync(input) {
		lastInput = input;
		// Assigning value mirrors the other slider without dispatching another input event.
		if (isLocked()) {
			const other = input === x ? y : x;
			other.value = input.value;
		}
		xValue.value = x.value;
		yValue.value = y.value;
		scheduleUpdate();
	}

	function scheduleUpdate() {
		if (frame === null) {
			frame = grid.ownerDocument.defaultView.requestAnimationFrame(() => {
				frame = null;
				update();
			});
		}
	}

	samples.addEventListener('input', () => {
		sampleValue.value = samples.valueAsNumber.toLocaleString();
		scheduleUpdate();
	});
	for (const input of [x, y])
		input.addEventListener('input', () => sync(input));
	lock.addEventListener('click', () => {
		const locked = !isLocked();
		lock.setAttribute('aria-pressed', String(locked));
		if (locked && x.value !== y.value) sync(lastInput);
	});
}
