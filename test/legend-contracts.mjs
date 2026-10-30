import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';
import { createLegend } from '../src/legend-dom.js';

const data = [[0, 1, 2], [10, 20, 30], [40, 50, 60]];
const commit = () => Promise.resolve();

function mouse(type, target) {
	const event = new MouseEvent(type, { bubbles: type == 'click', cancelable: true, button: 0 });
	target.dispatchEvent(event);
	return event;
}

function assertNodes(actual, expected) {
	assert.equal(actual.length, expected.length);
	expected.forEach((node, i) => assert.equal(actual[i] === node, true, `node ${i} retains identity`));
}

function assertRowFocus(tr, focused) {
	assert.equal(tr.classList.contains('u-focus'), focused);
	assert.equal(tr.style.opacity, '');
}

function trackFrames() {
	const request = globalThis.requestAnimationFrame;
	const cancel = globalThis.cancelAnimationFrame;
	const queued = [];
	const canceled = [];
	const pending = new Map();
	globalThis.requestAnimationFrame = callback => {
		const id = request(time => {
			pending.delete(id);
			callback(time);
		});
		queued.push({ id, callback });
		pending.set(id, callback);
		return id;
	};
	globalThis.cancelAnimationFrame = id => {
		canceled.push(id);
		pending.delete(id);
		cancel(id);
	};
	return {
		queued, canceled, pending,
		restore() {
			for (const id of pending.keys())
				cancel(id);
			globalThis.requestAnimationFrame = request;
			globalThis.cancelAnimationFrame = cancel;
		},
	};
}

