import { createKeyedList } from './keyed-list.js';
import { createLegendTemplate } from './legend-dom-template.js';

const seriesKey = entry => entry.series;

// selectRows is an internal prototype seam, not a public uPlot option.
// Entries retain their core index regardless of display order or visibility.
export function createLegend(self, parent, opts, selectRows) {
	const {series, legend, columns, multi, mode} = opts;
	const markersShow = legend.markers.show;
	const keys = [];
	for (const key in columns)
		keys.push(key);

	const entriesBySeries = new WeakMap();
	const entries = [];
	let template, rows;
	let destroyed = false;

	function select(data) {
		let count = 0;
		for (let index = 0; index < series.length; index++) {
			if (index == 0 && (multi || !legend.live || mode == 2))
				continue;

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
		render(data, focus) {
			if (destroyed)
				return;

			const mount = template == null;
			if (mount) {
				template = createLegendTemplate(self, opts, keys, markersShow);
				rows = createKeyedList(template.body, seriesKey, template.createRow);
			}

			const selected = select(data);
			for (let i = 0; i < selected.length; i++)
				template.prepare(selected[i]);
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
