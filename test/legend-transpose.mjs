import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { plotCss } from '../scripts/test-css.mjs';
import '../scripts/instrument.mjs';
import { createLegend } from '../src/legend-dom.js';

const shape = table => [...table.querySelectorAll('tr')].map(row => [...row.children].map(cell => cell.textContent));

// Happy DOM checks the DOM and CSS configuration, not subgrid geometry or text wrapping.
describe('transposed legend renderer', () => {
	let fixtures, style;

	beforeEach(() => {
		fixtures = [];
		style = document.createElement('style');
		style.textContent = plotCss;
		document.head.appendChild(style);
	});

	afterEach(() => {
		for (const f of fixtures) {
			f.renderer.destroy();
			f.parent.remove();
		}
		style.remove();
	});

	function fixture() {
		const parent = document.body.appendChild(document.createElement('div'));
		const label = document.createElement('span');
		label.textContent = 'Alpha';
		const series = ['Time', label, 'Beta'].map((label, index) => ({label, show: true, width: 1, scale: index ? 'y' : 'x'}));
		const self = {series, scales: {x: {time: true}, y: {time: false}}};
		const events = [];
		let mounts = 0;
		const legend = {
			mode: 'table', transpose: true, live: true, order: [1, 2],
			markers: {show: true, width: () => 1, dash: () => 'solid', stroke: () => 'red', fill: () => 'pink'},
			mount() { mounts++; },
		};
		const renderer = createLegend(self, parent, {
			series, legend, columns: {Value: 0, Double: 0}, multi: true, mode: 1, cursorFocus: true,
			bind: Object.fromEntries(['click', 'mouseenter', 'mouseleave'].map(type => [type, (u, el, callback) => callback])),
			emit: (type, series) => events.push([type, series]),
		});
		const f = {
			parent, label, series, legend, events, renderer,
			data: [{}, {Value: 10, Double: 20}, {Value: 30, Double: 60}],
			render(focus = null) { renderer.render(f.data, focus); },
			get table() { return parent.firstChild; },
			get rows() { return [...f.table.querySelectorAll('tbody tr')]; },
			get mounts() { return mounts; },
		};
		fixtures.push(f);
		f.render();
		return f;
	}

	it('keeps one complete series row and configures nested subgrids without display: contents', () => {
		const f = fixture();
		const table = f.table;
		assert.deepEqual(shape(table), [['', 'Value', 'Double'], ['Alpha', '10', '20'], ['Beta', '30', '60']]);
		assert.equal(table.classList.contains('u-transpose'), true);
		assert.equal(table.style.gridTemplateRows, 'repeat(3, auto)');
		assert.equal(getComputedStyle(table).width, 'max-content');
		for (const element of [table, ...table.querySelectorAll('thead, tbody, tr')]) {
			const css = getComputedStyle(element);
			assert.equal(css.display, 'grid');
			assert.equal(css.gridAutoFlow, 'column');
			assert.equal(css.gridAutoColumns, 'max-content');
			if (element !== table) {
				assert.equal(css.gridTemplateRows, 'subgrid');
				assert.equal(css.gridRow, '1 / -1');
			}
		}
		assert.equal(table.querySelectorAll('.u-series').length, 2);
		for (const row of f.rows) {
			assert.equal(row.matches('tr.u-series'), true);
			assert.deepEqual([...row.children].map(cell => cell.tagName), ['TH', 'TD', 'TD']);
			assert.equal(row.querySelector('.u-series'), null);
			assert.equal(getComputedStyle(row.firstChild).textAlign, 'right');
			assert.equal(getComputedStyle(row.firstChild).cursor, 'pointer');
		}
		for (const cell of table.querySelectorAll('thead th')) {
			assert.equal(getComputedStyle(cell).textAlign, 'left');
			assert.notEqual(getComputedStyle(cell).cursor, 'pointer');
		}
		assert.equal(f.rows[0].querySelector('.u-label').firstChild, f.label);
	});

	it('does no DOM work for unchanged values and retains text nodes during value updates', () => {
		const f = fixture();
		const table = f.table;
		const nodes = [...table.querySelectorAll('*')];
		const cell = f.rows[0].querySelector('td');
		const text = cell.firstChild;
		const observer = new MutationObserver(() => {});
		observer.observe(table, {subtree: true, childList: true, attributes: true, characterData: true});
		try {
			f.render();
			assert.deepEqual(observer.takeRecords(), []);
			for (const value of [20, null, 0]) {
				f.data[1].Value = value;
				f.render();
				assert.equal(cell.textContent, value == null ? '' : String(value));
				assert.equal(cell.firstChild, text);
				assert.ok(observer.takeRecords().every(record => record.type == 'characterData'));
			}
			const current = [...table.querySelectorAll('*')];
			assert.equal(current.length, nodes.length);
			for (let i = 0; i < nodes.length; i++)
				assert.equal(current[i], nodes[i]);
			assert.equal(table.style.gridTemplateRows, 'repeat(3, auto)');
		}
		finally {
			observer.disconnect();
		}
	});

	it('keeps hidden, focused, and custom state on the series container and preserves header events', () => {
		const f = fixture();
		f.series[2].show = false;
		f.series[2].class = 'region';
		f.render(f.series[2]);
		const row = f.rows[1];
		assert.equal(row.className, 'u-series region u-off u-focus');
		assert.equal(row.querySelector('.u-series, .region, .u-off, .u-focus'), null);
		assert.notEqual(getComputedStyle(row).opacity, '0.3');
		for (const cell of row.children)
			assert.equal(getComputedStyle(cell).opacity, '0.3');
		row.firstChild.dispatchEvent(new MouseEvent('click'));
		row.firstChild.dispatchEvent(new MouseEvent('mouseenter'));
		f.table.dispatchEvent(new MouseEvent('mouseleave'));
		assert.deepEqual(f.events, [['click', f.series[2]], ['focus', f.series[2]], ['leave', null]]);
		f.series[2].show = true;
		f.render();
		assert.equal(row.className, 'u-series region');
	});

	it('updates tracks and time-header classes on schema changes without remounting the table', () => {
		const f = fixture();
		const table = f.table;
		const oldRows = f.rows;
		f.renderer.setColumns({A: 0, B: 0, C: 0, D: 0}, true);
		f.data = [{}, {A: 1, B: 2, C: 3, D: 4}, {A: 5, B: 6, C: 7, D: 8}];
		f.render();
		assert.equal(table.style.gridTemplateRows, 'repeat(5, auto)');
		assert.deepEqual(shape(table), [['', 'A', 'B', 'C', 'D'], ['Alpha', '1', '2', '3', '4'], ['Beta', '5', '6', '7', '8']]);
		assert.ok(oldRows.every(row => !row.isConnected));
		assert.equal(f.rows[0].querySelector('.u-label').firstChild, f.label);

		f.renderer.setColumns({_: 0}, false);
		f.data = [{_: 'timestamp'}, {_: 10}, {_: 30}];
		f.render();
		assert.equal(table.style.gridTemplateRows, 'repeat(3, auto)');
		assert.equal(table.classList.contains('u-time'), true);
		assert.deepEqual(shape(table), [['timestamp'], ['Alpha', '10'], ['Beta', '30']]);
		assert.equal(table.querySelector('thead th').colSpan, 2);

		f.renderer.setColumns({Sum: 0}, true);
		f.data = [{}, {Sum: 10}, {Sum: 30}];
		f.render();
		assert.equal(table.classList.contains('u-time'), false);
		assert.equal(table.style.gridTemplateRows, 'repeat(2, auto)');
		assert.deepEqual(shape(table), [['', 'Sum'], ['Alpha', '10'], ['Beta', '30']]);
		f.legend.order = [];
		f.render();
		assert.deepEqual(shape(table), [['', 'Sum']]);
		assert.equal(f.label.parentNode, null);
		f.legend.order = [1];
		f.render();
		assert.deepEqual(shape(table), [['', 'Sum'], ['Alpha', '10']]);
		assert.equal(f.table, table);
		assert.equal(f.mounts, 1);
		f.renderer.destroy();
		assert.equal(f.label.parentNode, null);
		assert.equal(f.parent.childNodes.length, 0);
	});
});
