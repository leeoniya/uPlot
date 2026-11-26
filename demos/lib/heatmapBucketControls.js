export function bindBucketControls(grid, update) {
	const x = grid.querySelector('#nx'), y = grid.querySelector('#ny');
	const xValue = grid.querySelector('#nx-value'), yValue = grid.querySelector('#ny-value');
	const lock = grid.querySelector('#lock-grid');
	let frame = null, lastInput = x;

	function sync(input) {
		lastInput = input;
		// Assigning value mirrors the other slider without dispatching another input event.
		if (lock.checked) {
			const other = input === x ? y : x;
			other.value = input.value;
		}
		xValue.value = x.value;
		yValue.value = y.value;
		if (frame === null) {
			frame = grid.ownerDocument.defaultView.requestAnimationFrame(() => {
				frame = null;
				update();
			});
		}
	}

	for (const input of [x, y])
		input.addEventListener('input', () => sync(input));
	lock.addEventListener('change', () => {
		if (lock.checked && x.value !== y.value) sync(lastInput);
	});
}
