// entries is an array with unique keys from getKey(entry).
// mount(entry) returns {node, update(entry), destroy()} with one stable root node.
// Each update calls every current instance.update(entry) once, including new instances.
// The list owns root placement and removal. Instances own their root contents.
// before is null (the parent end) or a persistent child that bounds this list.
// Removed keys call instance.destroy() once. Later occurrences mount fresh instances.
// destroy() clears the list and can repeat. Callbacks must not reenter the list.
export function createKeyedList(parent, getKey, mount, before = null) {
	const records = new Map();
	let ordered = [];
	let next = [];

	function remove(record) {
		const { instance } = record;
		const { node } = instance;
		instance.destroy();
		if (node.parentNode === parent)
			parent.removeChild(node);
	}

	function update(entries) {
		for (let i = 0; i < ordered.length; i++)
			ordered[i].active = false;

		for (let i = 0; i < entries.length; i++) {
			const entry = entries[i];
			const key = getKey(entry);
			let record = records.get(key);

			if (record === undefined) {
				record = { key, instance: mount(entry), active: true };
				records.set(key, record);
			}
			else
				record.active = true;

			next[i] = record;
			record.instance.update(entry);
		}
		next.length = entries.length;

		for (let i = 0; i < ordered.length; i++) {
			const record = ordered[i];
			if (!record.active) {
				records.delete(record.key);
				remove(record);
			}
			ordered[i] = null;
		}

		let anchor = before;
		for (let i = next.length - 1; i >= 0; i--) {
			const node = next[i].instance.node;
			if (node.parentNode !== parent || node.nextSibling !== anchor) {
				// Atomic moves preserve focus and other state in connected subtrees.
				if (node.parentNode === parent && node.isConnected && typeof parent.moveBefore === 'function')
					parent.moveBefore(node, anchor);
				else
					parent.insertBefore(node, anchor);
			}
			anchor = node;
		}

		const previous = ordered;
		ordered = next;
		next = previous;
	}

	function destroy() {
		for (let i = 0; i < ordered.length; i++)
			remove(ordered[i]);

		records.clear();
		ordered.length = 0;
		next.length = 0;
	}

	return { update, destroy };
}
