import {mountReact} from './framework-runtime.mjs';

const updates = new WeakMap();

// A state update beneath mountReact's existing error boundary preserves both
// the React root and the native chart component. No root.render/unmount cycle.
export function mountLifecycleReact(initialData, host, build, ready, wait, {width = 1920, height = 600} = {}) {
	return mountReact(host, (React, chart) => {
		function LifecycleChart() {
			const [state, setState] = React.useState({data: initialData, width, height});
			updates.set(chart, {state, setState, ready});
			return build(state.data, React, chart, state);
		}
		return React.createElement(LifecycleChart);
	}, chart => ready(chart, initialData, updates.get(chart).state), wait, {width, height});
}

export async function updateReact(chart, input, host, wait) {
	const state = updates.get(chart);
	if (!state || !chart.root) throw new Error('React lifecycle chart is not live.');
	chart.readySignal.throwIfAborted();
	chart.flushSync(() => state.setState({...state.state, data: input}));
	chart.readySignal.throwIfAborted();
	await state.ready(chart, input, updates.get(chart).state);
	chart.readySignal.throwIfAborted();
	if (wait) wait.textContent = 'Done!';
}

export async function resizeReact(chart, {width, height}, host, wait) {
	const current = updates.get(chart);
	if (!current || !chart.root) throw new Error('React lifecycle chart is not live.');
	chart.readySignal.throwIfAborted();
	const changed = width !== current.state.width || height !== current.state.height;
	// Existing paths can survive a vendor's deferred layout commit. A resize is
	// ready only when those paths contain geometry from the new dimensions.
	const previousPaths = changed ? new Map([...chart.element.querySelectorAll('path')]
		.map(path => [path, path.getAttribute('d')])) : undefined;
	const next = {...current.state, width, height};
	chart.flushSync(() => {
		Object.assign(chart.element.style, {width: `${width}px`, height: `${height}px`});
		current.setState(next);
	});
	chart.readySignal.throwIfAborted();
	// flushSync commits the dimension props beneath the original boundary/root.
	if (updates.get(chart).state !== next) throw new Error('React chart did not commit resized dimensions.');
	await current.ready(chart, next.data, next, previousPaths);
	chart.readySignal.throwIfAborted();
	if (wait) wait.textContent = 'Done!';
}
