import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';

const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-8, `${message}: ${actual} != ${expected}`);
const data = [[0, 1, 2], [4, 6, 8]];

async function checkGap({ori, dir, align, pxRatio, explicit, factor, gap, width}) {
	const bounds = [];
	const positions = data[0].map(v => v + (explicit ? 0.2 : 0));
	const paths = uPlot.paths.bars({
		align, size: [factor, Infinity], gap,
		disp: explicit ? {
			x0: {unit: 1, values: () => positions},
			size: {kind: 1, unit: 2, values: () => factor / 5},
		} : undefined,
		each: (u, si, di, ...box) => bounds.push([di, box]),
	});
	const u = new uPlot({
		width: 400, height: 240, pxRatio, padding: [0, 0, 0, 0],
		axes: [], cursor: {show: false}, legend: {show: false},
		scales: {
			x: {time: false, ori, dir, range: [-1, 4]},
			y: {ori: 1 - ori, range: [0, 10]},
		},
		series: [{}, {paths, pxAlign: 0, width, fill: 'red', stroke: 'blue', points: {show: false}}],
	}, data, document.body);
	try {
		await Promise.resolve();
		assert.equal(bounds.length, 3);
		const [leading, trailing] = typeof gap == 'number' ? [0, gap] : gap;
		const slot = Math.abs(u.valToPos(1, 'x', true) - u.valToPos(0, 'x', true));
		const nominalWidth = slot * factor;
		const totalGap = (leading + trailing) * pxRatio;
		const inset = slot - nominalWidth + totalGap >= 1;
		const outerWidth = inset ? nominalWidth - totalGap : slot + width * pxRatio;
		const direction = dir * (ori == 0 ? 1 : -1);
		const centerShift = inset ? (leading - trailing) * pxRatio / 2 : 0;
		for (const [di, box] of bounds) {
			const center = u.valToPos(positions[di], 'x', true) + align * direction * (nominalWidth / 2 + centerShift);
			const context = `disp ${explicit}, factor ${factor}, gap ${JSON.stringify(gap)}, stroke ${width}, index ${di}`;
			close(box[ori + 2], outerWidth, `outer width (${context})`);
			close(box[ori] + box[ori + 2] / 2, center, `center (${context})`);
		}
	}
	finally { u.destroy(); }
}

describe('leading and trailing bar gaps', () => {
	for (const ori of [0, 1]) {
		for (const dir of [-1, 1]) {
			for (const align of [-1, 0, 1]) {
				for (const pxRatio of [1, 1.5, 2]) {
					it(`insets the requested edges (orientation ${ori}, direction ${dir}, alignment ${align}, DPR ${pxRatio})`, async () => {
						for (const explicit of align == 1 ? [false, true] : [false]) {
							for (const factor of [0.6, 1]) {
								for (const gap of [0, 0.25, 3, 16, [0, 0], [0, 3], [3, 0], [1.5, 1.5], [2, 6], [6, 2], [0.125, 0.125]]) {
									for (const width of [0, 1, 2])
										await checkGap({ori, dir, align, pxRatio, explicit, factor, gap, width});
								}
							}
						}
					});
				}
			}
		}
	}
});
