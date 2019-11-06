export const syncs = {};

export function _sync(opts) {
	let clients = [];

	return {
		sub(client) {
			clients.push(client);
		},
		unsub(client) {
			clients = clients.filter(c => c != client);
		},
		pub(type, self, x, y, w, h, i) {
			if (clients.length > 1) {
				clients.forEach(client => {
					client != self && client.pub(type, self, x, y, w, h, i);
				});
			}
		}
	};
}