import { h } from './h.js';
import { on, off } from './dom.js';
import { LEGEND, LEGEND_LIVE, LEGEND_INLINE, LEGEND_SERIES, LEGEND_MARKER, LEGEND_LABEL, LEGEND_VALUE, LEGEND_SIDES, OFF, FOCUS } from './domClasses.js';
import { mouseenter, mouseleave, LEGEND_DISP } from './strings.js';

function textValue(value) {
	return value == null || value === false ? '' : String(value);
}

function setText(node, text) {
	// Keep the text node when clearing a value so hover transitions can reuse it.
	if (node.firstChild != null)
		node.firstChild.nodeValue = text;
	else
		node.textContent = text;
}

function createValueCells(keys) {
	const nodes = keys.map(() => h('td', {className: LEGEND_VALUE}));
	const previous = Array(keys.length).fill('');

	return {
		nodes,
		update(values) {
			for (let i = 0; i < keys.length; i++) {
				const text = textValue(values == null ? LEGEND_DISP : values[keys[i]]);
				if (text !== previous[i]) {
					setText(nodes[i], text);
					previous[i] = text;
				}
			}
		},
	};
}

// The adapter owns selection, table placement, legend.mount, and removal.
// Rows prepare their metadata on creation and own only their contents.
export function createLegendTemplate(self, opts, keys, markersShow) {
	const {legend, cursorFocus, bind, emit, interactive = true} = opts;
	let multi = opts.multi;
	let inline;
	const sideClass = LEGEND_SIDES[opts.side ?? legend.side ?? 2];
	const rowMeta = new WeakMap();
	const body = h('tbody');
	const node = h('table', null, body);
	let head;

	function setColumns(nextKeys, nextMulti) {
		keys = nextKeys;
		multi = nextMulti;
		inline = legend.mode == null ? !multi : legend.mode == 'inline';
		head?.remove();
		head = multi ? h('thead', null,
			h('tr', null,
				h('th'),
				keys.map(key => h('th', {className: LEGEND_LABEL}, key)),
			),
		) : null;
		if (head)
			node.insertBefore(head, body);
	}

	setColumns(keys, multi);
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

	function createRowEvents(header, series) {
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
			update(eligible) {
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
			},
			destroy: unbind,
		};
	}

	let leave = interactive && cursorFocus ? bindEvent(node, 'leave', null, true) : null;

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
			state = { label: label instanceof HTMLElement ? (interactive ? label : label.cloneNode(true)) : textValue(label), border, background, color };
			rowMeta.set(series, state);
		}
		return state;
	}

	function createRow(entry) {
		const state = prepare(entry);
		const cells = createValueCells(keys);
		let header, label;
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
			cells.nodes,
		);
		const events = interactive ? createRowEvents(header, entry.series) : null;
		let className;

		return {
			node: row,
			update({series, index}) {
				const nextClass = LEGEND_SERIES + (series.class ? ' ' + series.class : '') + (series.show ? '' : ' ' + OFF) + (index > 0 && series == focused ? ' ' + FOCUS : '');
				if (nextClass !== className) {
					row.className = className = nextClass;
				}

				events?.update(index > 0);
				cells.update(values[index]);
			},
			destroy() {
				events?.destroy();
				// Keep the supplied label, not its discarded row and value cells.
				if (state.label instanceof HTMLElement && state.label.parentNode === label)
					label.removeChild(state.label);
			},
		};
	}

	return {
		node,
		body,
		createRow,
		setColumns,
		update(data, focusedSeries) {
			values = data;
			focused = focusedSeries;
			const className = LEGEND + ' ' + sideClass + (inline ? ' ' + LEGEND_INLINE + (legend.live || keys.length > 0 ? ' ' + LEGEND_LIVE : '') : '');
			if (className !== tableClass) {
				if (tableClass != null)
					node.classList.remove(...tableClass.split(' '));
				node.classList.add(...className.split(' '));
				tableClass = className;
			}
		},
		destroy() {
			if (leave)
				off(mouseleave, node, leave);
			leave = null;
		},
	};
}
