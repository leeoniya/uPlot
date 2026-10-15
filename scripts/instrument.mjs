// console.time('mock-dom');

import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register({ width: 1920, height: 1080, settings: { errorCapture: 'disabled' } });

// Happy DOM's base Node setter is a no-op on elements. Delegate to its Element
// implementation so cached Node setters work with DOM string conversion.
const nodeTextContent = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
const elementTextContent = Object.getOwnPropertyDescriptor(Element.prototype, 'textContent');
Object.defineProperty(Node.prototype, 'textContent', {
	...nodeTextContent,
	set(value) {
		if (this instanceof Element)
			elementTextContent.set.call(this, value == null ? '' : String(value));
		else
			nodeTextContent.set.call(this, value);
	},
});

function defProp(obj, name, rest) {
	Object.defineProperty(obj, name, {
		enumerable: false,
		...rest,
	});

	return obj;
}

function getMock(meths = [], props = [], log = []) {
	const out = { log };

	let last = log.at(-1) ?? [null];
	const record = (name, value) => {
		if (name !== last[0])
			log.push(last = [name, value]);
		else
			last.push(value);
	};
	defProp(out, 'record', { value: record });

	meths.forEach(name => {
		defProp(out, name, {
			value: (...args) => {
				// JSON cannot preserve -0, which draws identically to 0 on canvas.
				for (let i = 0; i < args.length; i++) {
					if (Object.is(args[i], -0))
						args[i] = 0;
				}

				record(name, args);
			}
		});
	});

	props.forEach(name => {
		let value = name === 'globalAlpha' ? 1 : undefined;
		defProp(out, name, {
			// Alpha was a plain property; allow per-instance state observers to override it.
			configurable: name === 'globalAlpha',
			get: name === 'globalAlpha' ? () => value : undefined,
			set: val => {
				value = val;
				record(name, val);
			},
		});
	});

	return out;
}

const CanProto = HTMLCanvasElement.prototype;
const widthProp = Object.getOwnPropertyDescriptor(CanProto, 'width');
const heightProp = Object.getOwnPropertyDescriptor(CanProto, 'height');

CanProto.getContext = function() {
	if (this.ctx != null)
		return this.ctx;

	const mock = getMock(
		['clearRect', 'fillText', 'translate', 'rotate', 'setLineDash', 'beginPath', 'moveTo', 'lineTo', 'bezierCurveTo', 'quadraticCurveTo', 'stroke', 'fill', 'save', 'restore', 'clip', 'fillRect', 'arc', 'arcTo'],
		['strokeStyle', 'fillStyle', 'lineWidth', 'font', 'textAlign', 'textBaseline', 'lineJoin', 'lineCap', 'globalAlpha'],
	);

	defProp(mock, 'createLinearGradient', {
		value: (...args) => {
			const gradient = getMock(['addColorStop']);
			gradient.type = 'linearGradient';
			gradient.args = args;
			return gradient;
		},
	});

	mock.width = 0;
	mock.height = 0;

	Object.defineProperties(this, {
		ctx: {
			value: mock,
			enumerable: false,
			writable: false,
			configurable: false,
		},
		width: {
			...widthProp,
			set(val) {
				widthProp.set.call(this, mock.width = val);
				mock.record('canvas.width', val);
			}
		},
		height: {
			...heightProp,
			set(val) {
				heightProp.set.call(this, mock.height = val);
				mock.record('canvas.height', val);
			}
		},
	});

	return mock;
};

global.Path2D = function(source) {
	// Clone nested addPath logs and argument arrays, not just the operation groups.
	const log = source?.log == null ? [] : structuredClone(source.log);
	return getMock(['moveTo', 'lineTo', 'bezierCurveTo', 'quadraticCurveTo', 'rect', 'arc', 'arcTo', 'ellipse', 'roundRect', 'closePath', 'addPath'], [], log);
};

// console.timeEnd('mock-dom');
