// Module namespaces are loaded before prep/init. Never mount a warm-up React root here.
// The CLI bundles a variant's complete list together to preserve React identity.
const reactVersion = '19.3.1';
const reactPins = version => `react@${version},react-dom@${version},react-is@${version}`;
function moduleDependency(name, version, global, deps, subpath = '') {
	return {name, version, type: 'module', global, path: `${subpath || 'index'}.mjs`,
		url: `https://esm.sh/${name}@${version}${subpath ? '/' + subpath : ''}?${name === 'react' || name === 'react-dom' ? '' : 'bundle&'}target=es2022${deps ? '&deps=' + deps : ''}`};
}
function reactDependencies(version = reactVersion) {
	return [
		moduleDependency('react', version, 'benchmarkReact'),
		moduleDependency('react-dom', version, 'benchmarkReactDOM', `react@${version}`),
		moduleDependency('react-dom', version, 'benchmarkReactDOMClient', `react@${version}`, 'client'),
	];
}
const muiPins = reactPins(reactVersion) + ',@mui/material@9.5.0,@mui/system@9.5.0,@emotion/react@11.14.0,@emotion/styled@11.14.1';
export const frameworkDependencies = {
	recharts: [...reactDependencies(),
			moduleDependency('recharts', '3.10.1', 'benchmarkRecharts', reactPins(reactVersion)),
			moduleDependency('d3-scale', '4.0.2', 'benchmarkD3Scale'),
		],
	muicharts: [...reactDependencies(), moduleDependency('@mui/x-charts', '9.16.0', 'benchmarkMuiCharts', muiPins, 'LineChart')],
	financialcharts: [...reactDependencies('18.3.1'),
		moduleDependency('react-financial-charts', '2.0.1', 'benchmarkFinancialCharts', reactPins('18.3.1')),
		moduleDependency('d3-scale', '4.0.2', 'benchmarkD3Scale'),
	],
	visx: [...reactDependencies(),
		...['shape', 'axis', 'scale', 'grid'].map(name => moduleDependency('@visx/' + name, '4.0.0',
			'benchmarkVisx' + name[0].toUpperCase() + name.slice(1), reactPins(reactVersion))),
	],
};

export function requireFramework(name) {
	const value = globalThis[name];
	if (!value) throw new Error(`Load ${name} before benchmark timing.`);
	return value;
}

export function prepRows(packed) {
	const fields = packed[0];
	const data = new Array((packed.length - fields - 1) / fields);
	for (let i = fields + 1, j = 0; i < packed.length; i += fields, j++) {
		data[j] = {
			time: packed[i] * 60000,
			cpu: Math.round((100 - packed[i + 1]) * 1000) / 1000,
			ram: Math.round(100 * packed[i + 5] / (packed[i + 5] + packed[i + 6]) * 100) / 100,
			tcp: packed[i + 3],
		};
	}
	return data;
}

export function calendarLabel(value) {
	const date = new Date(value);
	return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

// Child layout lifecycles and effects run inside flushSync. Observe actual line
// output for libraries that schedule a second commit; a timeout is failure only.
export async function mountReact(host, build, ready, wait) {
	const React = requireFramework('benchmarkReact');
	const ReactDOM = requireFramework('benchmarkReactDOM');
	const {createRoot} = requireFramework('benchmarkReactDOMClient');
	const element = host.ownerDocument.createElement('div');
	Object.assign(element.style, {width: '1920px', height: '600px', font: '12px Arial, sans-serif'});
	host.append(element);
	const controller = new AbortController();
	const chart = {element, root: null, flushSync: ReactDOM.flushSync, readySignal: controller.signal};
	let failure;
	const failed = error => { failure = error; controller.abort(error); };
	class Boundary extends React.Component {
		state = {failed: false};
		static getDerivedStateFromError() { return {failed: true}; }
		componentDidCatch(error) { failed(error); }
		render() { return this.state.failed ? null : this.props.children; }
	}
	try {
		chart.root = createRoot(element, {onUncaughtError: failed});
		ReactDOM.flushSync(() => chart.root.render(React.createElement(Boundary, null, build(React, chart))));
		if (failure) throw failure;
		await ready(chart);
		if (failure) throw failure;
		if (wait) wait.textContent = 'Done!';
		return chart;
	}
	catch (error) {
		try { destroyReact(chart); } catch {}
		throw error;
	}
}

export function destroyReact(chart) {
	if (!chart) return;
	try {
		if (chart.root) chart.flushSync(() => chart.root.unmount());
	}
	finally {
		chart.root = null;
		chart.instance = null;
		chart.element.remove();
	}
}

export function waitForLines(chart, selector, previousPaths) {
	const signal = chart.readySignal;
	signal?.throwIfAborted();
	const complete = () => {
		const paths = chart.element.querySelectorAll(selector);
		return paths.length === 3 && [...paths].every(path => {
			const d = path.getAttribute('d');
			return d && d.includes('L') && !/NaN|Infinity/.test(d) &&
				(!previousPaths || d !== previousPaths.get(path));
		});
	};
	if (complete()) return;
	return new Promise((resolve, reject) => {
		const observer = new MutationObserver(() => {
			if (complete()) { cleanup(); resolve(); }
		});
		const timer = setTimeout(() => {
			cleanup();
			reject(new Error(`Render did not produce three complete, current lines: ${selector}`));
		}, 15000);
		const aborted = () => { cleanup(); reject(signal.reason); };
		function cleanup() {
			observer.disconnect(); clearTimeout(timer);
			signal?.removeEventListener('abort', aborted);
		}
		signal?.addEventListener('abort', aborted, {once: true});
		observer.observe(chart.element, {subtree: true, childList: true, attributes: true});
	});
}

export function title(React) {
	return React.createElement('div', {style: {height: 40, lineHeight: '40px', textAlign: 'center', fontWeight: 'bold'}}, 'Server Events');
}

