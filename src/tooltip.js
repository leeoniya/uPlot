export function createTooltip(self, options) {
	const {gap} = options;
	let node, observer;
	let width = 0, height = 0;

	function update(rect) {
		if (node == null)
			return;

		rect ??= self.rect;
		const {left, top} = self.cursor;
		const x = rect.left + left;
		const y = rect.top + top;
		const viewportWidth = document.documentElement.clientWidth;
		const viewportHeight = document.documentElement.clientHeight;
		const visible = self.tooltip.order.length > 0 && self.tooltip.idxs.some(idx => idx != null)
			&& left >= 0 && top >= 0 && left <= rect.width && top <= rect.height
			&& x >= 0 && y >= 0 && x <= viewportWidth && y <= viewportHeight;

		node.style.display = visible ? '' : 'none';

		if (visible) {
			const tx = x + width + gap > viewportWidth ? x - width - gap : x + gap;
			const ty = y + height + gap > viewportHeight ? y - height - gap : y + gap;
			node.style.transform = `translate(${tx}px, ${ty}px)`;
		}
	}

	// Core passes the refreshed rect to update, without reentering its rect getter.
	const syncRect = () => self.syncRect();

	return {
		mount(u, el) {
			node = el;
			node.classList.add('u-tooltip');
			self.over.appendChild(node);
			window.addEventListener('scroll', syncRect, true);
			window.addEventListener('resize', syncRect);
			observer = new ResizeObserver(([entry]) => {
				const {inlineSize, blockSize} = entry.borderBoxSize[0];
				// Hidden tables report zero; retain their last visible size.
				if (inlineSize > 0 && blockSize > 0) {
					width = inlineSize;
					height = blockSize;
					update();
				}
			});
			observer.observe(node, {box: 'border-box'});
			update();
		},
		update,
		destroy() {
			observer?.disconnect();
			window.removeEventListener('scroll', syncRect, true);
			window.removeEventListener('resize', syncRect);
			node = observer = null;
		},
	};
}
