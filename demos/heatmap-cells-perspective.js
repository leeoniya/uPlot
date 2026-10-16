import { readCells, gridShape, palette, colorBoundary, format } from './heatmap-cells-compare.js';

export const timeColumn = 'Time';
export const bucketColumn = 'Bucket center (log2 seconds)';
export const countColumn = 'Count';

export function prepareData(frames) {
	const cells = readCells(frames);
	const grid = gridShape(cells);
	const logMin = Math.log2(cells.minY), logStep = grid.logStep / Math.LN2;
	// Perspective sizes uniform bands from adjacent numeric centers, not cell edges.
	const time = cells.times.map(t => t - cells.xSize / 2);
	const bucket = cells.yMin.map(y => logMin + (Math.round(Math.log(y / cells.minY) / grid.logStep) + .5) * logStep);
	return { ...cells, ...grid, columns: { [timeColumn]: time, [bucketColumn]: bucket, [countColumn]: cells.counts } };
}

export function colorGradient(min, max, mode) {
	if (min == max) return `linear-gradient(to right, ${palette[0]}, ${palette[0]})`;
	const stops = [`${palette[0]} 0%`];
	for (let i = 0; i < palette.length - 1; i++) {
		const value = colorBoundary((i + .5) / (palette.length - 1), min, max, mode);
		// Perspective maps positive counts into [50%, 100%] of its diverging gradient.
		const percent = 50 + 50 * value / max;
		stops.push(`${palette[i]} ${percent}%`, `${palette[i + 1]} ${percent}%`);
	}
	stops.push(`${palette.at(-1)} 100%`);
	return `linear-gradient(to right, ${stops.join(', ')})`;
}

export function viewerConfig(cells, mode) {
	return {
		table: 'heatmap-cells', plugin: 'Heatmap', theme: 'Pro Dark', settings: false,
		group_by: [timeColumn], split_by: [bucketColumn], columns: [countColumn],
		aggregates: { [countColumn]: 'sum', [timeColumn]: 'any', [bucketColumn]: 'any' },
	sort: [[timeColumn, 'asc'], [bucketColumn, 'col asc']],
		plugin_config: { legend_mode: 'none' },
		columns_config: {
			[countColumn]: { number_format: { maximumSignificantDigits: 5 }, gradient: colorGradient(cells.minCount, cells.maxCount, mode) },
		},
	};
}

export async function createDemo(root, frames, perspective) {
	if (!perspective?.worker) throw new Error('Perspective did not load');
	const cells = prepareData(frames);
	const host = root.querySelector('#plot');
	const viewer = root.querySelector('perspective-viewer');
	const height = root.querySelector('#height');
	const mode = root.querySelector('#color-scale');
	const button = root.querySelector('#set-data');
	const status = root.querySelector('#status');
	let client, table, disposed = false;
	let pending = Promise.resolve();
	const setDisabled = value => { height.disabled = mode.disabled = button.disabled = value; };
	const colorLabel = () => {
		root.querySelector('#color-scale-label').textContent = `Count · ${mode.value == 'sqrt' ? '√' : mode.value} scale`;
	};
	const dispose = async () => {
		try { await viewer.delete(); }
		finally {
			try { await table?.delete(); }
			finally { await client?.terminate(); }
		}
	};
	try {
		colorLabel();
		client = await perspective.worker();
		table = await client.table({ [timeColumn]: 'datetime', [bucketColumn]: 'float', [countColumn]: 'float' }, { name: 'heatmap-cells' });
		await table.update(cells.columns);
		// Loading the client avoids a default chart render before the configured heatmap.
		await viewer.load(client);
		await viewer.restore(viewerConfig(cells, mode.value));
		await viewer.flush();
	}
	catch (error) {
		await dispose().catch(() => {});
		throw error;
	}
	root.querySelector('#color-ramp').style.background = `linear-gradient(to right, ${palette.join(',')})`;
	root.querySelector('#color-min').textContent = format(cells.minCount);
	root.querySelector('#color-max').textContent = format(cells.maxCount);
	root.querySelector('#hover').textContent = 'Native hover shows time center, log2 bucket center, and original count. Wheel to zoom; drag to pan; use Reset Zoom to reset.';
	status.textContent = `${cells.times.length.toLocaleString()} cells · native WebGL heatmap · sparse table → pivoted view · numeric log2 bucket coordinates`;
	// Keep async table/style updates ordered; never append another copy of the cells.
	const update = action => {
		setDisabled(true);
		pending = pending.then(action).then(() => viewer.flush()).catch(error => {
			status.textContent = `Cannot update heatmap: ${error.message ?? error}`;
			console.error(error);
		}).finally(() => { if (!disposed) setDisabled(false); });
	};
	const setHeight = () => {
		host.style.height = `${height.value}px`;
		root.querySelector('#height-value').textContent = `${height.value}px`;
		// The viewer's native ResizeObserver handles height and window-size changes.
	};
	const setColor = () => update(async () => {
		await viewer.restore({ columns_config: viewerConfig(cells, mode.value).columns_config });
		colorLabel();
	});
	const setData = () => update(() => table.replace(cells.columns));
	height.addEventListener('input', setHeight);
	mode.addEventListener('change', setColor);
	button.addEventListener('click', setData);
	setDisabled(false);
	return {
		plot: viewer, table,
		async destroy() {
			if (disposed) return;
			disposed = true;
			setDisabled(true);
			height.removeEventListener('input', setHeight);
			mode.removeEventListener('change', setColor);
			button.removeEventListener('click', setData);
			await pending;
			await dispose();
			viewer.remove();
		},
	};
}
