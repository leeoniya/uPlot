const prepared = new WeakSet();
const charts = new WeakMap();
const owners = new WeakMap();
const destroyed = new WeakSet();

export function prepareOwnership() {
	const prototype = globalThis.HTMLCanvasElement?.prototype;
	if (!globalThis.virtualWebGL || typeof prototype?.getContext !== 'function')
		throw new Error('Plotly dashboard requires virtual-webgl WebGL1 1.0.7 before prepareRuntime().');
	if (prepared.has(prototype)) return;

	const descriptor = Object.getOwnPropertyDescriptor(prototype, 'getContext');
	const getContext = prototype.getContext;
	Object.defineProperty(prototype, 'getContext', {...descriptor, value: function(type, ...args) {
		const gl = getContext.call(this, type, ...args);
		if (gl && (type === 'webgl' || type === 'experimental-webgl')) {
			// newPlot calls overlap; ownership follows the canvas, not the active promise.
			for (let node = this; node; node = node.parentNode) {
				const state = charts.get(node);
				if (state) {
					retain(state, gl);
					break;
				}
			}
		}
		return gl;
	}});
	prepared.add(prototype);
	// The completion observer must wrap the virtual context and ownership layers.
	if (globalThis.benchmarkWebGL)
		globalThis.benchmarkWebGL = globalThis.benchmarkWebGL.reinstall();
}

function retain(state, gl) {
	const owner = owners.get(gl);
	if (owner && owner !== state)
		throw new Error('Plotly dashboard WebGL context belongs to another chart.');
	owners.set(gl, state);
	state.contexts.add(gl);
}

export function register(host) {
	if (!prepared.has(globalThis.HTMLCanvasElement?.prototype))
		throw new Error('Call Plotly dashboard prepareRuntime() before makeChart().');
	if (charts.has(host)) throw new Error('Plotly dashboard host is already registered.');
	destroyed.delete(host);
	charts.set(host, {regls: new Set(), contexts: new Set(), destroying: false});
	host.getWebGLContexts = () => charts.has(host) && !destroyed.has(host) ? collect(host) : [];
}

export function collect(chart) {
	const state = charts.get(chart);
	if (!state) return [];
	const contexts = [];
	for (const entry of chart._fullLayout?._glcanvas?.data() ?? []) {
		const regl = entry?.regl;
		if (!regl) continue;
		if (regl._gl) {
			retain(state, regl._gl);
			contexts.push(regl._gl);
		}
		state.regls.add(regl);
	}
	return contexts;
}

// Collect even when Plotly rejects, without replacing the original render error.
export async function render(chart, action) {
	let failed = false;
	try { return await action(); }
	catch (error) { failed = true; throw error; }
	finally {
		try { collect(chart); }
		catch (error) { if (!failed) throw error; }
	}
}

export function requireWebGL(chart) {
	const contexts = collect(chart);
	const regls = (chart._fullLayout?._glcanvas?.data() ?? []).filter(entry => entry?.regl).map(entry => entry.regl);
	if (!charts.has(chart) || chart.querySelector?.('.no-webgl') || regls.length !== 2 ||
		regls.some(regl => typeof regl.destroy !== 'function' || !regl._gl) ||
		new Set(contexts).size !== 2 || contexts.some(gl => typeof gl.dispose !== 'function' ||
			typeof gl.isContextLost !== 'function' || gl.isContextLost()))
		throw new Error('Plotly dashboard requires two live virtual regl contexts; WebGL fallback is not allowed.');
}

export function destroyWebGL(chart) {
	if (destroyed.has(chart)) return true;
	const state = charts.get(chart);
	if (!state) return false;
	if (state.destroying) return true;
	state.destroying = true;
	const errors = [];
	const attempt = action => { try { action(); } catch (error) { errors.push(error); } };

	// Snapshot before purge removes _fullLayout. Never acquire a context in cleanup.
	attempt(() => collect(chart));
	attempt(() => Plotly.purge(chart));
	for (const regl of state.regls) attempt(() => regl.destroy());
	// Use only the public virtual-webgl API; it does not promise full driver cleanup.
	for (const gl of state.contexts) {
		if (typeof gl.dispose === 'function') attempt(() => gl.dispose());
		owners.delete(gl);
	}
	state.regls.clear();
	state.contexts.clear();
	charts.delete(chart);
	destroyed.add(chart);
	if (errors.length)
		throw new AggregateError(errors, 'Plotly dashboard cleanup failed.', {cause: errors[0]});
	return true;
}
