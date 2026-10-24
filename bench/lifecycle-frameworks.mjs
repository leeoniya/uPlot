import {mountReact} from './framework-runtime.mjs';

const updates = new WeakMap();

// A state update beneath mountReact's existing error boundary preserves both
// the React root and the native chart component. No root.render/unmount cycle.
export function mountEmptyReact(host, build, ready, wait) {
	return mountLifecycleReact([], host, build, ready, wait);
}

export function mountLifecycleReact(initialData, host, build, ready, wait) {
	return mountReact(host, (React, chart) => {
		function LifecycleChart() {
			const [data, setData] = React.useState(initialData);
			updates.set(chart, {setData, ready});
			return build(data, React, chart);
		}
		return React.createElement(LifecycleChart);
	}, chart => ready(chart, initialData), wait);
}

export async function updateReact(chart, input, host, wait) {
	const state = updates.get(chart);
	if (!state || !chart.root) throw new Error('React lifecycle chart is not live.');
	chart.readySignal.throwIfAborted();
	chart.flushSync(() => state.setData(input));
	chart.readySignal.throwIfAborted();
	await state.ready(chart, input);
	chart.readySignal.throwIfAborted();
	if (wait) wait.textContent = 'Done!';
}
