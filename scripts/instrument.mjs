// console.time('mock-dom');

import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register({ width: 1920, height: 1080, settings: { errorCapture: 'disabled', handleDisabledFileLoadingAsSuccess: true } });

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
	// All callers define new own properties, whose enumerable default is false.
	Object.defineProperty(obj, name, rest);

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

// Measurement and single-pixel contrast sampling stay separate from drawing logs.
const namedColors = {
	black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff',
	lime: '#00ff00', yellow: '#ffff00', cyan: '#00ffff', aqua: '#00ffff',
	magenta: '#ff00ff', fuchsia: '#ff00ff', gray: '#808080', grey: '#808080',
	silver: '#c0c0c0', maroon: '#800000', purple: '#800080', olive: '#808000',
	navy: '#000080', teal: '#008080', orange: '#ffa500', transparent: '#00000000',
	royalblue: '#4169e1', darkorange: '#ff8c00', seagreen: '#2e8b57',
	orchid: '#da70d6', crimson: '#dc143c', lightgray: '#d3d3d3', lightgrey: '#d3d3d3',
};

const axisMeasureHook = Symbol.for('uplot.test.axisMeasure');

globalThis.OffscreenCanvas = class {
	constructor(width, height) {
		this.width = width;
		this.height = height;
		const pixel = new Uint8ClampedArray(4);
		const style = document.createElement('span').style;
		this.ctx = {
			canvas: this,
			font: '10px sans-serif',
			fillStyle: '#000000',
			measureText(text) {
				// Cached contexts must observe the current test's hook, not their creator's.
				globalThis[axisMeasureHook]?.({ text: String(text), font: this.font, ctx: this });
				const size = parseFloat(this.font.match(/([\d.]+)px\b/)?.[1] ?? '10');
				return { width: String(text).length * size / 2, actualBoundingBoxAscent: size * .8, actualBoundingBoxDescent: size * .2 };
			},
			clearRect() {
				pixel.fill(0);
			},
			fillRect() {
				style.color = '';
				style.color = this.fillStyle;
				// Happy DOM normalizes CSS syntax, but leaves named colors as names.
				let color = Object.hasOwn(namedColors, style.color) ? namedColors[style.color] : style.color;
				if (/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(color)) {
					color = color.slice(1);
					if (color.length <= 4)
						color = [...color].map(c => c + c).join('');
					pixel.set([0, 0, 0, 255]);
					pixel.set(color.match(/../g).map(c => parseInt(c, 16)));
				}
				else if (/^rgba?\(/.test(color)) {
					const channels = color.match(/[\d.]+%?/g);
					pixel.set(channels.slice(0, 3).map(c => Math.round(parseFloat(c) * (c.endsWith('%') ? 255 / 100 : 1))));
					const alpha = channels[3] ?? '1';
					pixel[3] = Math.round(parseFloat(alpha) * (alpha.endsWith('%') ? 255 / 100 : 255));
				}
				else
					throw new Error(`Unsupported OffscreenCanvas mock color: ${this.fillStyle}`);
			},
			getImageData() {
				return { data: pixel.slice() };
			},
		};
	}
	getContext(type) {
		return type === '2d' ? this.ctx : null;
	}
};

const CanProto = HTMLCanvasElement.prototype;
const widthProp = Object.getOwnPropertyDescriptor(CanProto, 'width');
const heightProp = Object.getOwnPropertyDescriptor(CanProto, 'height');

CanProto.getContext = function() {
	if (this.ctx != null)
		return this.ctx;

	const mock = getMock(
		['clearRect', 'fillText', 'translate', 'rotate', 'setLineDash', 'beginPath', 'moveTo', 'lineTo', 'bezierCurveTo', 'quadraticCurveTo', 'stroke', 'fill', 'save', 'restore', 'clip', 'fillRect', 'rect', 'arc', 'arcTo'],
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
