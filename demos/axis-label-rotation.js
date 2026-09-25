import uPlot from '../src/uPlot.js';
import { barChartPlugin } from './lib/barChartPlugin.js';

export function createDemo(root) {
	function readoutNode(id) {
		const el = root.querySelector(id);
		return el.firstChild ?? el.appendChild(document.createTextNode(''));
	}

	const adjectives = ['Tiny', 'Bright', 'Quiet', 'Swift', 'Gentle', 'Bold', 'Silver', 'Merry'];
	const nouns = ['fox', 'owl', 'panda', 'otter', 'tiger', 'robin', 'badger', 'raven'];
	const verbs = ['runs', 'jumps', 'sings', 'rests', 'dances', 'glides', 'swims', 'plays'];
	const pick = words => words[Math.floor(Math.random() * words.length)];

	const slider = root.querySelector('#rotation');
	const output = readoutNode('#rotation-value');
	const height = root.querySelector('#height');
	const heightOutput = readoutNode('#height-value');
	const heightLabel = readoutNode('#height-label');
	const horizontal = root.querySelector('#horizontal');
	const stats = readoutNode('#stats');
	const randomize = root.querySelector('#randomize');
	const truncate = root.querySelector('#truncate');
	const maxLength = root.querySelector('#max-length');
	const lengthOutput = readoutNode('#max-length-value');
	const middle = root.querySelector('#middle-ellipsis');
	let bars;

	function readout(u) {
		const { label, width } = bars._getLabelMetrics();
		stats.data = `Items: ${u.data[0].length} | Longest label: ${label} (${width.toFixed(1)}px) | X axis: ${u.axes[0]._size}px | Y axis: ${u.axes[1]._size}px | Y range: ${u.scales.y.min} … ${u.scales.y.max} | Left padding: ${u._padding[3]}px | Right padding: ${u._padding[1]}px`;
	}

	function newData() {
		const names = Array.from({ length: 3 + Math.floor(Math.random() * 13) }, () => {
			const count = 1 + Math.floor(Math.random() * 3);
			const words = count == 1 ? [pick(nouns)] : [pick(adjectives), pick(nouns)];
			if (count == 3)
				words.push(pick(verbs));
			return words.join(' ');
		});
		const magnitude = 10 ** (Math.floor(Math.random() * 13) - 5);
		const offset = magnitude * (Math.random() * 2 - 1);
		const spread = magnitude * (.5 + Math.random() * 1.5);
		return [names, names.map(() => offset + spread * Math.random())];
	}

	function createPlot(data, size, pxRatio) {
		bars = barChartPlugin({
			orientation: horizontal.checked ? 'horizontal' : 'vertical',
			labelRotation: horizontal.checked ? 0 : slider.valueAsNumber,
			maxLabelLength: truncate.checked ? maxLength.valueAsNumber : null,
			ellipsis: middle.checked ? 'middle' : 'end',
		});
		return new uPlot({
			...size,
			pxRatio,
			series: [{ label: 'Item' }, { label: 'Value', fill: 'royalblue' }],
			plugins: [bars],
			hooks: { draw: [readout] },
		}, data, root.querySelector('#plot'));
	}

	let u = createPlot(newData(), horizontal.checked
		? { width: height.valueAsNumber, height: 300 }
		: { width: 1200, height: height.valueAsNumber });

	function syncOrientation() {
		slider.disabled = horizontal.checked;
		output.data = `${horizontal.checked ? 0 : slider.value}°`;
		heightLabel.data = horizontal.checked ? 'Chart width' : 'Chart height';
	}

	function setOrientation() {
		const { data, width, height, pxRatio } = u;
		u.destroy();
		u = createPlot(data, horizontal.checked
			? { width: height, height: width / 4 }
			: { width: height * 4, height: width }, pxRatio);
		syncOrientation();
	}

	function setHeight() {
		heightOutput.data = `${height.value}px`;
		u.setSize(horizontal.checked
			? { width: height.valueAsNumber, height: u.height }
			: { width: u.width, height: height.valueAsNumber });
	}

	function setRotation() {
		if (!horizontal.checked) {
			output.data = `${slider.value}°`;
			bars._setLabelRotation(slider.valueAsNumber);
		}
	}

	function setLabels() {
		lengthOutput.data = maxLength.value;
		maxLength.disabled = middle.disabled = !truncate.checked;
		bars._setLabelTruncation(truncate.checked ? maxLength.valueAsNumber : null, middle.checked ? 'middle' : 'end');
	}

	function regenerate() {
		u.setData(newData());
	}

	function destroy() {
		slider.removeEventListener('input', setRotation);
		height.removeEventListener('input', setHeight);
		horizontal.removeEventListener('change', setOrientation);
		randomize.removeEventListener('click', regenerate);
		truncate.removeEventListener('change', setLabels);
		maxLength.removeEventListener('input', setLabels);
		middle.removeEventListener('change', setLabels);
		u?.destroy();
		u = null;
	}

	slider.addEventListener('input', setRotation);
	height.addEventListener('input', setHeight);
	horizontal.addEventListener('change', setOrientation);
	randomize.addEventListener('click', regenerate);
	truncate.addEventListener('change', setLabels);
	maxLength.addEventListener('input', setLabels);
	middle.addEventListener('change', setLabels);
	syncOrientation();
	heightOutput.data = `${height.value}px`;
	maxLength.disabled = middle.disabled = !truncate.checked;

	return { get plot() { return u; }, destroy };
}
