import {
	OFF,
} from './domClasses';

import {
	assign,
} from './utils';

export const doc = document;
export const win = window;
export const pxRatio = devicePixelRatio;

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

export function trans(el, xPos, yPos, xMax, yMax) {
	el.style.transform = "translate(" + xPos + "px," + yPos + "px)";

	if (xPos < 0 || yPos < 0 || xPos > xMax || yPos > yMax)
		addClass(el, OFF);
	else
		remClass(el, OFF);
}

const evOpts = {passive: true};
const evOpts2 = assign({capture: true}, evOpts);

export function on(ev, el, cb, capt) {
	el.addEventListener(ev, cb, capt ? evOpts2 : evOpts);
}

export function off(ev, el, cb, capt) {
	el.removeEventListener(ev, cb, capt ? evOpts2 : evOpts);
}