import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import { createLegend } from '../src/legend-dom.js';
import { createLegendTemplate } from '../src/legend-dom-template.js';
import { createKeyedList } from '../src/keyed-list.js';

function assertNodes(actual, expected) {
	assert.equal(actual.length, expected.length);
	expected.forEach((node, i) => assert.equal(actual[i] === node, true, `node ${i} retains identity`));
}

const cells = row => [...row.querySelectorAll('td')].map(cell => cell.textContent);
const mouse = (target, type) => {
	const event = new MouseEvent(type, { bubbles: type == 'click' });
	target.dispatchEvent(event);
	return event;
};

// Exercise the adapter directly: no chart, scheduler, or canvas is needed.
describe('DOM legend prototype', () => {
	let fixtures;
	beforeEach(() => { fixtures = []; });
	afterEach(() => {
		for (const f of fixtures) {
			f.renderer.destroy();
			f.parent.remove();
		}
	});

	function fixture({ selectRows, multi = false, live = true, mode = 1, columns = { Value: null }, markersShow = true } = {}) {
		const parent = document.createElement('div');
		document.body.appendChild(parent);
		const labels = ['Time', 'Alpha', 'Beta', 'Gamma', 'Delta'];
		const reads = [];
		const series = labels.map((name, i) => ({
			name, show: true, width: 1,
			get label() { reads.push(name); return labels[i]; },
		}));
		const self = { series };
		const markers = [];
		const bindings = [];
		const events = [];
		const mounts = [];
		const legend = {
			live,
			markers: {
				show: markersShow,
				...Object.fromEntries(['width', 'dash', 'stroke', 'fill'].map(kind => [kind, (chart, index) => {
					assert.equal(chart, self);
					markers.push([kind, index]);
					return kind == 'width' ? index : kind == 'dash' ? 'solid' : ['black', 'red', 'green', 'blue', 'purple'][index];
				}])),
			},
			mount(chart, node) {
				assert.equal(chart, self);
				assert.equal(node.parentNode === parent, true);
				mounts.push(node);
			},
		};
		const opts = {
			series, legend, columns, multi, mode, focusAlpha: 0.25, cursorFocus: true,
			bind: Object.fromEntries(['click', 'mouseenter', 'mouseleave'].map(type => [type, (chart, target, handle, onlyTarget) => {
				assert.equal(chart, self);
				bindings.push({ type, target, onlyTarget });
				return handle;
			}])),
			emit(type, s, event) { events.push([type, s, series.indexOf(s), event]); },
		};
		const renderer = createLegend(self, parent, opts, selectRows);
		const rows = () => [...parent.querySelectorAll('tbody tr')];
		const data = () => series.map((s, index) => ({ Value: `${s.name}:${index}` }));
		const f = { parent, self, series, labels, reads, markers, bindings, events, mounts, legend, opts, renderer, rows, data };
		fixtures.push(f);
		return f;
	}

	function assertMarkers(f, indices) {
		assert.deepEqual(f.markers, indices.flatMap(index => ['width', 'dash', 'stroke', 'fill'].map(kind => [kind, index])));
	}

	it('sorts by current data without changing core order or using display indices for values, focus, bindings, or markers', () => {
		let current;
		const inputs = [];
		const f = fixture({ selectRows(entries, data) {
			assert.equal(data, current);
			inputs.push(entries.map(entry => entry.index));
			// Sorting this scratch array must not sort the core series array.
			return entries.sort((a, b) => data[b.index].rank - data[a.index].rank);
		} });
		const original = [...f.series];
		Object.freeze(f.series);
		current = f.data().map((value, i) => ({ ...value, rank: [0, 1, 3, 2, 4][i] }));
		f.renderer.render(current, f.series[2]);
		const order = [4, 2, 3, 1, 0];
		const roots = new Map(order.map((index, i) => [index, f.rows()[i]]));
		assert.deepEqual(f.rows().map(cells), order.map(index => [current[index].Value]));
		assert.deepEqual(f.reads, order.map(index => original[index].name));
		assertMarkers(f, order.filter(index => index > 0));
		for (const index of order) {
			const row = roots.get(index);
			assert.equal(row.style.opacity, index == 0 || index == 2 ? '' : '0.25');
			const header = row.firstChild;
			assert.deepEqual(f.bindings.filter(binding => binding.target === header).map(binding => [binding.type, binding.onlyTarget]),
				index == 0 ? [] : [['click', false], ['mouseenter', false]]);
			const click = mouse(header, 'click');
			const focus = mouse(header, 'mouseenter');
			if (index > 0) {
				assert.deepEqual(f.events.slice(-2), [['click', original[index], index, click], ['focus', original[index], index, focus]]);
				assert.equal(row.querySelector('.u-marker').style.borderWidth, `${index}px`);
			}
		}
		assert.equal(f.events.length, 8);
		current = current.map((value, i) => ({ Value: `next:${i}`, rank: i }));
		f.renderer.render(current, f.series[4]);
		assertNodes(f.rows(), [4, 3, 2, 1, 0].map(index => roots.get(index)));
		assert.deepEqual(f.rows().map(cells), [4, 3, 2, 1, 0].map(index => [`next:${index}`]));
		assert.deepEqual(f.rows().map(row => row.style.opacity), ['', '0.25', '0.25', '0.25', '']);
		assertNodes(f.series, original);
		assert.deepEqual(inputs, [[0, 1, 2, 3, 4], [0, 1, 2, 3, 4]]);
		assert.equal(f.bindings.length, 9);
		assert.equal(f.mounts.length, 1);
		assertMarkers(f, [4, 2, 3, 1]);
		assert.equal(f.reads.length, 5);
	});

	it('filters, pages, and windows entries before materializing metadata, caching metadata when rows return', () => {
		let minimum = 10, page = 1, start = 0, size = 2;
		const seen = new Map();
		let selected;
		const f = fixture({ selectRows(entries, data) {
			assert.deepEqual(entries.map(entry => entry.index), [0, 1, 2, 3, 4]);
			for (const entry of entries) {
				if (seen.has(entry.series))
					assert.equal(entry === seen.get(entry.series), true);
				seen.set(entry.series, entry);
			}
			const filtered = entries.filter(entry => entry.index > 0 && data[entry.index].Value >= minimum);
			selected = filtered.slice(page * 2, page * 2 + 2).slice(start, start + size);
			return selected;
		} });
		Object.freeze(f.series);
		const data = Object.freeze(f.series.map((_, i) => Object.freeze({ Value: i * 10 })));
		const render = indices => {
			f.renderer.render(data, f.series[2]);
			assert.deepEqual(selected.map(entry => entry.index), indices);
			assert.deepEqual(f.rows().map(cells), indices.map(index => [String(index * 10)]));
			assert.deepEqual(f.rows().map(row => row.style.opacity), indices.map(index => index == 2 ? '' : '0.25'));
			assert.deepEqual(f.series.map(s => s.name), ['Time', 'Alpha', 'Beta', 'Gamma', 'Delta']);
		};
		render([3, 4]);
		const original = f.rows();
		assert.deepEqual(f.reads, ['Gamma', 'Delta']);
		assertMarkers(f, [3, 4]);
		f.labels[3] = 'Replacement';
		f.legend.markers.fill = () => { assert.fail('cached rows must not refresh marker metadata'); };
		start = 1;
		render([4]);
		assertNodes(f.rows(), [original[1]]);
		assert.equal(original[0].parentNode, null);
		// Newly selected rows capture current callbacks; cached rows keep their first styles.
		f.legend.markers.fill = (chart, index) => {
			assert.equal(chart, f.self);
			f.markers.push(['fill', index]);
			return 'orange';
		};
		page = start = 0;
		size = 1;
		render([1]);
		minimum = 20;
		render([2]);
		minimum = 100;
		render([]);
		minimum = 10;
		page = 1;
		size = 2;
		render([3, 4]);
		assert.equal(f.rows()[0] === original[0], false);
		assert.equal(f.rows()[1] === original[1], false);
		assert.deepEqual(f.rows().map(row => row.querySelector('.u-label').textContent), ['Gamma', 'Delta']);
		assert.deepEqual(f.rows().map(row => row.querySelector('.u-marker').style.background), ['blue', 'purple']);
		assert.deepEqual(f.reads, ['Gamma', 'Delta', 'Alpha', 'Beta']);
		assertMarkers(f, [3, 4, 1, 2]);
		assert.equal(f.mounts.length, 1);
	});

	it('retains an HTMLElement label and its external state across window removal and readd, but replaces row bindings', () => {
		let visible = true;
		const f = fixture({ selectRows: entries => visible ? entries.filter(entry => entry.index == 2) : [] });
		const label = document.createElement('span');
		const input = document.createElement('input');
		const text = document.createElement('span');
		label.append(input, text);
		f.labels[2] = label;
		let clicks = 0;
		input.addEventListener('click', () => clicks++);
		f.renderer.render(f.data(), null);
		const oldRow = f.rows()[0];
		input.value = 'edited';
		input.setSelectionRange(1, 4);
		f.labels[2] = 'ignored replacement';
		visible = false;
		f.renderer.render(f.data(), null);
		assert.equal(label.isConnected, false);
		assert.equal(label.parentNode, null, 'cached label must not retain discarded row DOM');
		assert.equal(oldRow.querySelector('.u-label').childNodes.length, 0);
		assert.equal(oldRow.parentNode, null);
		mouse(oldRow.firstChild, 'click');
		mouse(oldRow.firstChild, 'mouseenter');
		assert.equal(f.events.length, 0);
		text.textContent = 'edited while absent';
		visible = true;
		f.series[2].show = false;
		f.series[2].class = 'changed';
		f.renderer.render(f.data(), f.series[1]);
		const row = f.rows()[0];
		assert.equal(row === oldRow, false);
		assert.equal(row.querySelector('.u-label').firstChild === label, true);
		assert.equal(label.firstChild === input, true);
		assert.equal(input.value, 'edited');
		assert.deepEqual([input.selectionStart, input.selectionEnd], [1, 4]);
		assert.equal(text.textContent, 'edited while absent');
		assert.equal(row.className, 'u-series changed u-off');
		assert.equal(row.style.opacity, '0.25');
		assert.deepEqual(cells(row), ['Beta:2']);
		const click = mouse(input, 'click');
		assert.equal(clicks, 1);
		assert.deepEqual(f.events, [['click', f.series[2], 2, click]]);
		assert.equal(f.bindings.length, 5);
		assert.deepEqual(f.reads, ['Beta']);
		assertMarkers(f, [2]);
	});

	it('refreshes a retained entry core index after core edits without refreshing its frozen metadata', () => {
		let entry;
		const f = fixture({ selectRows(entries) {
			const next = entries.find(candidate => candidate.series.name == 'Beta');
			if (entry && next)
				assert.equal(next === entry, true);
			entry = next ?? entry;
			return next ? [next] : [];
		} });
		const beta = f.series[2];
		f.renderer.render(f.data(), beta);
		const original = f.rows()[0];
		f.series.splice(1, 1);
		f.renderer.render(f.data(), beta);
		assert.equal(entry.index, 1);
		assertNodes(f.rows(), [original]);
		assert.deepEqual(cells(original), ['Beta:1']);
		assert.equal(original.style.opacity, '');
		const click = mouse(original.firstChild, 'click');
		assert.deepEqual(f.events, [['click', beta, 1, click]]);
		f.series.splice(1, 1);
		f.renderer.render(f.data(), null);
		assert.equal(f.rows().length, 0);
		f.series.push(beta);
		f.renderer.render(f.data(), f.series[1]);
		assert.equal(entry.index, 3);
		assert.equal(f.rows()[0] === original, false);
		assert.deepEqual(cells(f.rows()[0]), ['Beta:3']);
		assert.equal(f.rows()[0].style.opacity, '0.25');
		assert.equal(f.rows()[0].querySelector('.u-marker').style.borderWidth, '2px');
		assert.deepEqual(f.reads, ['Beta']);
		assertMarkers(f, [2]);
	});

	for (const config of [
		{ name: 'nonlive zero-column', live: false, columns: {}, expected: [4, 3, 2, 1], keys: [] },
		{ name: 'multi zero-column', multi: true, columns: {}, expected: [4, 3, 2, 1], keys: [] },
		{ name: 'multi inherited keys', multi: true, columns: Object.assign(Object.create({ Inherited: null }), { Own: null }), expected: [4, 3, 2, 1], keys: ['Own', 'Inherited'] },
		{ name: 'mode 2', mode: 2, columns: { Own: null }, expected: [4, 3, 2, 1], keys: ['Own'] },
		{ name: 'live zero-column', columns: {}, expected: [4, 3, 2, 1, 0], keys: [] },
	]) {
		it(`keeps ${config.name} structure in the template while the adapter selects eligible rows`, () => {
			const f = fixture({ ...config, selectRows(entries) {
				assert.deepEqual(entries.map(entry => entry.index), [...config.expected].reverse());
				return entries.reverse();
			} });
			const data = f.series.map((_, index) => Object.assign(Object.create({ Inherited: `inherited:${index}` }), { Own: `own:${index}` }));
			f.renderer.render(data, null);
			const table = f.parent.firstChild;
			assert.equal(table.className, config.multi ? 'u-legend' : `u-legend u-inline${config.live === false ? '' : ' u-live'}`);
			assert.equal(table.querySelectorAll('thead').length, config.multi ? 1 : 0);
			if (config.multi)
				assert.deepEqual([...table.querySelectorAll('thead th')].map(cell => cell.textContent), ['', ...config.keys]);
			assert.deepEqual(f.rows().map(cells), config.expected.map(index => config.keys.map(key => data[index][key])));
			assert.ok(f.rows().every(row => row.children.length == config.keys.length + 1));
			assertMarkers(f, [4, 3, 2, 1]);
		});
	}

	for (const show of [false, true]) {
		it(`snapshots marker show=${show} and enumerable columns before lazy template creation`, () => {
			let index = 2;
			const inherited = { Inherited: null };
			const columns = Object.assign(Object.create(inherited), { Own: null });
			const f = fixture({ multi: true, columns, markersShow: show, selectRows: entries => entries.filter(entry => entry.index == index) });
			assert.equal(f.parent.childNodes.length, 0);
			assert.deepEqual([f.reads.length, f.markers.length, f.bindings.length, f.mounts.length], [0, 0, 0, 0]);
			f.legend.markers.show = !show;
			delete columns.Own;
			delete inherited.Inherited;
			columns.Late = null;
			const data = f.series.map((_, i) => ({ Own: `own:${i}`, Inherited: `inherited:${i}`, Late: 'not a column' }));
			for (index of [2, 3, 2]) {
				f.renderer.render(data, null);
				assert.deepEqual([...f.parent.querySelectorAll('thead th')].map(cell => cell.textContent), ['', 'Own', 'Inherited']);
				assert.deepEqual(cells(f.rows()[0]), [`own:${index}`, `inherited:${index}`]);
				assert.equal(f.rows()[0].querySelectorAll('.u-marker').length, Number(show));
				if (!show)
					assert.equal(f.rows()[0].querySelector('.u-label').style.color, index == 2 ? 'green' : 'blue');
			}
			assert.deepEqual(f.reads, ['Beta', 'Gamma']);
			if (show)
				assertMarkers(f, [2, 3]);
			else
				assert.deepEqual(f.markers, [['stroke', 2], ['stroke', 3]]);
			assert.equal(f.mounts.length, 1);
		});
	}

	it('does no template work when destroyed before its first render', () => {
		const f = fixture({ selectRows() { assert.fail('selection after destroy'); } });
		f.renderer.destroy();
		f.renderer.render(f.data(), null);
		assert.equal(f.parent.childNodes.length, 0);
		assert.deepEqual([f.reads.length, f.markers.length, f.bindings.length, f.mounts.length], [0, 0, 0, 0]);
	});

	it('composes the template with the unchanged generic list using explicit keys and marker mode', () => {
		const f = fixture({ multi: true, columns: { Ignored: null }, markersShow: false });
		const template = createLegendTemplate(f.self, f.opts, ['Second', 'First'], true);
		const list = createKeyedList(template.body, entry => entry.series, template.createRow);
		try {
			const entries = [3, 1].map(index => ({ series: f.series[index], index }));
			for (const entry of entries)
				template.prepare(entry);
			template.update(f.series.map((_, i) => ({ First: `first:${i}`, Second: `second:${i}` })), f.series[1]);
			list.update(entries);
			const roots = [...template.body.children];
			const head = template.node.firstChild;
			assert.deepEqual([...head.querySelectorAll('th')].map(cell => cell.textContent), ['', 'Second', 'First']);
			assert.deepEqual(roots.map(cells), [['second:3', 'first:3'], ['second:1', 'first:1']]);
			assert.deepEqual(roots.map(row => row.style.opacity), ['0.25', '']);
			assert.ok(roots.every(row => row.querySelector('.u-marker') != null));
			list.update(entries.toReversed());
			assertNodes(template.body.children, roots.toReversed());
			assert.equal(template.node.firstChild === head, true);
			assertMarkers(f, [3, 1]);
			assert.deepEqual(f.reads, ['Gamma', 'Alpha']);
			assert.equal(f.mounts.length, 0);
			list.destroy();
			assert.equal(template.body.children.length, 0);
			assert.equal(template.node.firstChild === head, true);
		}
		finally {
			list.destroy();
			template.destroy();
		}
	});
});