for (const table of [false, true]) {
	describe(`${table ? 'table' : 'inline'} legend contracts`, () => {
		let plots;
		let renderers;
		let bodyChildren;
		let scheduledFrames;

		beforeEach(() => {
			plots = [];
			renderers = [];
			bodyChildren = new Set(document.body.children);
			scheduledFrames = trackFrames();
		});

		afterEach(async () => {
			await Promise.resolve();
			for (const renderer of renderers)
				renderer.destroy();
			for (const u of plots)
				u.destroy();
			for (const child of [...document.body.children]) {
				if (!bodyChildren.has(child))
					child.remove();
			}
			scheduledFrames.restore();
			assert.equal(scheduledFrames.queued.length, 0, 'legend operations never request animation frames');
			assert.equal(scheduledFrames.canceled.length, 0, 'legend destruction has no animation frames to cancel');
		});

		async function plot({ label = 'Alpha', mount = () => {}, bind = {}, cursor = {}, hooks = {}, legend = {}, series = {}, scales = {}, mode = 1, focusAlpha = 0.25, cache } = {}) {
			const u = new uPlot({
				width: 600,
				height: 400,
				pxRatio: 1,
				mode,
				...(cache == null ? {} : { cache }),
				legend: { mount, ...legend },
				cursor: { focus: { prox: 1 }, bind, ...cursor },
				focus: { alpha: focusAlpha },
				series: [
					{ label: 'Time', value: (self, value) => value == null ? null : `x=${value}` },
					...[label, 'Beta'].map(label => ({
						label,
						stroke: 'red',
						points: { show: false },
						value: (self, value) => value == null ? null : `v=${value}`,
						...(table && {
							values(self, si, idx) {
								const value = self.data?.[si]?.[idx];
								return { Value: value == null ? '--' : `v=${value}`, Double: value == null ? '--' : `d=${2 * value}` };
							},
						}),
						...series,
					})),
				],
				scales: { x: { time: false }, ...scales },
				hooks,
			}, mode == 2 ? [null, [data[0], data[1]], [data[0], data[2]]] : data, (self, init) => {
				plots.push(self);
				self.ctx.measureText = text => ({ width: String(text).length * 8 });
				document.body.appendChild(self.root);
				init();
			});
			await Promise.resolve();
			return u;
		}

		function rendererFixture({ markers = {}, mount = () => {}, bind = {}, emit = () => {}, cursorFocus = true } = {}) {
			const parent = document.createElement('div');
			document.body.appendChild(parent);
			const series = ['Time', 'Alpha', 'Beta'].map(label => ({ label, show: true }));
			const work = { rows: 0, mounts: 0 };
			Object.defineProperty(series[1], 'class', { get() { work.rows++; return ''; } });
			const legend = {
				live: true,
				markers: { show: false, fill: () => null, ...markers },
				mount(self, element) {
					work.mounts++;
					assert.equal(element.querySelectorAll('tbody tr').length, series.length - (table ? 1 : 0));
					mount(self, element);
				},
			};
			const renderer = createLegend({ series }, parent, {
				series, mode: 1, multi: table, cursorFocus,
				columns: table ? { Value: null, Double: null } : { _: null },
				legend,
				bind: { ...Object.fromEntries(['click', 'mouseenter', 'mouseleave'].map(type => [type, (self, target, handle) => handle])), ...bind },
				emit,
			});
			renderers.push(renderer);
			const valuesAt = idx => data.map(column => table
				? { Value: `v=${column[idx]}`, Double: `d=${2 * column[idx]}` }
				: { _: `v=${column[idx]}` });
			return { renderer, parent, series, work, valuesAt, legend };
		}

		function row(u, si) {
			return u.root.querySelectorAll('tbody tr')[table ? si - 1 : si];
		}

		function values(u) {
			return u.legend.values.slice(1).map(v => v[table ? 'Value' : '_']);
		}

		function assertValues(tr, value) {
			assert.deepEqual([...tr.querySelectorAll('td')].map(cell => cell.textContent),
				table ? [`v=${value}`, `d=${2 * value}`] : [`v=${value}`]);
		}

		it('reconciles a stable series array between zero and multiple Y rows', () => {
			const { renderer, parent, series, valuesAt, work } = rendererFixture();
			const ys = series.splice(1);
			renderer.render(valuesAt(0), null);
			const tbody = parent.querySelector('tbody');
			const timeRow = tbody.firstElementChild;
			assert.equal(tbody.children.length, table ? 0 : 1);

			for (const idx of [1, 2]) {
				series.push(...ys);
				renderer.render(valuesAt(idx), series[2]);
				assert.deepEqual([...tbody.querySelectorAll('.u-label')].map(el => el.textContent),
					table ? ['Alpha', 'Beta'] : ['Time', 'Alpha', 'Beta']);
				assertValues(tbody.children[table ? 0 : 1], data[1][idx]);
				assertValues(tbody.children[table ? 1 : 2], data[2][idx]);
				series.splice(1);
				renderer.render(valuesAt(idx), null);
				assert.equal(tbody.children.length, table ? 0 : 1);
				assert.equal(tbody.firstElementChild === timeRow, true);
			}
			assert.equal(work.mounts, 1);
		});

		it('renders complete value, visibility, and focus state synchronously without scheduling frames', () => {
			const frames = trackFrames();
			try {
				const { renderer, parent, series, work, valuesAt } = rendererFixture();
				assert.deepEqual(work, { rows: 0, mounts: 0 });
				assert.equal(parent.querySelector('.u-legend') === null, true);
				series[1].show = false;
				renderer.render(valuesAt(2), series[2]);
				assert.deepEqual(work, { rows: 1, mounts: 1 });
				const rows = [...parent.querySelectorAll('tbody tr')];
				const alpha = rows[table ? 0 : 1];
				assertValues(alpha, 30);
				assertRowFocus(alpha, false);
				assertRowFocus(rows[table ? 1 : 2], true);
				assert.equal(alpha.classList.contains('u-off'), true);

				series[1].show = true;
				renderer.render(valuesAt(0), series[1]);
				assert.deepEqual(work, { rows: 2, mounts: 1 });
				assertValues(alpha, 10);
				assertRowFocus(alpha, true);
				assertRowFocus(rows[table ? 1 : 2], false);
				renderer.render(valuesAt(1), null);
				assert.deepEqual(work, { rows: 3, mounts: 1 });
				assertNodes([...parent.querySelectorAll('tbody tr')], rows);
				assertValues(alpha, 20);
				assertRowFocus(alpha, false);
				assertRowFocus(rows[table ? 1 : 2], false);
				assert.equal(alpha.classList.contains('u-off'), false);
				assert.equal(frames.queued.length, 0);
			}
			finally {
				frames.restore();
			}
		});

		it('renders the initial mount and each completed public setter without frames', async () => {
			const frames = trackFrames();
			const work = { rows: 0, mounts: 0 };
			try {
				const u = await plot({ scales: { y: { range: [0, 100] } }, mount: () => work.mounts++ });
				Object.defineProperty(u.series[1], 'class', { get() { work.rows++; return ''; } });
				assert.deepEqual(work, { rows: 0, mounts: 1 });
				assert.equal(frames.queued.length, 0);
				u.setLegend({ idx: 0 });
				assertValues(row(u, 1), 10);
				u.setSeries(1, { focus: true });
				assertRowFocus(row(u, 1), true);
				assertRowFocus(row(u, 2), false);
				u.setLegend({ idx: 1 });
				assertValues(row(u, 1), 20);
				u.setSeries(2, { focus: true });
				u.setSeries(1, { show: false });
				u.setLegend({ idx: 2 });
				assert.deepEqual(work, { rows: 6, mounts: 1 });
				await Promise.resolve();
				assert.deepEqual(work, { rows: 6, mounts: 1 });
				const rows = [...u.root.querySelectorAll('tbody tr')];
				const alpha = row(u, 1);
				assertValues(alpha, 30);
				assertRowFocus(alpha, false);
				assert.equal(alpha.classList.contains('u-off'), true);

				u.setSeries(1, { show: true });
				u.setLegend({ idx: 0 });
				u.setSeries(1, { focus: true });
				u.setLegend({ idx: 1 });
				u.setSeries(null, { focus: true });
				assert.deepEqual(work, { rows: 11, mounts: 1 });
				await Promise.resolve();
				assert.deepEqual(work, { rows: 11, mounts: 1 });
				assert.equal(frames.queued.length, 0);
				assert.equal(frames.pending.size, 0);
				assertNodes([...u.root.querySelectorAll('tbody tr')], rows);
				assertValues(alpha, 20);
				assertRowFocus(alpha, false);
				assert.equal(alpha.classList.contains('u-off'), false);
			}
			finally {
				frames.restore();
			}
		});

		for (const mounted of [false, true]) {
			it(`destroys ${mounted ? 'a mounted plot with a pending commit' : 'a plot before its first commit'} without legend frames`, async () => {
				const frames = trackFrames();
				const work = { rows: 0, mounts: 0 };
				try {
					const u = await plot({ mount: () => work.mounts++, hooks: {
						init: [self => {
							if (!mounted)
								self.destroy();
						}],
					} });
					if (mounted) {
						Object.defineProperty(u.series[1], 'class', { get() { work.rows++; return ''; } });
						u.setLegend({ idx: 1 });
						assertValues(row(u, 1), 20);
						u.setSize({ width: 620, height: 420 });
						u.destroy();
					}
					plots.splice(plots.indexOf(u), 1);
					await Promise.resolve();
					assert.equal(frames.queued.length, 0);
					assert.equal(frames.canceled.length, 0);
					assert.equal(frames.pending.size, 0);
					assert.deepEqual(work, { rows: mounted ? 1 : 0, mounts: mounted ? 1 : 0 });
					assert.equal(u.root.isConnected, false);
					assert.equal(u.root.querySelector('.u-legend') === null, true);
				}
				finally {
					frames.restore();
				}
			});

			it(`ignores render calls after destroying ${mounted ? 'a mounted' : 'an unmounted'} renderer`, () => {
				const { renderer, parent, series, work, valuesAt } = rendererFixture();
				if (mounted)
					renderer.render(valuesAt(0), null);
				renderer.destroy();
				renderer.render(valuesAt(1), series[2]);
				renderer.render(valuesAt(2), series[1]);
				assert.deepEqual(work, { rows: mounted ? 1 : 0, mounts: mounted ? 1 : 0 });
				assert.equal(parent.querySelector('.u-legend') === null, true);
			});
		}

		it('renders mount-callback setters synchronously and retains their followup chart commit', async () => {
			const frames = trackFrames();
			const work = { draws: 0, mounts: 0 };
			const order = [];
			try {
				const u = await plot({ mount(self, element) {
					work.mounts++;
					order.push('mount');
					assert.equal(self.status, 1);
					assert.equal(element.querySelectorAll('tbody tr').length, table ? 2 : 3);
					self.setLegend({ idx: 1 });
					assertValues(row(self, 1), 20);
					self.setSeries(2, { focus: true });
					assertRowFocus(row(self, 1), false);
					assertRowFocus(row(self, 2), true);
					self.setLegend({ idx: 2 });
					assertValues(row(self, 1), 30);
					self.setSize({ width: 620, height: 420 });
				}, hooks: {
					draw: [() => { work.draws++; order.push('draw'); }],
					ready: [self => {
						order.push('ready');
						assertValues(row(self, 1), 30);
					}],
				} });
				await Promise.resolve();
				assert.deepEqual(work, { draws: 2, mounts: 1 });
				assert.deepEqual(order, ['draw', 'mount', 'ready', 'draw']);
				assert.equal(u.width, 620);
				assert.equal(frames.queued.length, 0);
				assert.equal(frames.pending.size, 0);
			}
			finally {
				frames.restore();
			}
		});

		for (const cache of [undefined, { paths: false, data: false }]) {
			for (const mounted of [false, true]) {
				it(`completes commit-hook focus selection on ${mounted ? 'a mounted' : 'an initial'} plot with ${cache == null ? 'default' : 'disabled'} caches`, async () => {
					const lifecycle = [];
					const drawData = [];
					let changedFocus = false;
					let mounts = 0;
					let ready = 0;
					let legendElement;
					const assertSelection = self => {
						assert.deepEqual(self.legend.order, [2]);
						assert.deepEqual(self.series.slice(1).map(s => s._focus), [false, true]);
						assert.equal(self.root.querySelector('.u-legend'), legendElement);
						const rows = [...legendElement.querySelectorAll('tbody tr')];
						assert.deepEqual(rows.map(tr => tr.querySelector('.u-label').textContent), table ? ['Beta'] : ['Time', 'Beta']);
						const beta = rows.at(-1);
						assertRowFocus(beta, true);
						assert.equal(beta.classList.contains('u-off'), false);
						if (mounted)
							assertValues(beta, 51);
						else
							assert.deepEqual([...beta.querySelectorAll('td')].map(td => td.textContent), table ? ['--', '--'] : ['--']);
					};
					const changeFocus = self => {
						if (changedFocus)
							return;
						changedFocus = true;
						lifecycle.push('focus');
						assert.equal(drawData.length, 1, 'the hook runs after the initiating commit draws');
						self.setSeries(2, { focus: true });
						assert.deepEqual(self.legend.order, [1, 2], 'focus-dependent selection waits for the followup commit');
						assert.equal(mounts, mounted ? 1 : 0);
						assert.equal(ready, mounted ? 1 : 0);
						if (!mounted)
							assert.equal(self.root.querySelector('.u-legend'), null);
					};
					const u = await plot({
						cache,
						cursor: { focus: { prox: -1 } },
						legend: { filter: (self, si) => self.series[si]._focus !== false },
						mount(self, element) {
							mounts++;
							legendElement = element;
							lifecycle.push('mount');
							assert.equal(self.status, 1);
							assert.equal(ready, 0);
							if (!mounted)
								assertSelection(self);
						},
						hooks: {
							draw: [self => {
								lifecycle.push('draw');
								drawData.push(self.data.map(column => column.length));
							}],
							setLegend: mounted ? [] : [changeFocus],
							ready: [self => {
								ready++;
								lifecycle.push('ready');
								assert.equal(mounts, 1);
								if (!mounted)
									assertSelection(self);
							}],
						},
					});
					let beta;
					if (mounted) {
						assert.deepEqual(lifecycle, ['draw', 'mount', 'ready']);
						beta = row(u, 2);
						// Refill disposed data before positioning the cursor without a canvas commit.
						u.setData(data, false);
						u.setCursor({ left: u.valToPos(1, 'x'), top: 20 });
						drawData.length = 0;
						u.hooks.setLegend = [changeFocus];
						u.setData([data[0], [11, 21, 31], [41, 51, 61]]);
					}
					await commit();
					await commit();
					assert.equal(changedFocus, true);
					assertSelection(u);
					if (mounted)
						assert.equal(legendElement.querySelector('tbody').lastElementChild, beta);
					assert.deepEqual(drawData, [[3, 3, 3], [3, 3, 3]], 'both the initiating draw and followup draw retain data');
					assert.deepEqual(lifecycle, mounted
						? ['draw', 'mount', 'ready', 'draw', 'focus', 'draw']
						: ['draw', 'focus', 'draw', 'mount', 'ready']);
					assert.equal(mounts, 1);
					assert.equal(ready, 1);
					assert.deepEqual(u.data.map(column => column.length), cache == null ? [3, 3, 3] : [0, 0, 0]);
					await commit();
					assert.equal(drawData.length, 2, 'the followup settles without another draw');
					assert.equal(scheduledFrames.queued.length, 0);
					assert.equal(scheduledFrames.pending.size, 0);
				});
			}
		}

		it('cancels a pending chart commit when the plot is destroyed', async () => {
			const work = { draws: 0, legends: 0, mounts: 0 };
			const u = await plot({ mount: () => work.mounts++ });
			work.mounts = 0;
			u.hooks.draw = [() => work.draws++];
			u.hooks.setLegend = [() => work.legends++];
			u.setSize({ width: 620, height: 420 });
			u.setLegend({ idx: 1 });
			assert.equal(work.legends, 1);
			work.legends = 0;
			u.destroy();
			plots.splice(plots.indexOf(u), 1);
			await commit();
			assert.deepEqual(work, { draws: 0, legends: 0, mounts: 0 });
			assert.equal(u.root.isConnected, false);
			assert.equal(u.root.querySelector('.u-legend') === null, true);
		});

		it('reconciles complete value, visibility, and focus state without replacing keyed rows', async () => {
			const u = await plot();
			const legend = u.root.querySelector('.u-legend');
			const rows = [...legend.querySelectorAll('tbody tr')];
			const alpha = row(u, 1);
			const beta = row(u, 2);
			assert.ok(rows.every(tr => !tr.hasAttribute('style')), 'initial rows omit the style attribute');

			for (const idx of [0, 1, 2, null, 0]) {
				u.setLegend({ idx });
				await commit();
				assert.equal(u.root.querySelector('.u-legend') === legend, true);
				assertNodes([...legend.querySelectorAll('tbody tr')], rows);
				if (idx == null)
					assert.ok([...alpha.querySelectorAll('td')].every(cell => cell.textContent == '--'));
				else
					assertValues(alpha, data[1][idx]);
			}

			u.setSeries(1, { show: false });
			assert.equal(u.series[1].show, false);
			await commit();
			assert.equal(row(u, 1) === alpha, true);
			assert.equal(alpha.classList.contains('u-off'), true);
			u.setSeries(1, { show: true });
			mouse('mouseenter', alpha.firstChild);
			await commit();
			assert.equal(row(u, 2) === beta, true);
			assertRowFocus(alpha, true);
			assertRowFocus(beta, false);
			mouse('mouseleave', legend);
			await commit();
			rows.forEach(tr => assertRowFocus(tr, false));
		});

		it('skips reconciliation while streaming outside the cursor but still formats and notifies', async () => {
			const u = await plot();
			u.setCursor({ left: -10, top: -10 });
			await commit();
			let rowReads = 0;
			Object.defineProperty(u.series[1], 'class', { get() { rowReads++; return ''; } });
			const calls = [];
			const formatKey = table ? 'values' : 'value';
			const indices = table ? [1, 2] : [0, 1, 2];
			for (const si of indices) {
				const format = u.series[si][formatKey];
				u.series[si][formatKey] = (...args) => {
					calls.push([si, args[table ? 2 : 3]]);
					return format(...args);
				};
			}
			const snapshots = [];
			u.hooks.setLegend = [self => snapshots.push([self.legend.idx, self.legend.idxs.slice(), values(self)])];
			const frames = trackFrames();
			try {
				for (const shift of [1, 2, 3]) {
					calls.length = snapshots.length = 0;
					u.setData(data.map(column => column.map(value => value + shift)));
					await Promise.resolve();
					assert.ok(u.cursor.left < 0);
					assert.deepEqual(calls, indices.map(si => [si, null]));
					assert.deepEqual(snapshots, [[null, [null, null, null], ['--', '--']]]);
					assert.equal(frames.queued.length, 0);
					assert.equal(frames.pending.size, 0);
					assert.equal(rowReads, 0);
				}
			}
			finally {
				frames.restore();
			}
		});

		it('renders changing custom formatted data during the chart commit even when the cursor index is null', async () => {
			const latest = (self, si) => `latest=${self.data?.[si]?.at(-1) ?? '--'}`;
			const u = await plot({ series: table ? {
				values: (self, si) => ({ Value: latest(self, si), Double: '--' }),
			} : { value: (self, value, si) => latest(self, si) } });
			u.setCursor({ left: -10, top: -10 });
			await commit();
			let rowReads = 0;
			Object.defineProperty(u.series[1], 'class', { get() { rowReads++; return ''; } });
			const snapshots = [];
			u.hooks.setLegend = [self => snapshots.push([self.legend.idx, values(self)])];
			const frames = trackFrames();
			try {
				for (const shift of [1, 2]) {
					rowReads = 0;
					snapshots.length = 0;
					u.setData(data.map(column => column.map(value => value + shift)));
					await Promise.resolve();
					const expected = [`latest=${30 + shift}`, `latest=${60 + shift}`];
					assert.deepEqual(snapshots, [[null, expected]]);
					assert.equal(rowReads, 1);
					assert.equal(frames.queued.length, 0);
					assert.equal(frames.pending.size, 0);
					assert.deepEqual([1, 2].map(si => row(u, si).querySelector('td').textContent), expected);
				}
			}
			finally {
				frames.restore();
			}
		});

		it('publishes repeated formatted outputs without frames, ignoring fresh records and undisplayed properties', async () => {
			const u = await plot();
			u.setLegend({ idx: 0 });
			await commit();
			let rowReads = 0;
			Object.defineProperty(u.series[1], 'class', { get() { rowReads++; return ''; } });
			const indices = table ? [1, 2] : [0, 1, 2];
			const calls = [];
			const returned = [];
			let revision = 0;
			for (const si of indices) {
				const initial = { ...u.legend.values[si] };
				u.series[si][table ? 'values' : 'value'] = () => {
					calls.push(si);
					return returned[si] = table ? { ...initial, revision } : initial._;
				};
			}
			const snapshots = [];
			u.hooks.setLegend = [self => {
				for (const si of indices) {
					if (table)
						assert.equal(self.legend.values[si], returned[si], 'hooks see the latest returned record');
					else
						assert.equal(self.legend.values[si]._, returned[si]);
				}
				snapshots.push([self.legend.idx, self.legend.idxs.slice(), values(self)]);
			}];
			const frames = trackFrames();
			try {
				for (const idx of [1, 2, 2]) {
					revision++;
					calls.length = snapshots.length = 0;
					const previous = u.legend.values.slice();
					u.setLegend({ idx });
					assert.deepEqual(calls, indices);
					assert.deepEqual(snapshots, [[idx, [idx, idx, idx], ['v=10', 'v=40']]]);
					if (table) {
						for (const si of indices) {
							assert.notEqual(u.legend.values[si], previous[si]);
							assert.equal(u.legend.values[si].revision, revision);
						}
					}
					assert.equal(frames.queued.length, 0);
					assert.equal(frames.pending.size, 0);
					assert.equal(rowReads, 0);
					assertValues(row(u, 1), 10);
					assertValues(row(u, 2), 40);
				}
			}
			finally {
				frames.restore();
			}
		});

		it('detects later series and column changes in reused records after a prior render', async () => {
			const u = await plot();
			u.setLegend({ idx: 0 });
			await commit();
			const records = u.legend.values.map(record => record == null ? null : { ...record });
			const indices = table ? [1, 2] : [0, 1, 2];
			const calls = [];
			for (const si of indices) {
				u.series[si][table ? 'values' : 'value'] = () => {
					calls.push(si);
					return table ? records[si] : records[si]._;
				};
			}
			// Publish the retained records before mutating them after a completed render.
			u.setLegend({ idx: 0 });
			await commit();
			let rowReads = 0;
			Object.defineProperty(u.series[1], 'class', { get() { rowReads++; return ''; } });
			const frames = trackFrames();
			try {
				for (const [si, column] of [[2, table ? 'Double' : '_'], [1, table ? 'Value' : '_']]) {
					rowReads = 0;
					calls.length = 0;
					records[si][column] = 'changed';
					u.setLegend({ idx: 0 });
					assert.deepEqual(calls, indices, 'a changed value does not skip later formatters');
					assert.equal(u.legend.values[si][column], 'changed');
					if (table)
						assert.equal(u.legend.values[si], records[si]);
					assert.equal(rowReads, 1);
					assert.equal(frames.queued.length, 0);
					assert.equal(frames.pending.size, 0);
					for (const i of [1, 2])
						assert.deepEqual([...row(u, i).querySelectorAll('td')].map(cell => cell.textContent), Object.values(records[i]));
				}
			}
			finally {
				frames.restore();
			}
		});

		it('clears values synchronously once and treats normalized placeholders as unchanged', async () => {
			const u = await plot();
			u.setLegend({ idx: 2 });
			await commit();
			let empty = null;
			for (const s of u.series.slice(table ? 1 : 0))
				s[table ? 'values' : 'value'] = () => empty;
			let rowReads = 0;
			Object.defineProperty(u.series[1], 'class', { get() { rowReads++; return ''; } });
			const snapshots = [];
			u.hooks.setLegend = [self => snapshots.push([self.legend.idx, values(self)])];
			const frames = trackFrames();
			try {
				u.setLegend({ idx: null });
				assert.equal(rowReads, 1);
				for (const si of [1, 2])
					assert.ok([...row(u, si).querySelectorAll('td')].every(cell => cell.textContent == '--'));
				u.setLegend({ idx: null });
				assert.equal(frames.queued.length, 0);
				assert.equal(frames.pending.size, 0);
				assert.equal(frames.canceled.length, 0);
				assert.equal(rowReads, 1, 'an identical update does not reconcile again');
				assert.deepEqual(snapshots, Array.from({ length: 2 }, () => [null, ['--', '--']]));
				for (const si of [1, 2])
					assert.ok([...row(u, si).querySelectorAll('td')].every(cell => cell.textContent == '--'));

				rowReads = 0;
				for (empty of [undefined, table ? { Value: '--', Double: '--' } : '--', null]) {
					snapshots.length = 0;
					u.setLegend({ idx: null });
					assert.deepEqual(snapshots, [[null, ['--', '--']]]);
					assert.equal(frames.queued.length, 0);
					assert.equal(frames.pending.size, 0);
					assert.equal(rowReads, 0);
				}
			}
			finally {
				frames.restore();
			}
		});

		it('skips legend scheduling and reconciliation for unchanged focus', async () => {
			const u = await plot();
			let rowReads = 0;
			Object.defineProperty(u.series[1], 'class', { get() { rowReads++; return ''; } });
			const frames = trackFrames();
			try {
				for (const si of [1, 2, null]) {
					u.setSeries(si, { focus: true });
					assert.equal(rowReads, 1);
					await Promise.resolve();
					assert.equal(frames.queued.length, 0);
					assert.equal(frames.pending.size, 0);
					assert.equal(rowReads, 1);
					const requests = frames.queued.length;
					rowReads = 0;
					u.setSeries(si, { focus: true });
					await Promise.resolve();
					assert.equal(u.series[1]._focus, si == null ? null : si == 1);
					assert.equal(frames.queued.length, requests);
					assert.equal(frames.pending.size, 0);
					assert.equal(rowReads, 0);
				}
			}
			finally {
				frames.restore();
			}
		});

		it('reconciles focus classes synchronously without frames when alpha is one', async () => {
			const u = await plot({ focusAlpha: 1 });
			let rowReads = 0;
			Object.defineProperty(u.series[1], 'class', { get() { rowReads++; return ''; } });
			const frames = trackFrames();
			try {
				for (const si of [1, 2, null]) {
					rowReads = 0;
					u.setSeries(si, { focus: true });
					assert.equal(u.series[1]._focus, si == null ? null : si == 1);
					assert.equal(rowReads, 1);
					[1, 2].forEach(i => assertRowFocus(row(u, i), i == si));
					if (!table)
						assertRowFocus(row(u, 0), false);
					assert.deepEqual(u.series.slice(1).map(s => s.alpha), [1, 1]);
					await Promise.resolve();
					assert.equal(frames.queued.length, 0);
					assert.equal(frames.pending.size, 0);
					assert.equal(rowReads, 1);
					rowReads = 0;
					u.setSeries(si, { focus: true });
					assert.equal(rowReads, 0, 'unchanged focus does not reconcile');
				}
				u.setLegend({ idx: 1 });
				assert.equal(frames.queued.length, 0);
				assert.equal(frames.pending.size, 0);
				assert.equal(rowReads, 1, 'value updates still reconcile the legend synchronously');
				assertValues(row(u, 1), 20);
			}
			finally {
				frames.restore();
			}
		});

		it('renders cursor values and focus once synchronously before hooks', async () => {
			const u = await plot({ cursor: { points: { one: true } } });
			let rowReads = 0;
			let formats = 0;
			Object.defineProperty(u.series[1], 'class', { get() { rowReads++; return ''; } });
			const formatKey = table ? 'values' : 'value';
			for (const s of u.series.slice(table ? 1 : 0)) {
				const format = s[formatKey];
				s[formatKey] = (...args) => (formats++, format(...args));
			}
			const point = u.over.querySelector('.u-cursor-pt');
			assert.equal(u.over.querySelectorAll('.u-cursor-pt').length, 1);
			const snapshots = [];
			for (const name of ['setSeries', 'setLegend', 'setCursor']) {
				u.hooks[name] = [self => snapshots.push({
					name,
					idx: self.legend.idx,
					idxs: self.cursor.idxs.slice(),
					focus: self.series.slice(1).map(s => s._focus),
					alpha: self.series.slice(1).map(s => s.alpha),
					values: values(self),
					show: self.series.slice(1).map(s => s.show),
					rowReads, formats,
					text: [1, 2].map(i => row(self, i).querySelector('td').textContent),
					opacity: [1, 2].map(i => row(self, i).style.opacity),
					rowFocus: [1, 2].map(i => row(self, i).classList.contains('u-focus')),
				})];
			}

			// x index, focused series, renders, value refresh, expected notifications
			for (const [idx, si, renders, refresh, events] of [
				[0, 1, 1, true,  ['setLegend', 'setSeries', 'setCursor']],
				[1, 2, 1, true,  ['setLegend', 'setSeries', 'setCursor']],
				[1, 1, 1, false, ['setSeries', 'setCursor']],
				[2, 1, 1, true,  ['setLegend', 'setCursor']],
				[2, 1, 0, false, ['setCursor']],
				[null, null, 1, true, ['setLegend', 'setSeries', 'setCursor']],
				[null, null, 0, true, ['setLegend', 'setCursor']],
			]) {
				rowReads = formats = 0;
				snapshots.length = 0;
				const previousPoint = point.style.transform;
				u.setCursor(idx == null ? { left: -10, top: -10 } : {
					left: u.valToPos(data[0][idx], 'x'),
					top: u.valToPos(data[si][idx], 'y'),
				});
				const opacity = [1, 2].map(i => si == null || si == i ? 1 : 0.25);
				const text = [1, 2].map(i => idx == null ? '--' : `v=${data[i][idx]}`);
				assert.equal(rowReads, renders, 'one completed cursor update renders before returning');
				assert.equal(formats, refresh ? table ? 2 : 3 : 0);
				assert.equal(u.cursor.idx, idx);
				assert.deepEqual(snapshots.map(s => s.name).sort(), events.slice().sort());
				for (const { name, ...state } of snapshots) {
					assert.deepEqual(state, {
						idx, idxs: [idx, idx, idx],
						focus: [1, 2].map(i => si == null ? null : si == i),
						alpha: opacity, values: text, show: [true, true],
						rowReads: renders, formats,
						text, opacity: ['', ''], rowFocus: [1, 2].map(i => i == si),
					}, name);
				}
				const formatted = formats;
				await commit();
				if (!refresh && renders == 1)
					assert.notEqual(point.style.transform, previousPoint, 'Y-only focus moves the single point');
				assert.equal(rowReads, renders);
				assert.equal(formats, formatted, 'rendering does not format values again');
				assert.deepEqual([1, 2].map(i => row(u, i).querySelector('td').textContent), text);
				[1, 2].forEach(i => assertRowFocus(row(u, i), i == si));
			}
		});

		it('completes dynamic cursor selection before its single render and hooks', async () => {
			const u = await plot({ legend: {
				filter: (self, si) => self.series[si]._focus !== false,
			} });
			let rowReads = 0;
			for (const s of u.series.slice(1))
				Object.defineProperty(s, 'class', { get() { rowReads++; return ''; } });
			let hooks = 0;
			for (const name of ['setLegend', 'setSeries', 'setCursor']) {
				u.hooks[name] = [self => {
					hooks++;
					assert.equal(rowReads, 1, `${name} sees one completed render`);
					assert.deepEqual(self.legend.order, [2]);
					const rows = [...self.root.querySelectorAll('tbody tr')];
					assert.equal(rows.length, table ? 1 : 2);
					assert.equal(rows.at(-1).querySelector('.u-label').textContent, 'Beta');
					assertValues(rows.at(-1), 50);
					assertRowFocus(rows.at(-1), true);
				}];
			}
			u.setCursor({ left: u.valToPos(1, 'x'), top: u.valToPos(50, 'y') });
			assert.equal(hooks, 3);
			assert.equal(rowReads, 1);
			await commit();
			assert.equal(rowReads, 1);
		});

		it('updates cursor focus with nonlive and hidden legends', async () => {
			for (const legend of [{ live: false }, { show: false }]) {
				const u = await plot({ legend, cursor: { points: { one: true } } });
				let rowReads = 0;
				Object.defineProperty(u.series[1], 'class', { get() { rowReads++; return ''; } });
				const focused = [];
				u.hooks.setSeries = [(self, si) => focused.push(si)];
				for (const si of [1, 2, null]) {
					rowReads = 0;
					u.setCursor(si == null ? { left: -10, top: -10 } : {
						left: u.valToPos(1, 'x'), top: u.valToPos(data[si][1], 'y'),
					});
					assert.deepEqual(u.series.slice(1).map(s => s._focus), [1, 2].map(i => si == null ? null : si == i));
					const opacity = [1, 2].map(i => si == null || si == i ? 1 : 0.25);
					assert.deepEqual(u.series.slice(1).map(s => s.alpha), opacity);
					assert.equal(rowReads, legend.show === false ? 0 : 1);
					if (legend.show === false)
						assert.deepEqual(u.legend.values, [null, null, null]);
					await commit();
					assert.equal(rowReads, legend.show === false ? 0 : 1);
					if (legend.show === false)
						assert.equal(u.root.querySelector('.u-legend') === null, true);
					else {
						[...u.root.querySelectorAll('tbody tr')].forEach((tr, i) => assertRowFocus(tr, i + 1 == si));
						assert.deepEqual([...u.root.querySelectorAll('tbody tr')].map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent)),
							[1, 2].map(() => table ? ['--', '--'] : ['--']));
						assert.equal(u.legend.idx, null);
						assert.deepEqual(u.legend.idxs, [null, null, null]);
					}
				}
				u.setCursor({ left: -10, top: -10 });
				assert.deepEqual(focused, [1, 2, null], 'hidden cursor clears focus only once');
				const point = u.over.querySelector('.u-cursor-pt');
				const hiddenPoint = point.style.transform;
				u.setCursor({ left: u.valToPos(1, 'x'), top: u.valToPos(50, 'y') });
				await commit();
				assert.notEqual(point.style.transform, hiddenPoint, 'the shared point returns after a hidden cursor');
			}
		});

		it('renders separate public setters before their hooks without cross-call coalescing', async () => {
			const u = await plot({ scales: { y: { range: [0, 100] } } });
			let rowReads = 0;
			Object.defineProperty(u.series[1], 'class', { get() { rowReads++; return ''; } });
			const snapshots = [];
			u.hooks.setSeries = [self => {
				assertRowFocus(row(self, 1), false);
				assertRowFocus(row(self, 2), true);
				assert.equal(row(self, 2).classList.contains('u-off'), !self.series[2].show);
				snapshots.push([self.series[2]._focus, self.series[2].show, self.series[1].alpha]);
			}];
			u.hooks.setLegend = [self => {
				assertValues(row(self, 1), data[1][self.legend.idx]);
				assertValues(row(self, 2), data[2][self.legend.idx]);
				snapshots.push([self.legend.idx, ...values(self)]);
			}];
			u.setLegend({ idx: 0 });
			u.setSeries(2, { focus: true, show: false });
			u.setLegend({ idx: 2 });
			u.setSeries(2, { show: true });
			assert.deepEqual(snapshots, [
				[0, 'v=10', 'v=40'], [true, false, 0.25],
				[2, 'v=30', 'v=60'], [true, true, 0.25],
			]);
			assert.equal(rowReads, 4);
			await commit();
			assert.equal(rowReads, 4);
			assertValues(row(u, 1), 30);
			assertRowFocus(row(u, 1), false);
			assert.equal(row(u, 2).classList.contains('u-off'), false);
		});

		it('renders each reentrant setter before nested hooks observe its state', async () => {
			// Keep the scale fixed so visibility does not trigger a separate cursor recalculation.
			const u = await plot({ scales: { y: { range: [0, 100] } } });
			let rowReads = 0;
			Object.defineProperty(u.series[1], 'class', { get() { rowReads++; return ''; } });
			const events = [];
			let idx = 1;
			let focus = 1;
			let show = true;
			const assertState = self => {
				assert.equal(self.legend.idx, idx);
				assert.deepEqual(self.cursor.idxs, [idx, idx, idx]);
				assert.deepEqual(values(self), [`v=${data[1][idx]}`, `v=${data[2][idx]}`]);
				assert.deepEqual(self.series.slice(1).map(s => s._focus), [focus == 1, focus == 2]);
				assert.deepEqual(self.series.slice(1).map(s => s.alpha), focus == 1 ? [1, 0.25] : [0.25, 1]);
				assert.deepEqual(self.series.slice(1).map(s => s.show), [true, show]);
				assertValues(row(self, 1), data[1][idx]);
				assertValues(row(self, 2), data[2][idx]);
				assertRowFocus(row(self, 1), focus == 1);
				assertRowFocus(row(self, 2), focus == 2);
				assert.equal(row(self, 2).classList.contains('u-off'), !show);
			};
			for (const name of ['setLegend', 'setCursor']) {
				u.hooks[name] = [self => {
					events.push(name);
					assertState(self);
				}];
			}
			u.hooks.setSeries = [(self, si) => {
				events.push(`focus:${si}`);
				assertState(self);
				if (si != 1)
					return;
				idx = 2;
				self.setLegend({ idx });
				assertState(self);
				focus = 2;
				show = false;
				self.setSeries(2, { focus: true, show });
				assertState(self);
			}];
			u.setCursor({ left: u.valToPos(1, 'x'), top: u.valToPos(20, 'y') });
			u.hooks.setSeries = [];
			assert.equal(rowReads, 3);
			assert.deepEqual(events.slice().sort(), ['focus:1', 'focus:2', 'setCursor', 'setLegend', 'setLegend']);
			assertState(u);
			assert.equal(u.legend.idx, 2);
			await commit();
			assert.equal(rowReads, 3);
			assertValues(row(u, 1), 30);
			assertRowFocus(row(u, 1), false);
			assertRowFocus(row(u, 2), true);
			assert.equal(row(u, 2).classList.contains('u-off'), true);
		});

		it('publishes current data and DOM together and clears received hidden focus without echo', async () => {
			const publications = [];
			const events = [];
			const snapshots = [];
			let rowReads = 0;
			const snapshot = u => [
				rowReads, u.cursor.idxs.slice(), u.series[1]._focus, u.series[2]._focus,
				values(u), u.series.slice(1).map(s => s.show),
			];
			const source = await plot({ cursor: { sync: { setSeries: true, filters: {
				pub(type, u) {
					publications.push(type);
					events.push(`pub:${type}`);
					snapshots.push(snapshot(u));
					return false;
				},
			} } } });
			Object.defineProperty(source.series[1], 'class', { get() { rowReads++; return ''; } });
			source.setCursor({ left: source.valToPos(0, 'x'), top: source.valToPos(10, 'y') });
			source.setCursor({ left: -10, top: -10 });
			source.setCursor({ left: -10, top: -10 });
			assert.deepEqual(publications, [], 'programmatic focus and hidden clears do not publish');
			await commit();

			for (const name of ['setSeries', 'setLegend', 'setCursor']) {
				source.hooks[name] = [u => {
					events.push(name);
					snapshots.push(snapshot(u));
				}];
			}
			rowReads = 0;
			const left = source.valToPos(1, 'x');
			const top = source.valToPos(20, 'y');
			source.over.dispatchEvent(new MouseEvent('mousemove', {
				clientX: source.rect.left + left, clientY: source.rect.top + top,
			}));
			assert.equal(rowReads, 1);
			assert.deepEqual(publications.slice().sort(), ['mousemove', 'setSeries']);
			assert.deepEqual(events.slice().sort(), ['pub:mousemove', 'pub:setSeries', 'setCursor', 'setLegend', 'setSeries']);
			for (const state of snapshots)
				assert.deepEqual(state, [1, [1, 1, 1], true, false, ['v=20', 'v=50'], [true, true]]);
			await commit();
			assert.equal(rowReads, 1);
			assertValues(row(source, 1), 20);
			assertRowFocus(row(source, 1), true);
			assertRowFocus(row(source, 2), false);

			let receivedPublications = 0;
			const peer = await plot({ cursor: { sync: { setSeries: true, filters: {
				pub: () => (receivedPublications++, false),
			} } } });
			peer.setSeries(2, { focus: true });
			const focused = [];
			peer.hooks.setSeries = [(u, si) => focused.push(si)];
			// Direct delivery avoids shared sync keys; supply the values normally cached by publication.
			source.cursor.sync.values = [1, 20];
			peer.pub('mousemove', source, left, top, source.bbox.width, source.bbox.height, 1);
			assert.deepEqual(values(peer), ['v=20', 'v=50']);
			assert.deepEqual(peer.cursor.idxs, [1, 1, 1]);
			assert.deepEqual(peer.series.slice(1).map(s => s._focus), [false, true]);
			await commit();
			assertValues(row(peer, 1), 20);
			assertRowFocus(row(peer, 1), false);
			assertRowFocus(row(peer, 2), true);
			assert.deepEqual(focused, [], 'received visible moves do not select local focus');
			for (let i = 0; i < 2; i++)
				peer.pub('mousemove', source, -10, -10, source.bbox.width, source.bbox.height, null);
			assert.deepEqual(focused, [null]);
			assert.deepEqual(peer.series.slice(1).map(s => s._focus), [null, null]);
			assert.deepEqual(values(peer), ['--', '--']);
			await commit();
			assertRowFocus(row(peer, 1), false);
			assertRowFocus(row(peer, 2), false);
			assert.equal(row(peer, 1).querySelector('td').textContent, '--');
			assert.equal(receivedPublications, 0, 'received moves do not echo focus');
		});

		it('renders each two-chart sync message synchronously without cross-message coalescing', async () => {
			const publications = [];
			const key = `legend-contracts-${table}`;
			const source = await plot({ cursor: { sync: { key, setSeries: true, filters: {
				pub(type) { publications.push(type); return true; },
			} } } });
			const peer = await plot({ cursor: { sync: { key, setSeries: true } } });
			const reads = [0, 0];
			const snapshots = [];
			for (const [i, u] of [source, peer].entries()) {
				Object.defineProperty(u.series[1], 'class', { get() { reads[i]++; return ''; } });
				for (const name of ['setLegend', 'setSeries', 'setCursor']) {
					u.hooks[name] = [self => {
						assert.deepEqual([1, 2].map(si => row(self, si).querySelector('td').textContent), values(self));
						[1, 2].forEach(si => assertRowFocus(row(self, si), self.series[si]._focus === true));
						snapshots.push([i, name, self.cursor.idxs.slice(), values(self), self.series.slice(1).map(s => s._focus)]);
					}];
				}
			}
			let previousFocus = [null, null];
			for (const [idx, si] of [[1, 1], [2, 2]]) {
				publications.length = snapshots.length = 0;
				source.over.dispatchEvent(new MouseEvent('mousemove', {
					clientX: source.rect.left + source.valToPos(idx, 'x'),
					clientY: source.rect.top + source.valToPos(data[si][idx], 'y'),
				}));
				assert.deepEqual(publications.slice().sort(), ['mousemove', 'setSeries']);
				assert.deepEqual(snapshots.map(([i, name]) => `${i}:${name}`).sort(), [
					'0:setCursor', '0:setLegend', '0:setSeries', '1:setCursor', '1:setLegend', '1:setSeries',
				]);
				const focus = [si == 1, si == 2];
				const text = [`v=${data[1][idx]}`, `v=${data[2][idx]}`];
				for (const [i, name, idxs, vals, state] of snapshots) {
					assert.deepEqual(idxs, [idx, idx, idx], `${i}:${name} indices`);
					assert.deepEqual(vals, text, `${i}:${name} values`);
					if (i == 1 && name != 'setSeries') {
						assert.ok([previousFocus, focus].some(expected =>
							expected.length == state.length && expected.every((value, j) => value === state[j])),
							`${name} may precede or follow the peer focus message`);
					}
					else
						assert.deepEqual(state, focus, `${i}:${name} focus`);
				}
				for (const u of [source, peer]) {
					assert.deepEqual(u.cursor.idxs, [idx, idx, idx]);
					assert.deepEqual(values(u), text);
					assert.deepEqual(u.series.slice(1).map(s => s._focus), focus);
				}
				assert.deepEqual(reads, idx == 1 ? [1, 2] : [2, 4]);
				previousFocus = focus;
			}
			await commit();
			assert.deepEqual(reads, [2, 4]);
			for (const u of [source, peer]) {
				assertValues(row(u, 1), 30);
				assertValues(row(u, 2), 60);
				assertRowFocus(row(u, 1), false);
				assertRowFocus(row(u, 2), true);
			}
		});

		it('keeps live legend data synchronous with a hidden cursor and visible legend', async () => {
			const snapshots = [];
			const u = await plot({ cursor: { show: false }, legend: { show: true }, hooks: {
				setLegend: [self => snapshots.push([self.cursor.idxs.slice(), values(self)])],
			} });
			snapshots.length = 0;
			u.setLegend({ idx: 2 });
			assert.deepEqual(snapshots, [[[2, 2, 2], ['v=30', 'v=60']]]);
			await commit();
			assertValues(row(u, 1), 30);
		});

		for (const mode of [1, 2]) {
			for (const showCursor of [true, false]) {
				it(`never schedules a hidden legend in mode ${mode} with cursor.show=${showCursor}`, async () => {
					const frames = trackFrames();
					let mounts = 0;
					try {
						const u = await plot({
							mode,
							legend: { show: false },
							cursor: { show: showCursor },
							mount: () => mounts++,
						});
						const plotData = mode == 2 ? [null, [data[0], data[1]], [data[0], data[2]]] : data;
						const assertIdle = () => {
							assert.equal(frames.queued.length, 0);
							assert.equal(frames.pending.size, 0);
							assert.equal(mounts, 0);
							assert.equal(u.root.querySelector('.u-legend'), null);
						};
						assertIdle();
						for (const update of [
							() => u.setLegend({ idx: 1 }),
							() => u.setData(plotData),
							() => u.setCursor({ left: u.valToPos(1, 'x'), top: u.valToPos(20, 'y') }),
							() => u.setSeries(2, { focus: true }),
							() => u.setSeries(1, { show: false }),
							() => u.setSeries(1, { show: true }),
							() => u.setCursor({ left: -10, top: -10 }),
							() => u.setData(plotData),
							() => {
								u.addSeries({ label: 'Added', stroke: 'blue' });
								u.setData([...plotData, plotData[1]]);
							},
							() => {
								u.delSeries(3);
								u.setData(plotData);
							},
						]) {
							update();
							await Promise.resolve();
							assertIdle();
						}
					}
					finally {
						frames.restore();
					}
				});

				it(`skips hidden legend formatting after schema discovery in mode ${mode} with cursor.show=${showCursor}`, async () => {
					let formats = 0;
					let hooks = 0;
					const u = await plot({
						mode,
						legend: { show: false },
						cursor: { show: showCursor, focus: { prox: -1 } },
						series: table ? {
							values() { formats++; return { Value: '--', Double: '--' }; },
						} : {
							value() { formats++; return '--'; },
						},
						hooks: { setLegend: [() => hooks++] },
					});
					// Master still discovers multi-value columns before ordinary data setup.
					assert.equal(formats, table ? 1 : 0);
					if (!showCursor)
						assert.equal(hooks, 0, 'hidden legend commits do not add setLegend hooks');
					formats = hooks = 0;
					u.setLegend({ idx: 2 });
					assert.equal(hooks, 1, 'explicit setLegend still notifies');
					assert.equal(u.legend.idx, 2);
					assert.deepEqual(u.cursor.idxs, [2, 2, 2]);
					assert.deepEqual(u.legend.values, [null, null, null]);
					assert.equal(formats, 0);

					u.setCursor({ left: u.valToPos(1, 'x'), top: u.valToPos(20, 'y') });
					assert.equal(formats, 0, 'cursor updates do not format hidden values');
					hooks = 0;
					u.setData(mode == 2 ? [null, [data[0], data[1]], [data[0], data[2]]] : data);
					await commit();
					assert.equal(formats, 0, 'data commits do not format hidden values');
					if (!showCursor)
						assert.equal(hooks, 0, 'hidden legend commits do not add setLegend hooks');
					assert.deepEqual(u.legend.values, [null, null, null]);
					assert.equal(u.root.querySelector('.u-legend') === null, true);
				});
			}
		}

		it('renders mode 2 values and focus once synchronously with explicit per-series indices', async () => {
			const yValue = (self, si, idx) => idx == null ? null : self.data?.[si]?.[1]?.[idx];
			const u = await plot({
				mode: 2,
				cursor: { dataIdx: self => Math.round(self.posToVal(self.cursor.left, 'x')) },
				series: table ? {
					values(self, si, idx) {
						const value = yValue(self, si, idx);
						return { Value: value == null ? '--' : `v=${value}`, Double: value == null ? '--' : `d=${2 * value}` };
					},
				} : { value: (self, value, si, idx) => idx == null ? null : `v=${yValue(self, si, idx)}` },
			});
			let rowReads = 0;
			Object.defineProperty(u.series[1], 'class', { get() { rowReads++; return ''; } });
			const rows = [...u.root.querySelectorAll('tbody tr')];
			const snapshots = [];
			u.hooks.setSeries = [(self, si) => snapshots.push([
				si, rowReads, self.cursor.idxs.slice(1), values(self),
				self.series.slice(1).map(s => s.alpha),
			])];
			for (const [idx, si] of [[0, 1], [2, 2]]) {
				rowReads = 0;
				u.setCursor({ left: u.valToPos(idx, 'x'), top: u.valToPos(data[si][idx], 'y') });
				assert.equal(rowReads, 1);
				await commit();
				assert.equal(rowReads, 1);
				assertValues(rows[0], data[1][idx]);
				assertValues(rows[1], data[2][idx]);
				assert.deepEqual(u.cursor.idxs.slice(1), [idx, idx]);
				assert.deepEqual(u.series.slice(1).map(s => s._focus), [si == 1, si == 2]);
			}
			assert.deepEqual(snapshots, [
				[1, 1, [0, 0], ['v=10', 'v=40'], [1, 0.25]],
				[2, 1, [2, 2], ['v=30', 'v=60'], [0.25, 1]],
			]);
		});

		it('keeps focus attached to series identity during structural value updates', async () => {
			const u = await plot();
			const beta = u.series[2];
			const betaRow = row(u, 2);
			u.setSeries(2, { focus: true });
			u.addSeries({
				label: 'Inserted',
				stroke: 'blue',
				...(table && { values: () => ({ Value: '--', Double: '--' }) }),
			}, 1);
			u.setData([data[0], [70, 80, 90], data[1], data[2]], false);
			u.setLegend({ idx: 1 });
			assert.equal(u.series[3] === beta, true);
			await commit();
			assert.equal(row(u, 3) === betaRow, true);
			assertRowFocus(betaRow, true);
			assertRowFocus(row(u, 2), false);
			assertValues(betaRow, 50);
			u.setSeries(3, { focus: true });
			assert.equal(u.series[1]._focus, false);
			assert.equal(u.series[1].alpha, 0.25);
			assert.equal(u.over.querySelectorAll('.u-cursor-pt')[0].style.opacity, '0.25');

			u.delSeries(1);
			u.setData(data, false);
			u.setLegend({ idx: 2 });
			assert.equal(u.series[2] === beta, true);
			await commit();
			assert.equal(row(u, 2) === betaRow, true);
			assertRowFocus(betaRow, true);
			assertRowFocus(row(u, 1), false);
			assertValues(betaRow, 60);
		});

		it('updates the shared cursor point index without changing retained focus after insertion', async () => {
			const u = await plot({ cursor: { points: { one: true, size: (self, si) => 10 * si } } });
			const position = { left: u.valToPos(1, 'x'), top: u.valToPos(50, 'y') };
			u.setCursor(position);
			await commit();
			const point = u.over.querySelector('.u-cursor-pt');
			assert.equal(point.style.width, '20px');
			u.addSeries({
				label: 'Inserted',
				stroke: 'blue',
				...(table && { values: () => ({ Value: '--', Double: '--' }) }),
			}, 1);
			u.setData([data[0], [70, 80, 90], data[1], data[2]], false);
			u.setLegend({ idx: 1 });
			await commit();
			let focusEvents = 0;
			let rowReads = 0;
			u.hooks.setSeries = [() => focusEvents++];
			Object.defineProperty(u.series[1], 'class', { get() { rowReads++; return ''; } });
			u.setCursor(position);
			assert.equal(u.series[3]._focus, true);
			assert.equal(u.series[1]._focus, false);
			assert.equal(u.series[1].alpha, 0.25);
			assert.equal(focusEvents, 0);
			assert.equal(rowReads, 0);
			await commit();
			assert.equal(rowReads, 0);
			assert.equal(point.style.width, '30px');
		});

		it('renders empty-string transitions', async () => {
			const format = value => value == 20 ? '' : `formatted=${value}`;
			const u = await plot({ series: table ? {
				values: (self, si, idx) => ({ Value: format(self.data?.[si]?.[idx]), Double: format(self.data?.[si]?.[idx]) }),
			} : { value: (self, value) => format(value) } });
			u.setLegend({ idx: 0 });
			await commit();
			const cells = [...row(u, 1).querySelectorAll('td')];
			const textNodes = cells.map(cell => cell.firstChild);
			for (const idx of [1, 2, 0]) {
				u.setLegend({ idx });
				const expected = format(data[1][idx]);
				await commit();
				assert.deepEqual(cells.map(cell => cell.textContent), table ? [expected, expected] : [expected]);
				assert.ok(cells.every(cell => cell.childNodes.length == 1));
				assertNodes(cells.map(cell => cell.firstChild), textNodes);
			}
		});

		it('renders scalar values and holes while preserving value text nodes', () => {
			const { renderer, parent, series, valuesAt } = rendererFixture();
			renderer.render(valuesAt(0), null);
			const alpha = parent.querySelectorAll('tbody tr')[table ? 0 : 1];
			const cells = [...alpha.querySelectorAll('td')];

			for (const [value, expected] of [
				[0, '0'], [-2.5, '-2.5'], ['<b>&</b>', '<b>&</b>'],
				['', ''], [null, ''], [undefined, ''], [false, ''],
				[' ', ' '], [99, '99'], ['text', 'text'],
			]) {
				const previous = cells.map(cell => cell.firstChild);
				renderer.render(series.map(() => table ? { Value: value, Double: value } : { _: value }), null);
				assertNodes([...alpha.querySelectorAll('td')], cells);
				assert.equal(alpha.querySelector('.u-label').textContent, 'Alpha');
				cells.forEach((cell, i) => {
					assert.equal(cell.textContent, expected);
					assert.equal(cell.childNodes.length, 1);
					assert.equal(cell.children.length, 0, 'text is not parsed as HTML');
					assert.equal(cell.firstChild === previous[i], true, 'updates retain the text node, including empty values');
				});
			}
		});

		it('reads labels and evaluates marker callbacks only for new rows through insert, delete, reorder, and remount', () => {
			const calls = { label: [], width: [], dash: [], stroke: [], fill: [] };
			const colors = [null, 'red', 'green', 'blue'];
			const { renderer, parent, series, valuesAt } = rendererFixture({ markers: {
				show: true,
				...Object.fromEntries(['width', 'dash', 'stroke', 'fill'].map(key => [key, (self, i) => {
					calls[key].push(`${self.series[i].name}:${i}`);
					return key == 'width' ? i : key == 'dash' ? 'solid' : colors[i];
				}])),
			} });
			const trackLabel = s => Object.defineProperty(s, 'label', {
				get() {
					const text = `${s.name}:${series.indexOf(s)}`;
					calls.label.push(text);
					return text;
				},
			});
			for (const s of series.slice(1)) {
				s.name = s.label;
				trackLabel(s);
			}
			assert.ok(Object.values(calls).every(log => log.length == 0));
			renderer.render(valuesAt(0), null);
			series[1].show = false;
			renderer.render(valuesAt(1), series[2]);
			for (const log of Object.values(calls))
				assert.deepEqual(log, ['Alpha:1', 'Beta:2']);
			const retained = [...parent.querySelectorAll('tbody tr')].slice(-2);
			const firstIndex = new Map([[series[1], 1], [series[2], 2]]);
			const added = trackLabel({ name: 'Added', show: true });
			const transient = trackLabel({ name: 'Transient', show: true });
			for (const [change, expected] of [
				[() => { series.splice(1, 0, transient); series.splice(1, 1); }, []],
				[() => series.splice(2, 0, added), ['Added:2']],
				[() => series.splice(2, 1), []],
				[() => { [series[1], series[2]] = [series[2], series[1]]; }, []],
				[() => series.push(added), []],
			]) {
				for (const log of Object.values(calls))
					log.length = 0;
				change();
				renderer.render([], null);
				for (const log of Object.values(calls))
					assert.deepEqual(log, expected);
				if (expected.length)
					firstIndex.set(added, 2);
				const rows = [...parent.querySelectorAll('tbody tr')].slice(table ? 0 : 1);
				series.slice(1).forEach((s, offset) => {
					const tr = rows[offset];
					const i = firstIndex.get(s);
					assert.equal(tr.querySelector('.u-label').textContent, `${s.name}:${i}`);
					assert.equal(tr.querySelector('.u-marker').style.border, `${i}px solid ${colors[i]}`);
					assert.equal(tr.querySelector('.u-marker').style.background, colors[i]);
					if (s !== added)
						assert.equal(tr === retained[i - 1], true);
				});
			}
		});

		for (const show of [false, true]) {
			it(`captures markers.show=${show} at creation and caches styles for existing and new rows`, () => {
				let color = 'red';
				let width = 2;
				const calls = { width: 0, dash: 0, stroke: 0, fill: 0 };
				const { renderer, parent, series, legend } = rendererFixture({ markers: {
					show,
					width: () => (calls.width++, width),
					dash: () => (calls.dash++, 'solid'),
					stroke: () => (calls.stroke++, color),
					fill: () => (calls.fill++, color),
				} });
				series[1].width = series[2].width = 1;
				// Capture at createLegend, not at the first render or each new row.
				legend.markers.show = !show;
				renderer.render([], null);
				const rows = [...parent.querySelectorAll('tbody tr')].slice(-2);
				const headers = rows.map(tr => tr.firstChild);
				const presentation = tr => [
					tr.querySelector('.u-marker') !== null,
					tr.querySelector('.u-marker')?.style.border ?? '',
					tr.querySelector('.u-marker')?.style.background ?? '',
					tr.querySelector('.u-label').style.color,
				];
				const original = show ? [true, '2px solid red', 'red', ''] : [false, '', '', 'red'];
				for (const tr of rows)
					assert.deepEqual(presentation(tr), original);
				assert.deepEqual(calls, show
					? { width: 2, dash: 2, stroke: 2, fill: 2 }
					: { width: 0, dash: 0, stroke: 2, fill: 0 });
				color = 'blue';
				width = 3;
				series.push({ label: 'Added', show: true, width: 1 });
				renderer.render([], null);
				const added = [...parent.querySelectorAll('tbody tr')].at(-1);
				const fresh = show ? [true, '3px solid blue', 'blue', ''] : [false, '', '', 'blue'];
				assert.deepEqual(presentation(added), fresh);
				for (const mode of [show, !show]) {
					legend.markers.show = mode;
					color = 'green';
					width = 0;
					renderer.render([], null);
					assertNodes([...parent.querySelectorAll('tbody tr')].slice(table ? 0 : 1), [...rows, added]);
					assertNodes(rows.map(tr => tr.firstChild), headers);
					for (const tr of rows)
						assert.deepEqual(presentation(tr), original);
					assert.deepEqual(presentation(added), fresh);
					assert.deepEqual(calls, show
						? { width: 3, dash: 3, stroke: 3, fill: 3 }
						: { width: 0, dash: 0, stroke: 3, fill: 0 });
				}
			});
		}

		it('registers eligible headers and the table before events and before legend.mount', () => {
			const bindings = [];
			let mounted = false;
			const { renderer, parent, work } = rendererFixture({
				bind: Object.fromEntries(['click', 'mouseenter', 'mouseleave'].map(type => [type, (self, target, handle, onlyTarget) => {
					// Directives run during reconciliation; only mount guarantees a complete, attached table.
					assert.equal(mounted, false);
					assert.equal(target instanceof Element, true);
					assert.equal(typeof handle, 'function');
					bindings.push({ self, target, type, onlyTarget });
					return handle;
				}])),
				mount(self, element) {
					mounted = true;
					assert.equal(element.parentNode === parent, true);
					assert.equal(bindings.length, 5);
					assert.equal(bindings.every(b => b.self === self), true);
					for (const header of [...element.querySelectorAll('tbody th')].slice(-2)) {
						const records = bindings.filter(b => b.target === header);
						assert.deepEqual(records.map(b => b.type).sort(), ['click', 'mouseenter']);
						assert.deepEqual(records.map(b => b.onlyTarget), [false, false]);
					}
					const records = bindings.filter(b => b.target === element);
					assert.deepEqual(records.map(b => [b.type, b.onlyTarget]), [['mouseleave', true]]);
				},
			});
			assert.equal(bindings.length, 0);
			renderer.render([], null);
			assert.equal(mounted, true);
			assert.equal(work.mounts, 1);
			assert.equal(bindings.length, 5);
		});

		it('does not repeat binding factories for value, focus, show, class, or Y index updates', () => {
			const bindings = [];
			const { renderer, parent, series, valuesAt } = rendererFixture({
				bind: Object.fromEntries(['click', 'mouseenter', 'mouseleave'].map(type => [type, (self, target, handle) => {
					bindings.push(type);
					return handle;
				}])),
			});
			renderer.render(valuesAt(0), null);
			const rows = [...parent.querySelectorAll('tbody tr')].slice(-2);
			const beta = series[2];
			assert.equal(bindings.length, 5);
			for (const idx of [1, 2]) {
				beta.show = idx == 2;
				beta.class = `updated-${idx}`;
				[series[1], series[2]] = [series[2], series[1]];
				renderer.render(valuesAt(idx), idx == 1 ? beta : null);
				assertNodes([...parent.querySelectorAll('tbody tr')].slice(-2), idx == 1 ? [rows[1], rows[0]] : rows);
				assert.equal(rows[1].classList.contains(`updated-${idx}`), true);
				assert.equal(rows[1].classList.contains('u-off'), idx == 1);
				assert.equal(bindings.length, 5);
			}
		});

		it('eagerly registers new rows and re-registers the same series on a new element', () => {
			const bindings = [];
			const { renderer, parent, series, work } = rendererFixture({
				bind: Object.fromEntries(['click', 'mouseenter', 'mouseleave'].map(type => [type, (self, target, handle) => {
					bindings.push({ target, type });
					return handle;
				}])),
			});
			renderer.render([], null);
			const rows = [...parent.querySelectorAll('tbody tr')].slice(-2);
			assert.equal(bindings.length, 5);
			const added = { label: 'Added', show: true };
			series.splice(1, 0, added);
			assert.equal(bindings.length, 5);
			renderer.render([], null);
			const addedRow = parent.querySelectorAll('tbody tr')[table ? 0 : 1];
			assert.equal(bindings.length, 7);
			assertNodes(bindings.slice(5).map(b => b.target), [addedRow.firstChild, addedRow.firstChild]);
			assert.deepEqual(bindings.slice(5).map(b => b.type).sort(), ['click', 'mouseenter']);
			assertNodes([...parent.querySelectorAll('tbody tr')].slice(-2), rows);
			series.splice(1, 1);
			renderer.render([], null);
			assert.equal(addedRow.isConnected, false);
			assert.equal(bindings.length, 7);
			series.splice(1, 0, added);
			renderer.render([], null);
			const remounted = parent.querySelectorAll('tbody tr')[table ? 0 : 1];
			assert.equal(remounted === addedRow, false);
			assert.equal(bindings.length, 9);
			assertNodes(bindings.slice(7).map(b => b.target), [remounted.firstChild, remounted.firstChild]);
			assert.deepEqual(bindings.slice(7).map(b => b.type).sort(), ['click', 'mouseenter']);
			assertNodes([...parent.querySelectorAll('tbody tr')].slice(-2), rows);
			assert.equal(work.mounts, 1);
		});

		it('caches null factory results until the binding directive changes', () => {
			const bindings = { click: 0, mouseenter: 0, mouseleave: 0 };
			let events = 0;
			const { renderer, parent, series, valuesAt } = rendererFixture({
				bind: Object.fromEntries(Object.keys(bindings).map(type => [type, () => {
					bindings[type]++;
					return null;
				}])),
				emit: () => events++,
			});
			renderer.render(valuesAt(0), null);
			assert.deepEqual(bindings, { click: 2, mouseenter: 2, mouseleave: 1 });
			for (const idx of [1, 2]) {
				for (const header of [...parent.querySelectorAll('tbody th')].slice(-2)) {
					mouse('click', header);
					mouse('mouseenter', header);
				}
				mouse('mouseleave', parent.querySelector('.u-legend'));
				renderer.render(valuesAt(idx), series[idx]);
				assert.equal(events, 0);
				assert.deepEqual(bindings, { click: 2, mouseenter: 2, mouseleave: 1 });
			}
			[series[0], series[1]] = [series[1], series[0]];
			renderer.render([], null);
			assert.deepEqual(bindings, { click: 3, mouseenter: 3, mouseleave: 1 });
			[series[0], series[1]] = [series[1], series[0]];
			renderer.render([], null);
			assert.deepEqual(bindings, { click: 4, mouseenter: 4, mouseleave: 1 });
		});

		it('suppresses enter and leave factories when cursorFocus is disabled', () => {
			const bindings = [];
			const events = [];
			const { renderer, parent, work } = rendererFixture({
				cursorFocus: false,
				bind: Object.fromEntries(['click', 'mouseenter', 'mouseleave'].map(type => [type, (self, target, handle) => {
					bindings.push(type);
					return handle;
				}])),
				emit: (type, s) => events.push([type, s == null ? null : s.label]),
			});
			renderer.render([], null);
			assert.deepEqual(bindings, ['click', 'click']);
			assert.equal(work.mounts, 1);
			for (const header of [...parent.querySelectorAll('tbody th')].slice(-2)) {
				mouse('click', header);
				mouse('mouseenter', header);
			}
			mouse('mouseleave', parent.querySelector('.u-legend'));
			assert.deepEqual(events, [['click', 'Alpha'], ['click', 'Beta']]);
			renderer.render([], null);
			assert.deepEqual(bindings, ['click', 'click']);
			assert.equal(work.mounts, 1);
		});

		it('uses the current index to unbind and eagerly rebind eligible series headers', () => {
			const bindings = [];
			const calls = [];
			const events = [];
			const { renderer, parent, series } = rendererFixture({
				bind: Object.fromEntries(['click', 'mouseenter'].map(type => [type, (self, target, handle) => {
					bindings.push({ target, type });
					return event => {
						calls.push(type);
						handle(event);
					};
				}])),
				emit: (type, s) => events.push(`${type}:${s.label}`),
			});
			renderer.render([], null);
			const alpha = parent.querySelectorAll('tbody tr')[table ? 0 : 1];
			assert.equal(bindings.length, 4);
			assert.deepEqual(bindings.filter(b => b.target === alpha.firstChild).map(b => b.type).sort(), ['click', 'mouseenter']);
			mouse('click', alpha.firstChild);
			mouse('mouseenter', alpha.firstChild);
			assert.deepEqual(events, ['click:Alpha', 'focus:Alpha']);
			assert.equal(bindings.length, 4);
			events.length = calls.length = 0;
			[series[0], series[1]] = [series[1], series[0]];
			renderer.render([], null);
			const rows = [...parent.querySelectorAll('tbody tr')];
			const time = rows[table ? 0 : 1];
			assert.equal(bindings.length, 6);
			assertNodes(bindings.slice(4).map(b => b.target), [time.firstChild, time.firstChild]);
			if (table)
				assert.equal(alpha.isConnected, false);
			else {
				assert.equal(rows[0] === alpha, true);
				mouse('click', alpha.firstChild);
				mouse('mouseenter', alpha.firstChild);
				assert.equal(events.length, 0);
				assert.equal(calls.length, 0);
			}
			mouse('click', time.firstChild);
			mouse('mouseenter', time.firstChild);
			assert.deepEqual(events, ['click:Time', 'focus:Time']);
			assert.equal(bindings.length, 6);
			events.length = calls.length = 0;
			[series[0], series[1]] = [series[1], series[0]];
			renderer.render([], null);
			const current = parent.querySelectorAll('tbody tr')[table ? 0 : 1];
			assert.equal(current === alpha, !table);
			assert.equal(bindings.length, 8);
			assertNodes(bindings.slice(6).map(b => b.target), [current.firstChild, current.firstChild]);
			if (!table) {
				mouse('click', time.firstChild);
				mouse('mouseenter', time.firstChild);
				assert.equal(events.length, 0);
				assert.equal(calls.length, 0);
			}
			mouse('click', current.firstChild);
			mouse('mouseenter', current.firstChild);
			assert.deepEqual(events, ['click:Alpha', 'focus:Alpha']);
			assert.equal(bindings.length, 8);
		});

		if (table) {
			it('updates a single named value column through zero, empty string, and placeholders', async () => {
				const u = await plot({ series: {
					values: (self, si, idx) => idx == null ? null : { Reading: [0, '', 30][idx] },
				} });
				const legend = u.root.querySelector('.u-legend');
				assert.deepEqual([...legend.querySelectorAll('thead th')].map(cell => cell.textContent), ['', 'Reading']);
				const alpha = row(u, 1);
				const cell = alpha.querySelector('td');
				for (const [idx, expected] of [[0, '0'], [1, ''], [null, '--'], [2, '30']]) {
					u.setLegend({ idx });
					await commit();
					assert.equal(row(u, 1) === alpha, true);
					assert.equal(alpha.querySelectorAll('td').length, 1);
					assert.equal(alpha.querySelector('td') === cell, true);
					assert.equal(cell.textContent, expected);
				}
			});

			it('aligns headers and cells for own and inherited enumerable value keys', async () => {
				const u = await plot({ series: {
					values(self, si, idx) {
						const value = self.data?.[si]?.[idx];
						if (idx == 2)
							return { Double: `d=${2 * value}`, Value: `v=${value}` };
						return Object.assign(Object.create({ Double: value == null ? '--' : `d=${2 * value}` }), {
							Value: value == null ? '--' : `v=${value}`,
						});
					},
				} });
				const legend = u.root.querySelector('.u-legend');
				assert.deepEqual([...legend.querySelectorAll('thead th')].map(cell => cell.textContent), ['', 'Value', 'Double']);
				u.setLegend({ idx: 2 });
				await commit();
				assertValues(row(u, 1), 30);
				assertValues(row(u, 2), 60);
			});
		}

		for (const mode of [1, 2]) {
			it(`refreshes nonlive stats on data, series, scale, and structural changes but not cursor moves in mode ${mode}`, async () => {
				const calls = [];
				const stats = (self, si, idx) => {
					calls.push([si, idx]);
					assert.equal(idx, null);
					const values = mode == 1 ? self.data[si] : self.data[si]?.[1];
					const sum = (values ?? []).reduce((sum, value) => sum + value, 0);
					return `${sum}/${self.series[si].show}/${self.scales.y.max}`;
				};
				const format = table ? {
					values: (self, si, idx) => ({ Value: stats(self, si, idx), Double: 'stats' }),
				} : {
					value(self, value, si, idx) {
						assert.equal(value, null);
						return stats(self, si, idx);
					},
				};
				const u = await plot({ mode, legend: { live: false }, series: format, scales: { y: { range: [0, 100] } } });
				const assertStats = () => {
					assert.equal(u.legend.idx, null);
					assert.deepEqual(u.legend.idxs, u.series.map(() => null));
					const rows = [...u.root.querySelectorAll('tbody tr')];
					assert.equal(rows.length, u.series.length - 1);
					for (let si = 1; si < u.series.length; si++) {
						const values = mode == 1 ? u.data[si] : u.data[si]?.[1];
						const text = `${(values ?? []).reduce((sum, value) => sum + value, 0)}/${u.series[si].show}/${u.scales.y.max}`;
						assert.deepEqual([...rows[si - 1].querySelectorAll('td')].map(td => td.textContent), table ? [text, 'stats'] : [text]);
						assert.equal(u.legend.values[si][table ? 'Value' : '_'], text);
					}
				};
				assert.ok(calls.length >= 2, 'initial commit formats stats');
				assertStats();
				const originalRows = [...u.root.querySelectorAll('tbody tr')];
				for (const update of [
					() => u.setData(mode == 1 ? [data[0], [1, 2, 3], data[2], [7, 8, 9]] :
						[null, [data[0], [1, 2, 3]], [data[0], data[2]], [data[0], [7, 8, 9]]]),
					() => u.setSeries(1, { show: false }),
					() => u.setSeries(2, { focus: true }),
					() => u.setScale('y', { min: 0, max: 200 }),
					() => u.addSeries({ label: 'Added', stroke: 'blue', ...format }),
					() => u.delSeries(3),
				]) {
					calls.length = 0;
					update();
					await commit();
					assert.deepEqual(calls, u.series.slice(1).map((_, i) => [i + 1, null]));
					assertStats();
					assertNodes([...u.root.querySelectorAll('tbody tr')].slice(0, 2), originalRows);
				}
				calls.length = 0;
				for (const position of [
					{ left: u.valToPos(1, 'x'), top: u.valToPos(50, 'y') },
					{ left: u.valToPos(2, 'x'), top: u.valToPos(60, 'y') },
					{ left: -10, top: -10 },
				]) {
					u.setCursor(position);
					await commit();
					assert.deepEqual(calls, [], 'cursor movement does not refresh stats');
					assertStats();
				}
			});
		}

		it('preserves hidden, nonlive, and mode 2 legend structure', async () => {
			let mounts = 0;
			const hidden = await plot({ legend: { show: false }, mount: () => mounts++ });
			assert.equal(mounts, 0);
			assert.equal(hidden.root.querySelector('.u-legend') === null, true);

			const nonlive = await plot({ legend: { live: false } });
			const nonliveLegend = nonlive.root.querySelector('.u-legend');
			assert.deepEqual([...nonliveLegend.classList].sort(), table ? ['u-btm', 'u-legend'] : ['u-btm', 'u-inline', 'u-legend', 'u-live']);
			assert.deepEqual([...nonliveLegend.querySelectorAll('tbody tr')].map(tr => tr.querySelector('.u-label').textContent), ['Alpha', 'Beta']);
			assert.equal(nonliveLegend.querySelectorAll('.u-value').length, table ? 4 : 2);
			assert.deepEqual([...nonliveLegend.querySelectorAll('thead th')].map(th => th.textContent), table ? ['', 'Value', 'Double'] : []);
			const nonliveRows = [...nonliveLegend.querySelectorAll('tbody tr')];
			nonlive.setSeries(1, { show: false });
			nonlive.setSeries(2, { focus: true });
			await commit();
			assertNodes([...nonliveLegend.querySelectorAll('tbody tr')], nonliveRows);
			assert.deepEqual(nonliveRows.map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent)),
				[1, 2].map(() => table ? ['--', '--'] : ['--']));
			assert.equal(nonliveRows[0].classList.contains('u-off'), true);
			assertRowFocus(nonliveRows[0], false);
			assertRowFocus(nonliveRows[1], true);

			const mode2 = await plot({ mode: 2 });
			const mode2Legend = mode2.root.querySelector('.u-legend');
			assert.deepEqual([...mode2Legend.querySelectorAll('tbody .u-label')].map(el => el.textContent), ['Alpha', 'Beta']);
			assert.equal(mode2Legend.querySelectorAll('thead th').length, table ? 3 : 0);
		});

		it('freezes string labels at first render and ignores replacement labels', () => {
			const { renderer, parent, series } = rendererFixture();
			series.splice(1, 2, ...['0', '<b>&</b>', ''].map(label => ({ label, show: true })));
			renderer.render([], null);
			const labels = [...parent.querySelectorAll('tbody .u-label')].slice(table ? 0 : 1);
			const text = labels.map(label => label.firstChild);
			assert.deepEqual(labels.map(label => label.textContent), ['0', '<b>&</b>', '']);
			assert.ok(labels.every(label => label.children.length == 0));
			for (const replacement of ['Replacement', '']) {
				for (const s of series.slice(1))
					s.label = replacement;
				renderer.render([], null);
				assertNodes([...parent.querySelectorAll('tbody .u-label')].slice(table ? 0 : 1), labels);
				assertNodes(labels.map(label => label.firstChild), text);
				assert.deepEqual(labels.map(label => label.textContent), ['0', '<b>&</b>', '']);
			}
		});

		it('preserves external changes to the original element label while values, focus, visibility, and class stay dynamic', () => {
			const { renderer, parent, series, valuesAt } = rendererFixture();
			const beta = series[2];
			const element = document.createElement('span');
			const input = document.createElement('input');
			const content = document.createElement('span');
			input.value = 'initial';
			content.textContent = 'Initial';
			element.append(input, content);
			beta.label = element;
			beta.class = 'before';
			renderer.render(valuesAt(0), null);
			const tr = [...parent.querySelectorAll('tbody tr')].at(-1);
			const container = tr.querySelector('.u-label');
			assert.equal(container.firstChild === element, true);
			assert.equal(tr.classList.contains('before'), true);
			let clicks = 0;
			input.addEventListener('click', () => clicks++);
			const replacement = document.createElement('span');
			replacement.textContent = 'Replacement';
			for (const [idx, label] of [[1, replacement], [2, 'Replacement']]) {
				beta.label = label;
				beta.class = `after-${idx}`;
				beta.show = idx == 2;
				content.textContent = `External ${idx}`;
				input.value = `edited-${idx}`;
				input.focus();
				input.setSelectionRange(1, 3);
				renderer.render(valuesAt(idx), series[idx == 1 ? 1 : 2]);
				assert.equal([...parent.querySelectorAll('tbody tr')].at(-1) === tr, true);
				assert.equal(tr.querySelector('.u-label') === container, true);
				assert.equal(container.firstChild === element, true);
				assert.equal(element.firstChild === input, true);
				assert.equal(content.textContent, `External ${idx}`);
				assert.equal(input.value, `edited-${idx}`);
				assert.equal(document.activeElement === input, true);
				assert.deepEqual([input.selectionStart, input.selectionEnd], [1, 3]);
				assert.equal(tr.classList.contains('before'), false);
				assert.equal(tr.classList.contains(`after-${idx}`), true);
				assert.equal(tr.classList.contains('u-off'), idx == 1);
				assertRowFocus(tr, idx == 2);
				assertValues(tr, data[2][idx]);
				mouse('click', input);
				assert.equal(clicks, idx);
				assert.equal(replacement.isConnected, false);
			}
			series.pop();
			renderer.render(valuesAt(0), null);
			assert.equal(element.isConnected, false);
			content.textContent = 'Edited while unmounted';
			series.push(beta);
			renderer.render(valuesAt(0), null);
			const remounted = [...parent.querySelectorAll('tbody tr')].at(-1);
			assert.equal(remounted.querySelector('.u-label').firstChild === element, true);
			assert.equal(content.textContent, 'Edited while unmounted');
			assert.equal(input.value, 'edited-2');
			mouse('click', input);
			assert.equal(clicks, 3);
			assertValues(remounted, 40);
		});

		it('exposes initial series data in lifecycle hooks without requiring legend DOM', async () => {
			const added = [];
			const lifecycle = [];
			const u = await plot({ hooks: {
				addSeries: [(u, si) => added.push([si, u.series[si].label, u.series[si].show])],
				init: [u => {
					assert.equal(u.root.querySelector('.u-legend'), null);
					lifecycle.push(['init', u.series.map(s => s.label)]);
				}],
				draw: [u => {
					assert.equal(u.root.querySelector('.u-legend'), null, 'the first draw precedes legend creation');
				}],
				ready: [u => {
					assert.equal(u.status, 1);
					assert.equal(u.root.querySelectorAll('tbody tr').length, table ? 2 : 3);
					lifecycle.push(['ready', u.series.map(s => s.label)]);
				}],
			} });
			assert.deepEqual(added, [[0, 'Time', true], [1, 'Alpha', true], [2, 'Beta', true]]);
			assert.deepEqual(lifecycle, [
				['init', ['Time', 'Alpha', 'Beta']], ['ready', ['Time', 'Alpha', 'Beta']],
			]);
			assert.equal(u.root.querySelectorAll('tbody tr').length, table ? 2 : 3);
		});

		it('mounts one complete table and keeps the relocated root updateable', async () => {
			const host = document.createElement('div');
			document.body.appendChild(host);
			const order = [];
			let legend;
			let body;
			const u = await plot({
				mount(self, element) {
					order.push('mount');
					legend = element;
					body = element.firstElementChild;
					assert.equal(element.parentNode === self.root, true);
					assert.deepEqual([...element.classList].sort(),
						table ? ['u-btm', 'u-legend'] : ['u-btm', 'u-inline', 'u-legend', 'u-live']);
					assert.equal(body.tagName, table ? 'THEAD' : 'TBODY');
					assert.equal(element.querySelector('tbody').children.length, table ? 2 : 3);
					element.classList.add('mounted');
					host.appendChild(element);
				},
				hooks: { init: [() => order.push('init')], ready: [() => order.push('ready')] },
			});
			assert.deepEqual(order, ['init', 'mount', 'ready']);
			assert.equal(host.firstChild === legend, true);
			assert.equal(legend.classList.contains('mounted'), true);
			const legendBody = legend.querySelector('tbody');
			assert.equal(legendBody.children.length, table ? 2 : 3);
			u.setLegend({ idx: 1 });
			assert.deepEqual(values(u), ['v=20', 'v=50']);
			await commit();
			assert.equal(host.firstChild === legend, true);
			assert.equal(legend.firstElementChild === body, true);
			assert.equal(legend.classList.contains('mounted'), true);
			assertValues(legendBody.children[table ? 0 : 1], 20);
			assert.equal(order.filter(name => name == 'mount').length, 1);
		});

		it('keeps complete legends in one shared host bound to their original charts', async () => {
			const host = document.createElement('div');
			const legends = [];
			const key = `legend-shared-host-${table}`;
			const makePlot = label => plot({
				label,
				cursor: { focus: { prox: -1 }, sync: { key } },
				mount(self, element) {
					legends.push(element);
					host.appendChild(element);
				},
			});
			const top = await makePlot('In');
			const bottom = await makePlot('Out');
			bottom.root.appendChild(host);
			await commit();
			assert.equal(top.root.querySelector('.u-legend') === null, true);
			assert.equal(host.querySelectorAll('.u-legend').length, 2);
			const rows = legends.map(el => el.querySelectorAll('tbody tr')[table ? 0 : 1]);
			assert.deepEqual(rows.map(el => el.querySelector('.u-label').textContent), ['In', 'Out']);

			top.setCursor({ left: top.valToPos(1, 'x'), top: 20 }, true, true);
			assert.deepEqual([top.cursor.idx, bottom.cursor.idx], [1, 1]);
			await commit();
			rows.forEach(el => assertValues(el, 20));
			for (const [i, u] of [top, bottom].entries()) {
				const other = i == 0 ? bottom : top;
				const label = rows[i].querySelector('.u-label');
				mouse('click', label);
				assert.equal(u.series[1].show, false);
				assert.equal(other.series[1].show, true);
				await commit();
				assert.equal(rows[i].classList.contains('u-off'), true);
				mouse('click', label);
				await commit();
				assert.equal(u.series[1].show, true);
				assert.equal(rows[i].classList.contains('u-off'), false);
			}
			assertNodes([...host.querySelectorAll('.u-legend')], legends);
			top.destroy();
			plots.splice(plots.indexOf(top), 1);
			assert.equal(host.querySelectorAll('.u-legend').length, 1);
			assert.equal(host.firstChild === legends[1], true);
			bottom.setLegend({ idx: 2 });
			await commit();
			assertValues(rows[1], 30);
		});

		for (const change of ['visibility', 'focus']) {
			it(`defers dynamic ${change} selection to the normal chart commit without rendering pending selection`, async () => {
				let selections = 0;
				const u = await plot({ legend: {
					filter(self, si) {
						selections++;
						return change == 'visibility' ? self.series[si].show : self.series[si]._focus !== false;
					},
				} });
				const rows = [...u.root.querySelectorAll('tbody tr')];
				let rowReads = 0;
				Object.defineProperty(u.series[1], 'class', { get() { rowReads++; return ''; } });
				selections = 0;
				let hooks = 0;
				u.hooks.setSeries = [self => {
					hooks++;
					assert.equal(selections, 0);
					assert.equal(rowReads, 0);
					assert.deepEqual(self.legend.order, [1, 2]);
					assertNodes([...self.root.querySelectorAll('tbody tr')], rows);
				}];
				u.setSeries(1, change == 'visibility' ? { show: false } : { focus: true });
				assert.equal(hooks, 1);
				assert.equal(rowReads, 0);
				assert.ok(rows.every(tr => !tr.classList.contains('u-off') && tr.style.opacity == ''));
				await commit();
				assert.ok(selections > 0);
				assert.deepEqual(u.legend.order, change == 'visibility' ? [2] : [1]);
				const labels = [...u.root.querySelectorAll('tbody .u-label')].map(el => el.textContent);
				assert.deepEqual(labels, [...(table ? [] : ['Time']), change == 'visibility' ? 'Beta' : 'Alpha']);
			});
		}

		for (const complete of ['setLegend', 'commit', 'cursor']) {
			it(`keeps structural edits idle until ${complete} completes aligned data and selection`, async () => {
				const u = await plot({ cursor: { focus: { prox: -1 } } });
				let draws = 0;
				let rowReads = 0;
				u.hooks.draw = [() => draws++];
				Object.defineProperty(u.series[1], 'class', { get() { rowReads++; return ''; } });
				const rows = [...u.root.querySelectorAll('tbody tr')];
				u.addSeries({ label: 'Added', stroke: 'blue', ...(table && { values: () => ({ Value: '--', Double: '--' }) }) });
				await commit();
				assert.equal(draws, 0, 'addSeries does not force a canvas commit');
				assert.equal(rowReads, 0);
				assertNodes([...u.root.querySelectorAll('tbody tr')], rows);
				u.setData([...data, [70, 80, 90]], complete == 'commit');
				if (complete == 'setLegend')
					u.setLegend({});
				else if (complete == 'cursor')
					u.setCursor({ left: u.valToPos(1, 'x'), top: 20 });
				else
					await commit();
				assert.equal(u.root.querySelectorAll('tbody tr').length, rows.length + 1);
				assert.deepEqual(u.legend.order, [1, 2, 3]);
				rowReads = draws = 0;
				u.delSeries(3);
				await commit();
				assert.equal(draws, 0, 'delSeries does not force a canvas commit');
				assert.equal(rowReads, 0);
				assert.equal(u.root.querySelectorAll('tbody tr').length, rows.length + 1);
				u.setData(data, false);
				u.setLegend({});
				assertNodes([...u.root.querySelectorAll('tbody tr')], rows);
				assert.deepEqual(u.legend.order, [1, 2]);
			});
		}

		for (const operation of ['setLegend', 'setCursor']) {
			it(`retains structural dirty work created by a ${operation} hook until an explicit completion`, async () => {
				const u = await plot({ cursor: { focus: { prox: -1 } } });
				const rows = [...u.root.querySelectorAll('tbody tr')];
				let added = false;
				u.hooks.setLegend = [self => {
					if (added)
						return;
					added = true;
					assertValues(row(self, 1), 20);
					self.addSeries({ label: 'From hook', stroke: 'blue', ...(table && { values: () => ({ Value: '--', Double: '--' }) }) });
					self.setData([...data, [70, 80, 90]], false);
				}];
				if (operation == 'setLegend')
					u.setLegend({ idx: 1 });
				else
					u.setCursor({ left: u.valToPos(1, 'x'), top: 20 });
				assert.equal(added, true);
				assertNodes([...u.root.querySelectorAll('tbody tr')], rows);
				await commit();
				assertNodes([...u.root.querySelectorAll('tbody tr')], rows);
				u.setLegend({});
				assert.equal(u.root.querySelectorAll('tbody tr').length, rows.length + 1);
				assert.deepEqual(u.legend.order, [1, 2, 3]);
			});
		}

		it('keeps add and remove dirty until setLegend without rendering transient rows', async () => {
			const u = await plot();
			const rows = [...u.root.querySelectorAll('tbody tr')];
			let rowReads = 0;
			let transientReads = 0;
			Object.defineProperty(u.series[1], 'class', { get() { rowReads++; return ''; } });
			u.addSeries({ label: 'Transient', stroke: 'blue' }, 1);
			Object.defineProperty(u.series[1], 'class', { get() { transientReads++; return ''; } });
			u.delSeries(1);
			assert.equal(rowReads, 0);
			u.setLegend({ idx: 2 });
			assert.equal(rowReads, 1);
			assert.equal(transientReads, 0);
			assert.deepEqual(values(u), ['v=30', 'v=60']);
			await commit();
			assert.equal(rowReads, 1);
			assert.equal(transientReads, 0);
			assertNodes([...u.root.querySelectorAll('tbody tr')], rows);
			assertValues(row(u, 1), 30);
		});

		it('ignores stale-row events while a removed series is still in the DOM', async () => {
			const u = await plot();
			const alpha = row(u, 1);
			const beta = row(u, 2);
			const legend = u.root.querySelector('.u-legend');

			mouse('mouseenter', alpha.firstChild);
			mouse('mouseleave', legend);
			await commit();
			u.delSeries(1);
			u.setData([data[0], data[2]], false);
			let events = 0;
			u.hooks.setSeries = [() => events++];
			assert.equal(alpha.isConnected, true);
			mouse('click', alpha.firstChild);
			mouse('mouseenter', alpha.firstChild);
			assert.equal(events, 0);
			assert.equal(u.series[1].label, 'Beta');
			assert.equal(u.series[1].show, true);
			assert.equal(u.series[1]._focus, null);
			assert.equal(alpha.isConnected, true);
			u.setLegend({ idx: 1 });
			assert.deepEqual(values(u), ['v=50']);
			assert.equal(alpha.isConnected, false);
			assert.equal(row(u, 1) === beta, true);
			assert.equal(beta.style.opacity, '');
			assert.equal(beta.classList.contains('u-off'), false);
			assertValues(beta, 50);
		});

		it('reconciles inserted and deleted series by series identity', async () => {
			const u = await plot();
			const alpha = row(u, 1);
			const beta = row(u, 2);
			const added = {
				label: 'Added',
				stroke: 'blue',
				value: (self, value) => value == null ? null : `v=${value}`,
				...(table && { values: (self, si, idx) => {
					const value = self.data?.[si]?.[idx];
					return { Value: value == null ? '--' : `v=${value}`, Double: value == null ? '--' : `d=${2 * value}` };
				} }),
			};
			u.addSeries(added, 2);
			u.setData([data[0], data[1], [70, 80, 90], data[2]]);
			await commit();
			assert.deepEqual([...u.root.querySelectorAll('tbody .u-label')].map(el => el.textContent),
				table ? ['Alpha', 'Added', 'Beta'] : ['Time', 'Alpha', 'Added', 'Beta']);
			assert.equal(row(u, 1) === alpha, true);
			assert.equal(row(u, 3) === beta, true);
			u.setLegend({ idx: 1 });
			await commit();
			assertValues(row(u, 2), 80);
			u.delSeries(2);
			u.setData(data, false);
			u.setLegend({});
			assert.equal(row(u, 1) === alpha, true);
			assert.equal(row(u, 2) === beta, true);
			assert.deepEqual([...u.root.querySelectorAll('tbody .u-label')].map(el => el.textContent),
				table ? ['Alpha', 'Beta'] : ['Time', 'Alpha', 'Beta']);
		});

		for (const mode of [1, 2]) {
			it(`notifies each isolation setter with intermediate visibility and synchronous fixed-membership DOM in mode ${mode}`, async () => {
				const events = { source: [], peer: [], pub: [] };
				const snapshot = (self, si, opts) => [si, opts.show, self.series.slice(1).map(s => s.show)];
				const key = `legend-sequential-isolate-${table}-${mode}`;
				const source = await plot({ mode, cursor: { focus: { prox: -1 }, sync: { key, setSeries: true, filters: {
					pub(type, self, si, opts) {
						if (type == 'setSeries')
							events.pub.push(snapshot(self, si, opts));
						return true;
					},
				} } } });
				const peer = await plot({ mode, cursor: { focus: { prox: -1 }, sync: { key, setSeries: true } } });
				source.hooks.setSeries = [(self, si, opts) => events.source.push(snapshot(self, si, opts))];
				peer.hooks.setSeries = [(self, si, opts) => events.peer.push(snapshot(self, si, opts))];
				const rowReads = [0, 0];
				for (const [i, u] of [source, peer].entries())
					Object.defineProperty(u.series[1], 'class', { get() { rowReads[i]++; return ''; } });
				const label = [...source.root.querySelectorAll('tbody tr')].slice(-2)[0].querySelector('.u-label');

				for (const show of [false, true]) {
					for (const records of Object.values(events))
						records.length = 0;
					rowReads.fill(0);
					label.dispatchEvent(new MouseEvent('click', {
						bubbles: true, cancelable: true, button: 0, ctrlKey: true,
					}));
					const expected = [[1, true, [true, !show]], [2, show, [true, show]]];
					assert.deepEqual(events, { source: expected, peer: expected, pub: expected });
					assert.deepEqual(rowReads, [1, 1]);
					for (const u of [source, peer])
						assert.deepEqual(u.series.slice(1).map(s => s.show), [true, show]);
					await commit();
					assert.deepEqual(rowReads, [1, 1]);
					for (const u of [source, peer])
						assert.deepEqual([...u.root.querySelectorAll('tbody tr')].slice(-2).map(tr => !tr.classList.contains('u-off')), [true, show]);
				}
			});

		}

		for (const suppress of [true, false]) {
			it(`${suppress ? 'suppresses' : 'wraps'} emitted interactions through cursor.bind`, async () => {
				const bindings = [];
				const calls = [];
				const bind = Object.fromEntries(['click', 'mouseenter', 'mouseleave'].map(type => [type, (self, target, handle, onlyTarget) => {
					const listener = suppress ? null : function(event) {
						calls.push({ target, type, event, nativeThis: this === target, nativeTarget: event.currentTarget === target });
						handle(event);
					};
					bindings.push({ self, target, type, onlyTarget, handle, listener });
					return listener;
				}]));
				const u = await plot({ bind });
				const alpha = row(u, 1);
				const th = alpha.firstChild;
				const legend = u.root.querySelector('.u-legend');
				const legendBindings = () => bindings.filter(({ target }) => target == th || target == legend)
					.sort((a, b) => a.type.localeCompare(b.type));
				assert.deepEqual(legendBindings().map(({ type }) => type), ['click', 'mouseenter', 'mouseleave']);
				assertNodes(legendBindings().map(({ target }) => target), [th, th, legend]);
				assert.deepEqual(legendBindings().map(({ onlyTarget }) => onlyTarget), [false, false, true]);
				assert.equal(legendBindings().every(({ self }) => self === u), true);
				assert.equal(legendBindings().every(({ handle }) => typeof handle == 'function'), true);
				const click = mouse('click', alpha.querySelector('.u-marker'));
				const enter = mouse('mouseenter', th);
				const leave = mouse('mouseleave', legend);
				assert.equal(legendBindings().length, 3);
				assert.equal(u.series[1].show, suppress);
				assert.equal(u.series[1]._focus, null);
				const legendCalls = () => calls.filter(({ target }) => target == th || target == legend);
				assert.equal(legendCalls().length, suppress ? 0 : 3);
				if (!suppress) {
					assertNodes(legendCalls().map(({ event }) => event), [click, enter, leave]);
					assert.equal(legendCalls().every(({ nativeThis, nativeTarget }) => nativeThis && nativeTarget), true);
					assert.equal(u.cursor.event === leave, true);
					// Removing the returned listener verifies that it was registered directly, not through a proxy.
					for (const { target, type, listener } of legendBindings())
						target.removeEventListener(type, listener);
					mouse('click', th);
					mouse('mouseenter', th);
					mouse('mouseleave', legend);
					assert.equal(legendCalls().length, 3);
					assert.equal(legendBindings().length, 3);
				}
			});
		}
	});
}
