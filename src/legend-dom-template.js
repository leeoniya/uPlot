import { h } from './h.js';
import { on, off } from './dom.js';
import { LEGEND, LEGEND_LIVE, LEGEND_INLINE, LEGEND_SERIES, LEGEND_MARKER, LEGEND_LABEL, LEGEND_VALUE, OFF } from './domClasses.js';
import { mouseenter, mouseleave, LEGEND_DISP } from './strings.js';

function textValue(value) {
	return value == null || value === false ? '' : String(value);
}

function setText(node, text) {
	if (text == '') {
		if (node.firstChild != null)
			node.textContent = '';
	}
	else if (node.firstChild != null)
		node.firstChild.nodeValue = text;
	else
		node.textContent = text;
}

// The adapter selects entries and prepares them in forward order before reconciliation.
// It also owns table placement, legend.mount, and removal; rows own only their contents.
export function createLegendTemplate(self, opts, keys, markersShow) {
	const {legend, multi, focusAlpha, cursorFocus, bind, emit} = opts;
	const rowMeta = new WeakMap();
	let body;
	const node = h('table', null,
		multi && h('thead', null,
			h('tr', null,
				h('th'),
				keys.map(key => h('th', {className: LEGEND_LABEL}, key)),
			),
		),
		body = h('tbody'),
	);
	let values = [];
	let focused = null;
	let tableClass;

	function bindEvent(el, type, series, onlyTarget) {
		const bindType = type == 'focus' ? mouseenter : type == 'leave' ? mouseleave : type;
		const listener = bind[bindType](self, el, e => emit(type, series, e), onlyTarget);
		if (listener)
			on(bindType, el, listener);
		return listener;
	}

	let leave = cursorFocus ? bindEvent(node, 'leave', null, true) : null;

	function prepare({series, index}) {
		let state = rowMeta.get(series);
		if (state == null) {
			const markers = legend.markers;
			let border = null, background = null, color = null;
			if (index > 0) {
				if (markersShow) {
					const width = markers.width(self, index);
					if (width)
						border = width + 'px ' + markers.dash(self, index) + ' ' + markers.stroke(self, index);
					background = markers.fill(self, index);
				}
				else
					color = series.width > 0 ? markers.stroke(self, index) : markers.fill(self, index);
			}
			const label = series.label;
			state = { label: label instanceof HTMLElement ? label : textValue(label), border, background, color };
			rowMeta.set(series, state);
		}
		return state;
	}

	function createRow(entry) {
		const state = prepare(entry);
		let header, label, cells;
		const row = h('tr', null,
			header = h('th', null,
				markersShow && h('div', {
					className: LEGEND_MARKER,
					style: {border: state.border, background: state.background},
				}),
				label = h('div', {className: LEGEND_LABEL, style: {color: state.color}},
					state.label,
				),
			),
			cells = keys.map(() => h('td', {className: LEGEND_VALUE})),
		);
		const cellValues = Array(keys.length).fill('');
		let className;
		let opacity = null;
		let bound = false;
		let click, focus;

		function unbind() {
			if (click)
				off('click', header, click);
			if (focus)
				off(mouseenter, header, focus);
			click = focus = null;
			bound = false;
		}

		return {
			node: row,
			update({series, index}) {
				const nextClass = LEGEND_SERIES + (series.class ? ' ' + series.class : '') + (series.show ? '' : ' ' + OFF);
				if (nextClass !== className) {
					row.className = className = nextClass;
				}

				const nextOpacity = focusAlpha != 1 && focused != null && index > 0 && series != focused ? focusAlpha : null;
				if (nextOpacity !== opacity) {
					row.style.opacity = nextOpacity == null ? '' : nextOpacity;
					opacity = nextOpacity;
				}

				const eligible = index > 0;
				if (eligible !== bound) {
					if (eligible) {
						click = bindEvent(header, 'click', series, false);
						if (cursorFocus)
							focus = bindEvent(header, 'focus', series, false);
						// Null listeners still count as a completed binding transition.
						bound = true;
					}
					else
						unbind();
				}

				const vals = values[index];
				for (let i = 0; i < keys.length; i++) {
					const text = textValue(vals == null ? LEGEND_DISP : vals[keys[i]]);
					if (text !== cellValues[i]) {
						setText(cells[i], text);
						cellValues[i] = text;
					}
				}
			},
			destroy() {
				unbind();
				// Keep the supplied label, not its discarded row and value cells.
				if (state.label instanceof HTMLElement && state.label.parentNode === label)
					label.removeChild(state.label);
			},
		};
	}

	return {
		node,
		body,
		prepare,
		createRow,
		update(data, focusedSeries) {
			values = data;
			focused = focusedSeries;
			const className = LEGEND + (!multi ? ' ' + LEGEND_INLINE + (legend.live ? ' ' + LEGEND_LIVE : '') : '');
			if (className !== tableClass)
				node.className = tableClass = className;
		},
		destroy() {
			if (leave)
				off(mouseleave, node, leave);
			leave = null;
		},
	};
}
