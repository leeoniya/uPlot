// Shared lifecycle for the React-based stacking comparisons.
export function hasPaths(element, selector, count = 4) {
	const paths = element.querySelectorAll(selector);
	return paths.length === count && [...paths].every(path => {
		const d = path.getAttribute('d');
		return d && d.includes('L') && !/NaN|Infinity/.test(d);
	});
}

export async function mountReact(host, build, Library, name, isReady) {
	const {React, ReactDOM, ReactDOMClient} = Library ?? {};
	if (typeof React?.createElement !== 'function' || typeof ReactDOM?.flushSync !== 'function' || typeof ReactDOMClient?.createRoot !== 'function')
		throw new Error(`${name} did not load`);

	const element = host.ownerDocument.createElement('div');
	const win = host.ownerDocument.defaultView;
	host.appendChild(element);
	let plot;

	function destroy() {
		try {
			if (plot)
				ReactDOM.flushSync(() => plot.unmount());
		}
		finally {
			plot = null;
			element.remove();
		}
	}

	try {
		await new Promise((resolve, reject) => {
			let settled = false;
			const observer = new win.MutationObserver(check);
			const timer = win.setTimeout(() => finish(new Error(`${name} did not render four stacked areas`)), 10000);

			function finish(error) {
				if (settled)
					return;
				settled = true;
				observer.disconnect();
				win.clearTimeout(timer);
				if (error)
					reject(error);
				else
					resolve();
			}

			function check() {
				if (!settled) {
					try {
						if (isReady(element))
							finish();
					}
					catch (error) {
						finish(error);
					}
				}
			}

			observer.observe(element, {subtree: true, childList: true, attributes: true});
			try {
				plot = ReactDOMClient.createRoot(element, {onUncaughtError: finish});
				ReactDOM.flushSync(() => plot.render(build(React)));
				check();
			}
			catch (error) {
				finish(error);
			}
		});
	}
	catch (error) {
		try { destroy(); }
		finally { throw error; }
	}

	return {plot, destroy};
}
