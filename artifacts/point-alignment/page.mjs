import { withSeededRandom } from '/scripts2/withSeededRandom.mjs';
import groups from '/demos/points.js';

const version = new URL(location.href).searchParams.get('version');
const { default: uPlot } = await import('/' + version + '.mjs');
globalThis.uPlot = uPlot;

// Record native canvas arcs and their drawing transforms without changing rendering.
const arcs = new WeakMap();
const draws = new WeakMap();
const arc = Path2D.prototype.arc;
Path2D.prototype.arc = function(...args) {
	if (!arcs.has(this)) arcs.set(this, []);
	arcs.get(this).push(args);
	return arc.apply(this, args);
};
const stroke = CanvasRenderingContext2D.prototype.stroke;
CanvasRenderingContext2D.prototype.stroke = function(path) {
	if (arcs.has(path)) {
		const matrix = this.getTransform();
		draws.set(this, arcs.get(path).map(([x, y]) => {
			const point = matrix.transformPoint({ x, y });
			return { x: point.x, y: point.y };
		}));
	}
	return stroke.apply(this, arguments);
};

let plots;
await withSeededRandom(async () => { plots = await groups[0].steps[0].render(); });
const u = plots[1];
for (const plot of plots) {
	if (plot !== u) plot.destroy();
}
document.body.replaceChildren(u.root);
u.syncRect();
await document.fonts.ready;
await new Promise(requestAnimationFrame);

const canvas = u.ctx.canvas;
const markers = draws.get(u.ctx);
function measure(idx) {
	const over = u.over.getBoundingClientRect();
	u.setCursor({ left: u.valToPos(u.data[0][idx], 'x'), top: u.valToPos(u.data[1][idx], 'y') });
	const point = u.over.querySelector('.u-cursor-pt').getBoundingClientRect();
	const rect = canvas.getBoundingClientRect();
	const center = {
		x: rect.left + markers[idx].x * rect.width / canvas.width,
		y: rect.top + markers[idx].y * rect.height / canvas.height,
	};
	const hover = { x: point.left + point.width / 2, y: point.top + point.height / 2 };
	return {
		idx,
		value: [u.data[0][idx], u.data[1][idx]],
		canvas: center,
		hover,
		delta: { x: hover.x - center.x, y: hover.y - center.y },
		mouse: {
			x: Math.round(over.left + u.valToPos(u.data[0][idx], 'x') + 3),
			y: Math.round(over.top + u.valToPos(u.data[1][idx], 'y') + 12),
		},
	};
}
// Use an interior point with a visible old displacement, then reuse its index after the fix.
const candidates = Array.from({ length: 110 }, (_, i) => measure(i + 30));
candidates.sort((a, b) => Math.hypot(b.delta.x, b.delta.y) - Math.hypot(a.delta.x, a.delta.y));
globalThis.repro = {
	u,
	measure,
	candidate: candidates[0],
	info: {
		version,
		userAgent: navigator.userAgent,
		devicePixelRatio,
		viewport: { width: innerWidth, height: innerHeight },
		canvas: { width: canvas.width, height: canvas.height },
		data: u.data,
	},
};
u.setCursor({ left: -10, top: -10 });
