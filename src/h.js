import { isArr } from './utils.js';

// Construction only: DOM properties, style properties, and Node/text children.
// Null/false/empty children are omitted; arrays group children without wrapper nodes.
export function h(tag, props, ...children) {
	const node = document.createElement(tag);
	for (const key in props) {
		const value = props[key];
		if (value != null) {
			if (key == 'style') {
				for (const name in value) {
					if (value[name] != null)
						node.style[name] = value[name];
				}
			}
			else
				node[key] = value;
		}
	}
	append(node, children);
	return node;
}

function append(parent, child) {
	if (isArr(child)) {
		for (const item of child)
			append(parent, item);
	}
	else if (child != null && child !== false && child !== '')
		parent.append(child);
}
