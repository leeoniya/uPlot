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
				for (let i = 0; i < clients.length; i++)
					clients[i] != self && clients[i].pub(type, self, x, y, w, h, i);
			}
		};

		if (key != null)
			syncs[key] = s;
	}

	return s;
}