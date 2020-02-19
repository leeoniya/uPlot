import {
	WIDTH,
	HEIGHT,
	firstChild,
	createElement,
	classList,
} from './strings';

import {
	round,
} from './utils';

export const rAF = requestAnimationFrame;
export const doc = document;
export const win = window;
export const pxRatio = devicePixelRatio;

export function addClass(el, c) {
	c != null && el[classList].add(c);
}

export function remClass(el, c) {
	el[classList].remove(c);
}

export function setStylePx(el, name, value) {
	el.style[name] = value + "px";
}

export function placeTag(tag, cls, targ) {
	let el = doc[createElement](tag);

	if (cls != null)
		addClass(el, cls);

	if (targ != null)
		targ.appendChild(el);

	return el;
}

export function placeDiv(cls, targ) {
	return placeTag("div", cls, targ);
}

export function trans(el, xPos, yPos) {
	el.style.transform = "translate(" + xPos + "px," + yPos + "px)";
}

const evOpts = {passive: true};

export function on(ev, el, cb) {
	el.addEventListener(ev, cb, evOpts);
}

export function off(ev, el, cb) {
	el.removeEventListener(ev, cb, evOpts);
}