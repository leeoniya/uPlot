import {
	OFF,
} from './domClasses';

export const doc = document;
export const win = window;
export const pxRatio = devicePixelRatio;

export function addClass(el, c) {
	c != null && el.classList.add(c);
}

export function remClass(el, c) {
	el.classList.remove(c);
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

export function on(ev, el, cb) {
	el.addEventListener(ev, cb, evOpts);
}

export function off(ev, el, cb) {
	el.removeEventListener(ev, cb, evOpts);
}