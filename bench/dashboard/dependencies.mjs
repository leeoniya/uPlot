import {demoDependencies} from '../demo-dependencies.mjs';

// Use the WebGL1 build explicitly; the package default is the WebGL2 build.
const plotlyDependencies = [
	{name: 'virtual-webgl', version: '1.0.7', path: 'src/virtual-webgl.js'},
	...demoDependencies.plotly,
];

export function dashboardDependencies(variant) {
	return variant === 'plotly' ? plotlyDependencies : demoDependencies[variant];
}
