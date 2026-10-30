import { createKeyedList } from './keyed-list.js';
import { createLegendTemplate } from './legend-dom-template.js';

const seriesKey = entry => entry.series;

function columnKeys(columns) {
	const keys = [];
	for (const key in columns)
		keys.push(key);
	return keys;
}

// selectRows is an internal prototype seam, not a public uPlot option.
// Entries retain their core index regardless of display order or visibility.
export function createLegend(self, parent, opts, selectRows) {
	const {series, legend, mode} = opts;
	const markersShow = legend.markers.show;
	let keys = columnKeys(opts.columns);
	let multi = opts.multi;

	const entriesBySeries = new WeakMap();
	const entries = [];
	let template, rows;
	let destroyed = false;

	function select(data) {
		let count = 0;
		const order = legend.order;
		const length = order == null ? series.length - 1 : order.length;
		const start = multi || !legend.live || mode == 2 ? 0 : -1;
		for (let i = start; i < length; i++) {
			const index = i == -1 ? 0 : order == null ? i + 1 : order[i];
			const s = series[index];
			let entry = entriesBySeries.get(s);
			if (entry == null) {
				entry = {series: s, index};
				entriesBySeries.set(s, entry);
			}
			else
				entry.index = index;
			entries[count++] = entry;
		}
		entries.length = count;
		return selectRows ? selectRows(entries, data) : entries;
	}

	return {
		setColumns(columns, nextMulti) {
			if (destroyed)
				return;

			const nextKeys = columnKeys(columns);
			if (multi === nextMulti && keys.length === nextKeys.length && keys.every((key, i) => key === nextKeys[i]))
				return;

			keys = nextKeys;
			multi = nextMulti;
			rows?.destroy();
			template?.setColumns(keys, multi);
		},
		render(data, focus) {
			if (destroyed)
				return;

			const mount = template == null;
			if (mount) {
				template = createLegendTemplate(self, {...opts, multi}, keys, markersShow);
				rows = createKeyedList(template.body, seriesKey, template.createRow);
			}

			const selected = select(data);
			template.update(data, focus);
			rows.update(selected);

			if (mount) {
				parent.appendChild(template.node);
				legend.mount(self, template.node);
			}
		},
		destroy() {
			if (!destroyed) {
				destroyed = true;
				rows?.destroy();
				template?.destroy();
				template?.node.remove();
				rows = template = null;
				entries.length = 0;
			}
		},
	};
}
