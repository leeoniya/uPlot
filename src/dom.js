import {
	OFF,
} from './domClasses';

import {
	change,
	dppxchange,
} from './strings';

import {
	assign, ifNull,
} from './utils';

export const doc = document;
export const win = window;
export let pxRatio;

let query;

function setPxRatio() {
	let _pxRatio = devicePixelRatio;

	// during print preview, Chrome fires off these dppx queries even without changes
	if (pxRatio != _pxRatio) {
		pxRatio = _pxRatio;

		query && off(change, query, setPxRatio);
		query = matchMedia(`(min-resolution: ${pxRatio - 0.001}dppx) and (max-resolution: ${pxRatio + 0.001}dppx)`);
		on(change, query, setPxRatio);

		win.dispatchEvent(new CustomEvent(dppxchange));
	}
}

export function addClass(el, c) {
	if (c != null) {
		let cl = el.classList;
		!cl.contains(c) && cl.add(c);
	}
}

export function remClass(el, c) {
	let cl = el.classList;
	cl.contains(c) && cl.remove(c);
}

export function setStylePx(el, name, value) {
	el.style[name] = value + "px";
}

export function placeTag(tag, cls, targ, refEl) {
	let el = doc.createElement(tag);

	if (cls != null)
		addClass(el, cls);

	if (targ != null)
		targ.insertBefore(el, refEl);

	return el;
}

export function placeDiv(cls, targ) {
	return placeTag("div", cls, targ);
}

const xformCache = new WeakMap();

export function elTrans(el, xPos, yPos, xMax, yMax) {
	let xform = "translate(" + xPos + "px," + yPos + "px)";
	let xformOld = xformCache.get(el);

	if (xform != xformOld) {
		el.style.transform = xform;
		xformCache.set(el, xform);

		if (xPos < 0 || yPos < 0 || xPos > xMax || yPos > yMax)
			addClass(el, OFF);
		else
			remClass(el, OFF);
	}
}

const colorCache = new WeakMap();

export function elColor(el, background, borderColor) {
	let newColor = background + borderColor;
	let oldColor = colorCache.get(el);

	if (newColor != oldColor) {
		colorCache.set(el, newColor);
		el.style.background = background;
		el.style.borderColor = borderColor;
	}
}

const sizeCache = new WeakMap();

export function elSize(el, newWid, newHgt, centered) {
	let newSize = newWid + "" + newHgt;
	let oldSize = sizeCache.get(el);

	if (newSize != oldSize) {
		sizeCache.set(el, newSize);
		el.style.height = newHgt + "px";
		el.style.width = newWid + "px";
		el.style.marginLeft = centered ? -newWid/2 + "px" : 0;
		el.style.marginTop = centered ? -newHgt/2 + "px" : 0;
	}
}

const evOpts = {passive: true};
const evOpts2 = assign({capture: true}, evOpts);

export function on(ev, el, cb, capt) {
	el.addEventListener(ev, cb, capt ? evOpts2 : evOpts);
}

export function off(ev, el, cb, capt) {
	el.removeEventListener(ev, cb, capt ? evOpts2 : evOpts);
}

setPxRatio();