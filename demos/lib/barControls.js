// HTML form wiring for the axis-label-rotation demo, not bar chart logic.
export function createBarControls(root, { getPlot, getControls, rebuild, regenerate }) {
	function readoutNode(id) {
		const el = root.querySelector(id);
		return el.firstChild ?? el.appendChild(document.createTextNode(''));
	}

	const slider = root.querySelector('#rotation');
	const output = readoutNode('#rotation-value');
	const height = root.querySelector('#height');
	const heightOutput = readoutNode('#height-value');
	const heightLabel = readoutNode('#height-label');
	const horizontal = root.querySelector('#horizontal');
	const stacked = root.querySelector('#stacked');
	const percent = root.querySelector('#percent');
	const distribution = root.querySelector('#distribution');
	const width = root.querySelector('#group-width');
	const widthOutput = readoutNode('#group-width-value');
	const stats = readoutNode('#stats');
	const randomize = root.querySelector('#randomize');
	const truncate = root.querySelector('#truncate');
	const maxLength = root.querySelector('#max-length');
	const lengthOutput = readoutNode('#max-length-value');
	const middle = root.querySelector('#middle-ellipsis');

	function syncOrientation() {
		slider.disabled = horizontal.checked;
		output.data = `${horizontal.checked ? 0 : slider.value}°`;
		heightLabel.data = horizontal.checked ? 'Chart width' : 'Chart height';
	}

	function setOrientation() {
		const { width, height } = getPlot();
		rebuild(horizontal.checked
			? { width: height, height: width / 4 }
			: { width: height * 4, height: width });
		syncOrientation();
	}

	function setStacking() {
		percent.disabled = !stacked.checked;
		const { width, height } = getPlot();
		rebuild({ width, height });
	}

	function setHeight() {
		const u = getPlot();
		heightOutput.data = `${height.value}px`;
		u.setSize(horizontal.checked
			? { width: height.valueAsNumber, height: u.height }
			: { width: u.width, height: height.valueAsNumber });
	}

	function setRotation() {
		if (!horizontal.checked) {
			output.data = `${slider.value}°`;
			getControls().setLabelRotation(slider.valueAsNumber);
		}
	}

	function setDistribution() {
		getControls().setDistribution(Number(distribution.value));
	}

	function setGroupWidth() {
		widthOutput.data = `${width.value}%`;
		getControls().setGroupWidth(width.valueAsNumber / 100);
	}

	function setLabels() {
		lengthOutput.data = maxLength.value;
		maxLength.disabled = middle.disabled = !truncate.checked;
		getControls().setLabelTruncation(truncate.checked ? maxLength.valueAsNumber : null, middle.checked ? 'middle' : 'end');
	}

	const listeners = [
		[slider, 'input', setRotation],
		[height, 'input', setHeight],
		[horizontal, 'change', setOrientation],
		[stacked, 'change', setStacking],
		[percent, 'change', setStacking],
		[distribution, 'change', setDistribution],
		[width, 'input', setGroupWidth],
		[randomize, 'click', regenerate],
		[truncate, 'change', setLabels],
		[maxLength, 'input', setLabels],
		[middle, 'change', setLabels],
	];
	for (const [el, event, handler] of listeners)
		el.addEventListener(event, handler);
	syncOrientation();
	percent.disabled = !stacked.checked;
	heightOutput.data = `${height.value}px`;
	widthOutput.data = `${width.value}%`;
	lengthOutput.data = maxLength.value;
	maxLength.disabled = middle.disabled = !truncate.checked;

	return {
		stacking() {
			return stacked.checked ? (percent.checked ? 'percent' : 'value') : 'grouped';
		},
		options() {
			return {
				orientation: horizontal.checked ? 'horizontal' : 'vertical',
				distribution: Number(distribution.value),
				bars: { size: [width.valueAsNumber / 100] },
				labelRotation: horizontal.checked ? 0 : slider.valueAsNumber,
				maxLabelLength: truncate.checked ? maxLength.valueAsNumber : null,
				ellipsis: middle.checked ? 'middle' : 'end',
			};
		},
		initialSize() {
			return horizontal.checked
				? { width: height.valueAsNumber, height: 300 }
				: { width: 1200, height: height.valueAsNumber };
		},
		readout(u) {
			const { label, width } = getControls().getLabelMetrics();
			stats.data = `Items: ${u.data[0].length} | Longest label: ${label} (${width.toFixed(1)}px) | X axis: ${u.axes[0]._size}px | Y axis: ${u.axes[1]._size}px | Y range: ${u.scales.y.min} … ${u.scales.y.max} | Left padding: ${u._padding[3]}px | Right padding: ${u._padding[1]}px`;
		},
		destroy() {
			for (const [el, event, handler] of listeners)
				el.removeEventListener(event, handler);
		},
	};
}
