import { Quadtree, pointWithin } from './lib/quadtree.js';
import { distr, SPACE_BETWEEN } from './lib/distr.js';

export function seriesBarsPlugin(opts) {
	let pxRatio;
	let font;

	let { ignore = [] } = opts;

	let radius = opts.radius ?? 0;

	function setPxRatio() {
		pxRatio = devicePixelRatio;
		font = Math.round(10 * pxRatio) + "px Arial";
	}

	setPxRatio();

	const ori        = opts.ori;
	const dir        = opts.dir;
	let stacked;

	const groupWidth = 0.9;
	const groupDistr = SPACE_BETWEEN;

	const barWidth   = 1;
	const barDistr   = SPACE_BETWEEN;

	function distrTwo(groupCount, barCount, barSpread = true) {
		if (barCount == 0)
			return [];

		if (!barSpread) {
			let layout = {
				offs: Array(groupCount).fill(0),
				size: Array(groupCount).fill(0),
			};

			distr(groupCount, groupWidth, groupDistr, null, (groupIdx, groupOffPct, groupDimPct) => {
				layout.offs[groupIdx] = groupOffPct;
				layout.size[groupIdx] = groupDimPct;
			});

			return Array(barCount).fill(layout);
		}

		let out = Array.from({length: barCount}, () => ({
			offs: Array(groupCount).fill(0),
			size: Array(groupCount).fill(0),
		}));

		distr(groupCount, groupWidth, groupDistr, null, (groupIdx, groupOffPct, groupDimPct) => {
			distr(barCount, barWidth, barDistr, null, (barIdx, barOffPct, barDimPct) => {
				out[barIdx].offs[groupIdx] = groupOffPct + groupDimPct * barOffPct;
				out[barIdx].size[groupIdx] = groupDimPct * barDimPct;
			});
		});

		return out;
	}

	let barsPctLayout;

	let barsBuilder = uPlot.paths.bars({
		radius,
		disp: {
			x0: {
				unit: 2,
				values: (u, seriesIdx) => barsPctLayout[seriesIdx].offs,
			},
			size: {
				unit: 2,
				values: (u, seriesIdx) => barsPctLayout[seriesIdx].size,
			},
			...opts.disp,
		},
		each: (u, seriesIdx, dataIdx, lft, top, wid, hgt) => {
			// we get back raw canvas coords (included axes & padding). translate to the plotting area origin
			lft -= u.bbox.left;
			top -= u.bbox.top;
			qt.add({x: lft, y: top, w: wid, h: hgt, sidx: seriesIdx, didx: dataIdx});
		},
	});

	function drawPoints(u, sidx) {
		u.ctx.save();

		u.ctx.font         = font;
		u.ctx.fillStyle    = "black";

		uPlot.orient(u, sidx, (series, dataX, dataY, scaleX, scaleY, valToPosX, valToPosY, xOff, yOff, xDim, yDim) => {
			const _dir = dir * (ori == 0 ? 1 : -1);

			const wid = Math.round(barsPctLayout[sidx].size[0] * xDim);

			barsPctLayout[sidx].offs.forEach((offs, ix) => {
				if (dataY[ix] != null) {
					let x0     = xDim * offs;
					let lft    = Math.round(xOff + (_dir == 1 ? x0 : xDim - x0 - wid));
					let barWid = Math.round(wid);

					let yPos = valToPosY(dataY[ix], scaleY, yDim, yOff);

					let x = ori == 0 ? Math.round(lft + barWid/2) : Math.round(yPos);
					let y = ori == 0 ? Math.round(yPos)           : Math.round(lft + barWid/2);

					u.ctx.textAlign    = ori == 0 ? "center" : dataY[ix] >= 0 ? "left" : "right";
					u.ctx.textBaseline = ori == 1 ? "middle" : dataY[ix] >= 0 ? "bottom" : "top";

					u.ctx.fillText(u.data[sidx][ix], x, y);
				}
			});
		});

		u.ctx.restore();
	}

	let qt;

	return {
		hooks: {
			init: u => {
				window.addEventListener('dppxchange', setPxRatio);
				for (let el of u.root.querySelectorAll('.u-cursor-pt'))
					el.style.borderRadius = 'unset';
			},
			destroy: () => {
				window.removeEventListener('dppxchange', setPxRatio);
			},
			drawClear: u => {
				qt = qt || new Quadtree(0, 0, u.bbox.width, u.bbox.height);

				qt.clear();
				qt.w = u.bbox.width;
				qt.h = u.bbox.height;

				// Bar paths must rebuild to repopulate the quadtree via each().
				u.series.forEach(s => {
					if (s.paths == barsBuilder)
						s._paths = null;
				});

				barsPctLayout = [null].concat(distrTwo(u.data[0].length, u.series.length - 1 - ignore.length, !stacked));
			},
		},
		opts: (u, opts) => {
			stacked = (opts.stack?.groups?.length ?? 0) > 0;

			const xRange = u => {
				let min = 0;
				let max = Math.max(1, u.data[0].length - 1);

				let pctOffset = 0;

				distr(u.data[0].length, groupWidth, groupDistr, 0, (di, lftPct, widPct) => {
					pctOffset = lftPct + widPct / 2;
				});

				let rn = max - min;

				if (pctOffset == 0.5)
					min -= rn;
				else {
					let upScale = 1 / (1 - pctOffset * 2);
					let offset = (upScale * rn - rn) / 2;

					min -= offset;
					max += offset;
				}

				return [min, max];
			};

			// hovered
			let hRect;

			uPlot.assign(opts, {
				select: {show: false},
				cursor: {
					x: false,
					y: false,
					drag: {
						setRange: (u, scaleKey, min, max) => scaleKey == 'x' ? xRange(u) : [min, max],
					},
					dataIdx: (u, seriesIdx) => {
						if (seriesIdx == 1) {
							hRect = null;

							let cx = u.cursor.left * pxRatio;
							let cy = u.cursor.top * pxRatio;

							qt.get(cx, cy, 1, 1, o => {
								if (pointWithin(cx, cy, o.x, o.y, o.x + o.w, o.y + o.h))
									hRect = o;
							});
						}

						return hRect && seriesIdx == hRect.sidx ? hRect.didx : null;
					},
					points: {
						fill: "rgba(255,255,255, 0.3)",
						bbox: (u, seriesIdx) => {
							let isHovered = hRect && seriesIdx == hRect.sidx;

							return {
								left:   isHovered ? hRect.x / pxRatio : -10,
								top:    isHovered ? hRect.y / pxRatio : -10,
								width:  isHovered ? hRect.w / pxRatio : 0,
								height: isHovered ? hRect.h / pxRatio : 0,
							};
						}
					}
				},
				scales: {
					x: {
						time: false,
						distr: 2,
						ori,
						dir,
						range: xRange,
					},
				}
			});

			if (ori == 1) {
				opts.padding = [0, null, 0, null];
			}

			uPlot.assign(opts.axes[0], {
				splits: u => {
					const _dir = dir * (ori == 0 ? 1 : -1);
					const splits = u._data[0].slice();
					return _dir == 1 ? splits : splits.reverse();
				},
				values:     u => u.data[0],
				gap:        15,
				size:       ori == 0 ? 40 : 150,
				labelSize:  20,
				grid:       {show: false},
				ticks:      {show: false},

				side:       ori == 0 ? 2 : 3,
			});

			opts.series.forEach((s, i) => {
				if (i > 0 && !ignore.includes(i)) {
					uPlot.assign(s, {
						paths: barsBuilder,
						points: {
							show: drawPoints
						}
					});
				}
			});
		}
	};
}