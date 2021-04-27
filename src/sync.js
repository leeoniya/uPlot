export const syncs = {};

export function _sync(key, opts) {
	let s = syncs[key];

	if (!s) {
		let clients = [];

		s = {
			key,
			sub(client) {
				clients.push(client);
			},
			unsub(client) {
				clients = clients.filter(c => c != client);
			},
			pub(type, self, x, y, w, h, i) {
				for (let j = 0; j < clients.length; j++)
					clients[j] != self && clients[j].pub(type, self, x, y, w, h, i);
			}
		};

		if (key != null)
			syncs[key] = s;
	}

	return s;
}