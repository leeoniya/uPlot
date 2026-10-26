// Load G2 5.4.8, g-lite 2.7.2 (G), then g-webgl 2.1.3 (G.WebGL), all production UMD.
import {makeChartWithOptions, destroyChart} from './g2.mjs';

export {prepData, destroyChart, resizeChart} from './g2.mjs';

export async function makeChart(data, host, wait, runtimeOptions) {
	const renderer = new G.WebGL.Renderer();
	let chart;
	try {
		chart = await makeChartWithOptions(data, host, undefined, runtimeOptions, {renderer});
		let canvas = chart.getContext().canvas;
		const device = renderer.getPlugin('device-renderer').getDevice();
		const context = canvas.getContextService().getContext();
		if (canvas.getConfig().renderer !== renderer || !context || context !== device.gl || context.isContextLost())
			throw new Error('G2 WebGL requires an active WebGL renderer; Canvas fallback is not allowed.');

		// In these pinned versions, G2 line marks are .element paths, and the device
		// renderer attaches native GPU drawcalls to each path (not Canvas textures).
		const {InstancedPathDrawcall, InstancedLineDrawcall} = G.WebGL.DeviceRenderer;
		const elements = canvas.document.getElementsByClassName('element');
		if (elements.length !== 3 || elements.some(element => element.nodeName !== 'path' ||
			!element.renderable3D?.drawcalls.some(drawcall =>
				drawcall instanceof InstancedPathDrawcall || drawcall instanceof InstancedLineDrawcall)))
			throw new Error('G2 WebGL requires three native GPU line paths.');

		// Read the renderer-owned context on every sample, including reused charts.
		// Never call HTMLCanvasElement.getContext() to create a probe context.
		chart.getWebGLContexts = () => {
			if (!canvas) return [];
			const gl = canvas.getContextService().getContext();
			return gl && !gl.isContextLost() ? [gl] : [];
		};
		chart.on('beforedestroy', () => { canvas = null; });
		if (wait)
			wait.textContent = 'Done!';
		return chart;
	}
	catch (error) {
		try { if (chart) destroyChart(chart); }
		finally { throw error; }
	}
}
