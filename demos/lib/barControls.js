// HTML form wiring for the axis-label-rotation demo, not bar chart logic.
export function createBarControls(root, { getPlot, getControls, rebuild, regenerate }) {
	function readoutNode(id) {
		const el = root.querySelector(id);
		return el.firstChild ?? el.appendChild(document.createTextNode(''));
	}

	const slider = root.querySelector('#rotation');
	const output = readoutNode('#rotation-value');
	const labelSpacing = root.querySelector('#label-spacing');
	const spacingOutput = readoutNode('#label-spacing-value');
	const plotSlot = root.querySelector('#plot');
	const orientation = Array.from(root.querySelectorAll('input[name="orientation"]'));
	const horizontal = root.querySelector('#horizontal');
	const stacking = Array.from(root.querySelectorAll('input[name="stacking"]'));
	const showValues = root.querySelector('#show-values');
	const showTotals = root.querySelector('#show-totals');
	const hoverModes = Array.from(root.querySelectorAll('input[name="hover-mode"]'));
	const distribution = root.querySelector('#distribution');
	const width = root.querySelector('#group-width');
	const widthOutput = readoutNode('#group-width-value');
	const barDistribution = root.querySelector('#bar-distribution');
	const barWidth = root.querySelector('#bar-width');
	const barWidthOutput = readoutNode('#bar-width-value');
	const stats = readoutNode('#stats');
	const randomize = root.querySelector('#randomize');
	const seriesCount = root.querySelector('#series-count');
	const seriesCountOutput = readoutNode('#series-count-value');
	const maxLength = root.querySelector('#max-length');
	const lengthOutput = readoutNode('#max-length-value');
	const ellipsis = Array.from(root.querySelectorAll('input[name="ellipsis"]'));
	const middle = root.querySelector('#middle-ellipsis');
	let active = true;
	const resizeObserver = new ResizeObserver(entries => {
		if (!active)
			return;
		const rect = entries.find(entry => entry.target == plotSlot)?.contentRect;
		if (rect == null)
			return;
		const width = Math.floor(rect.width), height = Math.floor(rect.height);
		const u = getPlot();
		if (u != null && Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 &&
			(width != u.width || height != u.height))
			u.setSize({ width, height });
	});
	// The grid slot excludes the legend and cannot grow with the canvas it contains.
	resizeObserver.observe(plotSlot);

	function syncOrientation() {
		slider.disabled = horizontal.checked;
		output.data = `${horizontal.checked ? 0 : slider.value}°`;
	}

	function setOrientation() {
		const { width, height } = getPlot();
		rebuild({ width, height });
		syncOrientation();
	}

	function stackingMode() {
		return stacking.find(el => el.checked).value;
	}

	function syncTotals() {
		showTotals.disabled = stackingMode() != 'grouped';
	}

	function setStacking() {
		syncTotals();
		const { width, height } = getPlot();
		rebuild({ width, height });
	}

	function setSeriesCount() {
		seriesCountOutput.data = seriesCount.value;
		const { width, height } = getPlot();
		rebuild({ width, height }, true);
	}

	function setRotation() {
		if (!horizontal.checked) {
			output.data = `${slider.value}°`;
			getControls().setLabelRotation(slider.valueAsNumber);
		}
	}

	function setLabelSpacing() {
		spacingOutput.data = `${labelSpacing.value}px`;
		getControls().setMinLabelSpacing(labelSpacing.valueAsNumber);
	}

	function setShowValues() {
		getControls().setShowValues(showValues.checked);
	}

	function hoverMode() {
		return hoverModes.find(el => el.checked).value;
	}

	function setHoverMode() {
		getControls().setHoverMode(hoverMode());
	}

	function setDistribution() {
		getControls().setDistribution(Number(distribution.value));
	}

	function setGroupWidth() {
		widthOutput.data = `${width.value}%`;
		getControls().setGroupWidth(width.valueAsNumber / 100);
	}

	function setBarDistribution() {
		getControls().setBarDistribution(Number(barDistribution.value));
	}

	function setBarWidth() {
		barWidthOutput.data = `${barWidth.value}%`;
		getControls().setBarWidth(barWidth.valueAsNumber / 100);
	}

	function setLabels() {
		lengthOutput.data = maxLength.valueAsNumber == 0 ? 'Off' : maxLength.value;
		getControls().setLabelTruncation(maxLength.valueAsNumber || null, middle.checked ? 'middle' : 'end');
	}

	const listeners = [
		[slider, 'input', setRotation],
		[labelSpacing, 'input', setLabelSpacing],
		...orientation.map(el => [el, 'change', setOrientation]),
		...stacking.map(el => [el, 'change', setStacking]),
		[showValues, 'change', setShowValues],
		[showTotals, 'change', setStacking],
		...hoverModes.map(el => [el, 'change', setHoverMode]),
		[distribution, 'change', setDistribution],
		[width, 'input', setGroupWidth],
		[barDistribution, 'change', setBarDistribution],
		[barWidth, 'input', setBarWidth],
		[randomize, 'click', regenerate],
		[seriesCount, 'input', setSeriesCount],
		[maxLength, 'input', setLabels],
		...ellipsis.map(el => [el, 'change', setLabels]),
	];
	for (const [el, event, handler] of listeners)
		el.addEventListener(event, handler);
	syncOrientation();
	syncTotals();

	seriesCountOutput.data = seriesCount.value;
	spacingOutput.data = `${labelSpacing.value}px`;
	widthOutput.data = `${width.value}%`;
	barWidthOutput.data = `${barWidth.value}%`;
	lengthOutput.data = maxLength.valueAsNumber == 0 ? 'Off' : maxLength.value;

	return {
		seriesCount: () => seriesCount.valueAsNumber,
		stacking: stackingMode,
		totals() {
			return stackingMode() == 'grouped' && showTotals.checked;
		},
		options() {
			return {
				orientation: horizontal.checked ? 'horizontal' : 'vertical',
				showValues: showValues.checked,
				hoverMode: hoverMode(),
				distribution: Number(distribution.value),
				barDistribution: Number(barDistribution.value),
				barWidth: barWidth.valueAsNumber / 100,
				bars: { size: [width.valueAsNumber / 100] },
				labelRotation: horizontal.checked ? 0 : slider.valueAsNumber,
				minLabelSpacing: labelSpacing.valueAsNumber,
				maxLabelLength: maxLength.valueAsNumber || null,
				ellipsis: middle.checked ? 'middle' : 'end',
			};
		},
		initialSize() {
			return { width: plotSlot.clientWidth || 1200, height: plotSlot.clientHeight || 500 };
		},
		readout(u) {
			const { label, width } = getControls().getLabelMetrics();
			stats.data = `Items: ${u.data[0].length} | Longest label: ${label} (${width.toFixed(1)}px) | X axis: ${u.axes[0]._size}px | Y axis: ${u.axes[1]._size}px | Y range: ${u.scales.y.min} … ${u.scales.y.max} | Left padding: ${u._padding[3]}px | Right padding: ${u._padding[1]}px`;
		},
		destroy() {
			active = false;
			resizeObserver.disconnect();
			for (const [el, event, handler] of listeners)
				el.removeEventListener(event, handler);
		},
	};
}
