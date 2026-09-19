// @ts-ignore TypeScript's classic resolver cannot follow ivi's package exports.
import { defineRoot, html, List, update, unmount } from 'ivi';

const LEGEND = 'u-legend';
const LEGEND_LIVE = 'u-live';
const LEGEND_INLINE = 'u-inline';
const LEGEND_SERIES = 'u-series';
const OFF = 'u-off';
const seriesKey = s => s;
// Core schedules explicit updates; this view has no component invalidations.
const createRoot = defineRoot(() => {});

function valueCell(value) {
	return html`<td class="u-value" .textContent=${value}></td>`;
}

function labelView(label, color) {
	if (label instanceof HTMLElement) {
		return html`<div class="u-label" ~color=${color} ${el => {
			if (el.firstChild !== label)
				el.replaceChildren(label);
		}}></div>`;
	}
	return html`<div class="u-label" ~color=${color} .textContent=${label}></div>`;
}

function headerCell(key) {
	return html`<th class="u-label" .textContent=${key}></th>`;
}

export function createLegend(self, parent, opts) {
	const {legend, series, columns, multi, mode, focusAlpha, cursorFocus, bind, emit} = opts;
	const markersShow = legend.markers.show;
	let root = createRoot(parent);
	const keys = [];
	const rowMeta = new WeakMap();
	let table;
	let values;
	let focused = null;

	for (const key in columns)
		keys.push(key);

	const head = multi ? html`<thead><tr><th></th>${keys.map(headerCell)}</tr></thead>` : null;

	function bindEvent(el, type, s, onlyTarget) {
		const bindType = type == 'focus' ? 'mouseenter' : type == 'leave' ? 'mouseleave' : type;
		const listener = bind[bindType](self, el, e => emit(type, s, e), onlyTarget);
		if (listener)
			el.addEventListener(bindType, listener);
		return listener;
	}

	function meta(s, i) {
		let state = rowMeta.get(s);

		if (state == null) {
			const markers = legend.markers;
			let border = null, background = null, color = null;
			if (i > 0) {
				if (markersShow) {
					const width = markers.width(self, i);
					if (width)
						border = width + 'px ' + markers.dash(self, i) + ' ' + markers.stroke(self, i);
					background = markers.fill(self, i);
				}
				else
					color = s.width > 0 ? markers.stroke(self, i) : markers.fill(self, i);
			}
			let click, focus;
			state = {
				bind: el => {
					click = bindEvent(el, 'click', s, false);
					if (cursorFocus)
						focus = bindEvent(el, 'focus', s, false);
				},
				unbind: el => {
					click && el.removeEventListener('click', click);
					focus && el.removeEventListener('mouseenter', focus);
				},
				label: labelView(s.label, color),
				marker: markersShow ? html`<div class="u-marker" ~border=${border} ~background=${background}></div>` : null,
			};
			rowMeta.set(s, state);
		}

		return state;
	}


	function rowView(s, i) {
		if (i == 0 && (multi || !legend.live || mode == 2))
			return null;

		const state = meta(s, i);
		const className = LEGEND_SERIES + (s.class ? ' ' + s.class : '') + (s.show ? '' : ' ' + OFF);
		const opacity = focusAlpha != 1 && focused != null && i > 0 && s != focused ? focusAlpha : null;
		const vals = values[i];
		const cellViews = keys.length == 0 ? null : keys.length == 1
			? valueCell(vals == null ? '--' : vals[keys[0]])
			: keys.map(key => valueCell(vals == null ? '--' : vals[key]));

		const bindRow = i > 0 ? state.bind : state.unbind;

		return html`<tr class=${className} ~opacity=${opacity}><th ${bindRow}>${state.marker}${state.label}</th>${cellViews}</tr>`;
	}


	function view() {
		const className = LEGEND + (!multi ? ' ' + LEGEND_INLINE + (legend.live ? ' ' + LEGEND_LIVE : '') : '');
		return html`<table class=${className} ${capture}>${head}<tbody>${List(series, seriesKey, rowView)}</tbody></table>`;
	}

	const capture = el => {
		table = el;
		cursorFocus && bindEvent(el, 'leave', null, true);
	};

	return {
		render(data, focus) {
			if (root == null)
				return;

			values = data;
			focused = focus;
			const mount = table == null;
			update(root, view());
			if (mount)
				legend.mount(self, table);
		},
		destroy() {
			if (root != null) {
				unmount(root, false);
				root = null;
				table?.remove();
			}
		},
	};
}
