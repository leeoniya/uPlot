import { plotStep } from './renderDemo.js';
import { loadFixture } from './demoResources.js';
import { stats } from './lib/stats.js';

// column-highlights the hovered x index
function columnHighlightPlugin({ className, style = {backgroundColor: "rgba(51,204,255,0.3)"} } = {}) {
	let underEl, overEl, highlightEl, currIdx;

	function init(u) {
		underEl = u.under;
		overEl = u.over;

		highlightEl = document.createElement("div");

		className && highlightEl.classList.add(className);

		uPlot.assign(highlightEl.style, {
			pointerEvents: "none",
			display: "none",
			position: "absolute",
			left: 0,
			top: 0,
			height: "100%",
			...style
		});

		underEl.appendChild(highlightEl);

		// show/hide highlight on enter/exit
		overEl.addEventListener("mouseenter", () => {highlightEl.style.display = null;});
		overEl.addEventListener("mouseleave", () => {highlightEl.style.display = "none";});
	}

	function update(u) {
		if (currIdx !== u.cursor.idx) {
			currIdx = u.cursor.idx;

			const dx    = u.scales.x.max - u.scales.x.min;
			const width = (u.bbox.width / dx) / devicePixelRatio;
			const left  = u.valToPos(currIdx, "x") - width / 2;

			highlightEl.style.transform = "translateX(" + Math.round(left) + "px)";
			highlightEl.style.width = Math.round(width) + "px";
		}
	}

	return {
		opts: (u, opts) => {
			uPlot.assign(opts, {
				cursor: {
					x: false,
					y: false,
				}
			});
		},
		hooks: {
			init: init,
			setCursor: update,
		}
	};
}

// converts the legend into a simple tooltip
export function legendAsTooltipPlugin({ className, style = { backgroundColor:"rgba(255, 249, 196, 0.92)", color: "black" } } = {}) {
	let legendEl;

	function mount(u, el) {
		legendEl = el;

		legendEl.classList.remove("u-inline");
		className && legendEl.classList.add(className);

		uPlot.assign(legendEl.style, {
			textAlign: "left",
			pointerEvents: "none",
			display: "none",
			position: "absolute",
			left: 0,
			top: 0,
			zIndex: 100,
			boxShadow: "2px 2px 10px rgba(0,0,0,0.5)",
			...style
		});

		// hide series color markers
		const idents = legendEl.querySelectorAll(".u-marker");

		for (let i = 0; i < idents.length; i++)
			idents[i].style.display = "none";

		const overEl = u.over;
		overEl.style.overflow = "visible";

		// move legend into plot bounds
		overEl.appendChild(legendEl);

		// show/hide tooltip on enter/exit
		overEl.addEventListener("mouseenter", () => {legendEl.style.display = "";});
		overEl.addEventListener("mouseleave", () => {legendEl.style.display = "none";});

		if (overEl.matches(":hover"))
			legendEl.style.display = "";
		update(u);
	}

	function update(u) {
		if (legendEl != null) {
			const { left, top } = u.cursor;
			legendEl.style.transform = "translate(" + left + "px, " + top + "px)";
		}
	}

	return {
		opts: (u, opts) => {
			uPlot.assign(opts, { legend: { mount } });
		},
		hooks: {
			setCursor: update,
		}
	};
}

function boxesPlugin({ gap = 2, shadowColor = "#000000", bearishColor = "#e54245", bullishColor = "#4ab650", bodyWidthFactor = 0.7, shadowWidth = 2, bodyOutline = 1 } = {}) {

	function drawBoxes(u) {
		u.ctx.save();

		const offset = (shadowWidth % 2) / 2;

		u.ctx.translate(offset, offset);

		for (let i = u.scales.x.min; i <= u.scales.x.max; i++) {
			let med          = u.data[1][i];
			let q1           = u.data[2][i];
			let q3           = u.data[3][i];
			let min          = u.data[4][i];
			let max          = u.data[5][i];
			let outs         = u.data[6][i];

			let timeAsX      = u.valToPos(i,     "x", true);
			let lowAsY       = u.valToPos(min,   "y", true);
			let highAsY      = u.valToPos(max,   "y", true);
			let openAsY      = u.valToPos(q1,    "y", true);
			let closeAsY     = u.valToPos(q3,    "y", true);
			let medAsY       = u.valToPos(med,   "y", true);

			// shadow rect
			let shadowHeight = Math.max(highAsY, lowAsY) - Math.min(highAsY, lowAsY);
			let shadowX      = timeAsX;
			let shadowY      = Math.min(highAsY, lowAsY);

			// Rounded quartiles can leave no inlier range; native canvas ignores its NaN coordinates.
			if (min != null && max != null) {
				u.ctx.beginPath();
				u.ctx.setLineDash([4, 4]);
				u.ctx.lineWidth = shadowWidth;
				u.ctx.strokeStyle = shadowColor;
				u.ctx.moveTo(
					Math.round(shadowX),
					Math.round(shadowY),
				);
				u.ctx.lineTo(
					Math.round(shadowX),
					Math.round(shadowY + shadowHeight),
				);
				u.ctx.stroke();
			}

			// body rect
			let columnWidth  = u.bbox.width / (u.scales.x.max - u.scales.x.min);
			let bodyWidth    = Math.round(bodyWidthFactor * (columnWidth - gap));
			let bodyHeight   = Math.max(closeAsY, openAsY) - Math.min(closeAsY, openAsY);
			let bodyX        = timeAsX - (bodyWidth / 2);
			let bodyY        = Math.min(closeAsY, openAsY);
			let bodyColor    = "#eee";

			u.ctx.fillStyle = shadowColor;
			u.ctx.fillRect(
				Math.round(bodyX),
				Math.round(bodyY),
				Math.round(bodyWidth),
				Math.round(bodyHeight),
			);

			u.ctx.fillStyle = bodyColor;
			u.ctx.fillRect(
				Math.round(bodyX + bodyOutline),
				Math.round(bodyY + bodyOutline),
				Math.round(bodyWidth - bodyOutline * 2),
				Math.round(bodyHeight - bodyOutline * 2) + 0, // Avoid -0 for small negative inset heights.
			);

			u.ctx.fillStyle = "#000";
			u.ctx.fillRect(
				Math.round(bodyX),
				Math.round(medAsY - 1),
				Math.round(bodyWidth),
				Math.round(2),
			);

			// hz min/max whiskers
			if (min != null && max != null) {
				u.ctx.beginPath();
				u.ctx.setLineDash([]);
				u.ctx.lineWidth = shadowWidth;
				u.ctx.strokeStyle = shadowColor;
				u.ctx.moveTo(
					Math.round(bodyX),
					Math.round(highAsY),
				);
				u.ctx.lineTo(
					Math.round(bodyX + bodyWidth),
					Math.round(highAsY),
				);
				u.ctx.moveTo(
					Math.round(bodyX),
					Math.round(lowAsY),
				);
				u.ctx.lineTo(
					Math.round(bodyX + bodyWidth),
					Math.round(lowAsY),
				);
				u.ctx.stroke();
			}


			for (let j = 0; j < outs.length; j++) {
				let cy = u.valToPos(outs[j], "y", true);
				u.ctx.fillRect(timeAsX - 4, cy - 4, 8, 8);
			}
		}

		u.ctx.translate(0 - offset, 0 - offset);

		u.ctx.restore();
	}

	return {
		opts: (u, opts) => {
			uPlot.assign(opts, {
				cursor: {
					points: {
						show: false,
					}
				},
				scales: {
					y: {
						range: (u, dataMin, dataMax) => {
							// TODO: only scan values in x idx0...idx1 range
							let outsMin = Math.min(...u.data[6].map(outs => outs.at(0) ?? Infinity));
							let outsMax = Math.max(...u.data[6].map(outs => outs.at(-1) ?? -Infinity));

							return uPlot.rangeNum(Math.min(dataMin, outsMin), Math.max(dataMax, outsMax), 0.1, true);
						}
					}
				}
			});

			opts.series.forEach(series => {
				series.paths = () => null;
				series.points = {show: false};
			});
		},
		hooks: {
			draw: drawBoxes,
		}
	};
}

