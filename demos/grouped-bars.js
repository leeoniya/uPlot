function seriesBarsPlugin(opts) {
	let pxRatio;
	let font;

	function setPxRatio() {
		pxRatio = devicePixelRatio;
		font = Math.round(10 * pxRatio) + "px Arial";
	}

	setPxRatio();

	window.addEventListener('dppxchange', setPxRatio);

	const ori        = opts.ori;
	const dir        = opts.dir;
	const stacked    = opts.stacked;

	const groupWidth = 0.9;
	const groupDistr = SPACE_BETWEEN;

	const barWidth   = 1;
	const barDistr   = SPACE_BETWEEN;

	function distrTwo(groupCount, barCount) {
		let out = Array.from({length: barCount}, () => ({
			offs: Array(groupCount).fill(0),
			size: Array(groupCount).fill(0),
		}));

		distr(groupCount, groupWidth, groupDistr, null, (groupIdx, groupOffPct, groupDimPct) => {
			distr(barCount, barWidth, barDistr, null, (barIdx, barOffPct, barDimPct) => {
				out[barIdx].offs[groupIdx] = groupOffPct + (groupDimPct * barOffPct);
				out[barIdx].size[groupIdx] = groupDimPct * barDimPct;
			});
		});

		return out;
	}

	function distrOne(groupCount, barCount) {
		let out = Array.from({length: barCount}, () => ({
			offs: Array(groupCount).fill(0),
			size: Array(groupCount).fill(0),
		}));

		distr(groupCount, groupWidth, groupDistr, null, (groupIdx, groupOffPct, groupDimPct) => {
			distr(barCount, barWidth, barDistr, null, (barIdx, barOffPct, barDimPct) => {
				out[barIdx].offs[groupIdx] = groupOffPct;
				out[barIdx].size[groupIdx] = groupDimPct;
			});
		});

		return out;
	}

	let barsPctLayout;

	let barsBuilder = uPlot.paths.bars({
		disp: {
			x0: {
				unit: 2,
			//	discr: false, (unary, discrete, continuous)
				values: (u, seriesIdx, idx0, idx1) => barsPctLayout[seriesIdx].offs,
			},
			size: {
				unit: 2,
			//	discr: true,
				values: (u, seriesIdx, idx0, idx1) => barsPctLayout[seriesIdx].size,
			},
			/*
			// e.g. variable size via scale (will compute offsets from known values)
			x1: {
				units: 1,
				values: (u, seriesIdx, idx0, idx1) => bucketEnds[idx],
			},
			fill: {
				units: 3, // color
				discr: true,
				values: (u, seriesIdx, idx0, idx1) => colors[idx],
			}
			*/
		},
		each: (u, seriesIdx, dataIdx, lft, top, wid, hgt) => {
			// we get back raw canvas coords (included axes & padding). translate to the plotting area origin
			lft -= u.bbox.left;
			top -= u.bbox.top;
			qt.add({x: lft, y: top, w: wid, h: hgt, sidx: seriesIdx, didx: dataIdx});
		},
	});

	function drawPoints(u, sidx, i0, i1) {
		u.ctx.save();

		u.ctx.font         = font;
		u.ctx.fillStyle    = "black";

		uPlot.orient(u, sidx, (series, dataX, dataY, scaleX, scaleY, valToPosX, valToPosY, xOff, yOff, xDim, yDim, moveTo, lineTo, rect) => {
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

					u.ctx.fillText(dataY[ix], x, y);
				}
			});
		});

		u.ctx.restore();
	}

	function range(u, dataMin, dataMax) {
		let [min, max] = uPlot.rangeNum(0, dataMax, 0.05, true);
		return [0, max];
	}

	let qt;
	let hovered = null;

	let barMark = document.createElement("div");
	barMark.classList.add("bar-mark");

	return {
		hooks: {
			init: u => {
				u.over.appendChild(barMark);
			},
			drawClear: u => {
				qt = qt || new Quadtree(0, 0, u.bbox.width, u.bbox.height);

				qt.clear();

				// force-clear the path cache to cause drawBars() to rebuild new quadtree
				u.series.forEach(s => {
					s._paths = null;
				});

				if (stacked)
					barsPctLayout = [null].concat(distrOne(u.data.length - 1, u.data[0].length));
				else
					barsPctLayout = [null].concat(distrTwo(u.data[0].length, u.data.length - 1));
			},
			setCursor: u => {
				let found = null;
				let cx = u.cursor.left * pxRatio;
				let cy = u.cursor.top * pxRatio;

				qt.get(cx, cy, 1, 1, o => {
					if (pointWithin(cx, cy, o.x, o.y, o.x + o.w, o.y + o.h))
						found = o;
				});

				if (found) {
					if (found != hovered) {
						barMark.style.display = null;
						barMark.style.left    = (found.x / pxRatio) + "px";
						barMark.style.top     = (found.y / pxRatio) + "px";
						barMark.style.width   = (found.w / pxRatio) + "px";
						barMark.style.height  = (found.h / pxRatio) + "px";
						hovered = found;
					}
				}
				else if (hovered != null) {
					hovered = null;
					barMark.style.display = "none";
				}
			}
		},
		opts: (u, opts) => {
			const yScaleOpts = {
				range,
				ori: ori == 0 ? 1 : 0,
			};

			uPlot.assign(opts, {
				select: {show: false},
				cursor: {
					x: false,
					y: false,
					points: {show: false}
				},
				scales: {
					x: {
						time: false,
						distr: 2,
						ori,
						dir,
					},
					rend:   yScaleOpts,
					size:   yScaleOpts,
					mem:    yScaleOpts,
					inter:  yScaleOpts,
					toggle: yScaleOpts,
				}
			});

			if (ori == 1) {
				opts.padding = [0, null, 0, null];
			}

			uPlot.assign(opts.axes[0], {
				splits: (u, axisIdx) => {
					const dim = ori == 0 ? u.bbox.width : u.bbox.height;
					const _dir = dir * (ori == 0 ? 1 : -1);

					let splits = [];

					distr(u.data[0].length, groupWidth, groupDistr, null, (di, lftPct, widPct) => {
						let groupLftPx = (dim * lftPct) / pxRatio;
						let groupWidPx = (dim * widPct) / pxRatio;

						let groupCenterPx = groupLftPx + groupWidPx / 2;

						splits.push(u.posToVal(groupCenterPx, 'x'));
					});

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
				if (i > 0) {
					uPlot.assign(s, {
						width: 0,
					//	pxAlign: false,
					//	stroke: "rgba(255,0,0,0.5)",
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