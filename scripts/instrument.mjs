// console.time('mock-dom');

import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register({ width: 1920, height: 1080, settings: { errorCapture: 'disabled' } });

// ivi calls the cached Node setter on elements. Happy DOM's base setter is a
// no-op; delegate to its Element implementation with DOM string conversion.
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

function getMock(meths = [], props = []) {
	const log = [];
	const out = { log };

	let last = [null];

	meths.forEach(name => {
		defProp(out, name, {
			value: (...args) => {
				// JSON cannot preserve -0, which draws identically to 0 on canvas.
				for (let i = 0; i < args.length; i++) {
					if (Object.is(args[i], -0))
						args[i] = 0;
				}

				// console.log(name, args);

				if (name !== last[0])
					log.push(last = [name, args]);
				else
					last.push(args);
			}
		});
	});

	props.forEach(name => {
		defProp(out, name, {
			set: val => {
				// console.log(name, val);

				if (name !== last[0])
					log.push(last = [name, val]);
				else
					last.push(val);
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
		['strokeStyle', 'fillStyle', 'lineWidth', 'font', 'textAlign', 'textBaseline', 'lineJoin', 'lineCap'],
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
			}
		},
		height: {
			...heightProp,
			set(val) {
				heightProp.set.call(this, mock.height = val);
			}
		},
	});

	return mock;
};

global.Path2D = function() {
	return getMock(['moveTo', 'lineTo', 'bezierCurveTo', 'quadraticCurveTo', 'rect', 'arc', 'arcTo', 'ellipse', 'roundRect', 'closePath', 'addPath']);
};

// console.timeEnd('mock-dom');