async function makeChart(chartName) {

	const results = await loadFixture('./data/results.json');

	let benches = {};
	// group by bench
	results.filter(run => run.benchmark === chartName && !run.framework.includes("non-keyed")).forEach(run => {
		let bench = benches[run.benchmark] = benches[run.benchmark] || {};
		let s = stats(run.values);
		let iq = s.q3 - s.q1;

		// filter outliers
		run.values.sort((a, b) => a - b);
		let pad = iq * 1.5;

		let vals = [];
		let outs = [];

		run.values.forEach(v => {
			if (v >= s.q1 - pad && v <= s.q3 + pad)
				vals.push(v);
			else
				outs.push(v);
		});

		outs.sort((a, b) => a - b);

		bench[run.framework] = [
			s.median,
			s.q1,
			s.q3,
			vals[0],
			vals[vals.length - 1],
			outs,
		];
	});

	let charts = {};

	for (let bName in benches) {
		let bench = benches[bName];

		let libNames = Object.keys(bench);

		libNames.sort((libNameA, libNameB) => {
			return bench[libNameA][0] - bench[libNameB][0];
		});

		charts[bName] = {
			libs: libNames,
			data: [
				new Array(libNames.length).fill(0).map((v,i) => i).slice(0,30),
				// medians
				libNames.map(libName => bench[libName][0]).slice(0,30),
				// q1
				libNames.map(libName => bench[libName][1]).slice(0,30),
				// q3
				libNames.map(libName => bench[libName][2]).slice(0,30),
				// min
				libNames.map(libName => bench[libName][3]).slice(0,30),
				// max
				libNames.map(libName => bench[libName][4]).slice(0,30),
				// outliers
				libNames.map(libName => bench[libName][5]).slice(0,30),
			]
		};
	}

	let chart = charts[chartName];
	let libs = chart.libs.slice(0,30);

	const opts = {
		width: 800,
		height: 400,
		title: chartName,
		plugins: [
			columnHighlightPlugin(),
			legendAsTooltipPlugin(),
			boxesPlugin()
		],
		axes: [
			{
				rotate: -90,
				space: 10,
				size: 100,
				grid: {show: false},
				values: (self, vals) => vals.map(v => libs[v]),
			},
		],
		scales: {
			x: {
				distr: 2,
				time: false,
			}
		},
		series: [
			{
				label: "Lib",
				value: (self, i) => libs[i],
			},
			{
				label: "Median",
			},
			{
				label: "q1",
			},
			{
				label: "q3",
			},
			{
				label: "min",
			},
			{
				label: "max",
			},
		],
	};

	return new uPlot(opts, chart.data, document.body);
}

const groups = [{
	steps: [
		"01_run1k",
		"02_replace1k",
		"03_update10th1k_x16",
		"04_select1k",
		"05_swap1k",
		"06_remove-one-1k",
		"07_create10k",
		"08_create1k-after1k_x2",
		"09_clear1k_x8",
		"21_ready-memory",
		"22_run-memory",
		"23_update5-memory",
		"24_run5-memory",
		"25_run-clear-memory",
		"31_startup-ci",
		"32_startup-bt",
		"34_startup-totalbytes",
	].map(chartName => ({
		id: chartName,
		...plotStep(() => makeChart(chartName)),
	})),
}];

export default groups;
