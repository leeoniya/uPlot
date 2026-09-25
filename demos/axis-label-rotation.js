import uPlot from '../src/uPlot.js';

export function createDemo(root) {
	function readoutNode(id) {
		const el = root.querySelector(id);
		return el.firstChild ?? el.appendChild(document.createTextNode(''));
	}

	const adjectives = ['Tiny', 'Bright', 'Quiet', 'Swift', 'Gentle', 'Bold', 'Silver', 'Merry'];
	const nouns = ['fox', 'owl', 'panda', 'otter', 'tiger', 'robin', 'badger', 'raven'];
	const verbs = ['runs', 'jumps', 'sings', 'rests', 'dances', 'glides', 'swims', 'plays'];
	const pick = words => words[Math.floor(Math.random() * words.length)];
	let names = [];
	let xs = [];
	const slider = root.querySelector('#rotation');
	const output = readoutNode('#rotation-value');
	const height = root.querySelector('#height');
	const heightOutput = readoutNode('#height-value');
	const stats = readoutNode('#stats');
	const randomize = root.querySelector('#randomize');
	const truncate = root.querySelector('#truncate');
	const maxLength = root.querySelector('#max-length');
	const lengthOutput = readoutNode('#max-length-value');
	const middle = root.querySelector('#middle-ellipsis');
	const inset = 8;
	let labels = [];
	const measured = [null, null];
	let rotation = slider.valueAsNumber;
	let labelWidth = 0;
	let longestLabel = '';
	let leftFactor = .5;
	let rightFactor = .5;
	let labelOffset = 0;

	function measureLabels(u, axisIdx, values) {
		const axis = u.axes[axisIdx];
		let cache = measured[axisIdx];
		if (cache == null || cache.font != axis.font[0] || cache.pxRatio != u.pxRatio ||
			cache.values.length != values.length || values.some((value, i) => value != cache.values[i])) {
			cache = { font: axis.font[0], pxRatio: u.pxRatio, values: values.slice(), widths: [], width: 0, label: '' };
			const ctx = u.ctx;
			ctx.save();
			ctx.font = axis.font[0];
			for (const value of values) {
				const width = value == null ? 0 : ctx.measureText(String(value)).width / u.pxRatio;
				cache.widths.push(width);
				if (width > cache.width) {
					cache.width = width;
					cache.label = value;
				}
			}
			ctx.restore();
			measured[axisIdx] = cache;
		}
		return cache;
	}

	function axisSize(u, values, axisIdx) {
		const axis = u.axes[axisIdx];
		// Horizontal size runs before ticks; its formatted labels are already known.
		const measured = measureLabels(u, axisIdx, labels);
		labelWidth = measured.width;
		longestLabel = measured.label;
		const labelHeight = axis.font[1] / u.pxRatio;
		const radians = Math.abs(rotation) * Math.PI / 180;
		const sin = Math.sin(radians);
		const cos = Math.cos(radians);
		let height;

		if (rotation == 0) {
			leftFactor = rightFactor = .5;
			labelOffset = 0;
			height = labelHeight;
		}
		else {
			// Rotated labels use a middle baseline and align toward the tick.
			labelOffset = labelHeight / 2 * sin;
			leftFactor = rotation > 0 ? cos : 0;
			rightFactor = rotation < 0 ? cos : 0;
			height = labelWidth * sin + labelHeight / 2 * cos;
		}

		return Math.ceil(axis.ticks.size + axis.gap + height + inset);
	}

	function yAxisSize(u, values, axisIdx) {
		const axis = u.axes[axisIdx];
		return Math.ceil(axis.ticks.size + axis.gap + measureLabels(u, axisIdx, values).width + inset);
	}

	function padding(u, side, sidesWithAxes, phase) {
		if (phase == 0)
			return inset;

		const axisSpace = [0, 0, 0, 0];
		for (const axis of u.axes) {
			if (axis._show)
				axisSpace[axis.side] += Math.max(0, axis._size + (axis.label != null ? axis.labelSize : 0));
		}

		const leftPad = Math.max(inset, Math.ceil(inset + labelWidth * leftFactor + labelOffset - axisSpace[3]));
		const rightPad = Math.max(inset, Math.ceil(inset + labelWidth * rightFactor + labelOffset - axisSpace[1]));
		// Full overhang padding gives a lower bound on plot width, independent
		// of the final geometry. Credit each label's distance from this edge.
		const minWidth = Math.max(0, u.width - axisSpace[3] - axisSpace[1] - leftPad - rightPad);
		const factor = side == 3 ? leftFactor : rightFactor;
		const widths = measured[0].widths;
		let pad = inset;
		for (let i = 0; i < widths.length; i++) {
			const fraction = (side == 3 ? i + .5 : widths.length - i - .5) / widths.length;
			const extent = widths[i] * factor + labelOffset;
			pad = Math.max(pad, inset + extent - axisSpace[side] - fraction * minWidth);
		}
		return Math.ceil(pad);
	}

	function readout(u) {
		stats.data = `Items: ${xs.length} | Longest label: ${longestLabel} (${labelWidth.toFixed(1)}px) | X axis: ${u.axes[0]._size}px | Y axis: ${u.axes[1]._size}px | Y range: ${u.scales.y.min} … ${u.scales.y.max} | Left padding: ${u._padding[3]}px | Right padding: ${u._padding[1]}px`;
	}

	function newData() {
		xs = Array.from({ length: 3 + Math.floor(Math.random() * 13) }, (_, i) => i);
		names = xs.map(() => {
			const count = 1 + Math.floor(Math.random() * 3);
			const words = count == 1 ? [pick(nouns)] : [pick(adjectives), pick(nouns)];
			if (count == 3)
				words.push(pick(verbs));
			return words.join(' ');
		});
		labels = formatLabels();
		const magnitude = 10 ** (Math.floor(Math.random() * 13) - 5);
		const offset = magnitude * (Math.random() * 2 - 1);
		const spread = magnitude * (.5 + Math.random() * 1.5);
		return [xs, xs.map(() => offset + spread * Math.random())];
	}
	const u = new uPlot({
		width: 1200,
		height: height.valueAsNumber,
		padding: [inset, padding, inset, padding],
		cursor: { drag: { setScale: false } },
		scales: {
			x: { time: false, distr: 2, range: () => [-.5, xs.length - .5] },
			y: { axis: 1, range: { min: { soft: 0 }, max: { soft: 0 } } },
		},
		axes: [
			{

				space: 1,
				splits: () => xs,
				values: (u, splits) => splits.map(i => labels[i]),
				rotate: () => rotation,
				size: axisSize,
				grid: { show: false },
			},
			{ size: yAxisSize },
		],
		series: [
			{ label: 'Item', value: (u, value) => names[value] ?? '' },
			{ label: 'Value', paths: uPlot.paths.bars(), fill: 'royalblue', width: 0, points: { show: false } },
		],
		hooks: {
			draw: [readout],
			destroy: [() => {
				slider.removeEventListener('input', setRotation);
				height.removeEventListener('input', setHeight);
				randomize.removeEventListener('click', regenerate);
				truncate.removeEventListener('change', setLabels);
				maxLength.removeEventListener('input', setLabels);
				middle.removeEventListener('change', setLabels);
			}],
		},
	}, newData(), root.querySelector('#plot'));

	function setHeight() {
		heightOutput.data = `${height.value}px`;
		u.setSize({ width: u.width, height: height.valueAsNumber });
	}

	function setRotation() {
		rotation = slider.valueAsNumber;
		output.data = `${rotation}°`;
		u.redraw(false, true);
	}

	function formatLabels() {
		const limit = maxLength.valueAsNumber;
		return names.map(name => {
			if (!truncate.checked || name.length <= limit)
				return name;

			const keep = limit - 1;
			return middle.checked
				? name.slice(0, Math.ceil(keep / 2)) + '…' + name.slice(-Math.floor(keep / 2))
				: name.slice(0, keep) + '…';
		});
	}

	function setLabels() {
		lengthOutput.data = maxLength.value;
		maxLength.disabled = middle.disabled = !truncate.checked;
		const next = formatLabels();

		if (next.length != labels.length || next.some((label, i) => label != labels[i])) {
			labels = next;
			u.redraw(false, true);
		}
	}

	function regenerate() {
		u.setData(newData());
	}

	slider.addEventListener('input', setRotation);
	height.addEventListener('input', setHeight);
	randomize.addEventListener('click', regenerate);
	truncate.addEventListener('change', setLabels);
	maxLength.addEventListener('input', setLabels);
	middle.addEventListener('change', setLabels);
	output.data = `${rotation}°`;
	heightOutput.data = `${height.value}px`;

	return u;
}
