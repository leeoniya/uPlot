function pointWithin(px, py, rlft, rtop, rrgt, rbtm) {
    return px >= rlft && px <= rrgt && py >= rtop && py <= rbtm;
}

!(function(global) {
	const MAX_OBJECTS = 10;
	const MAX_LEVELS  = 4;

	function Quadtree(x, y, w, h, l) {
		let t = this;

		t.x = x;
		t.y = y;
		t.w = w;
		t.h = h;
		t.l = l || 0;
		t.o = [];
		t.q = null;
	};

	const proto = {
		split: function() {
			let t = this,
				x = t.x,
				y = t.y,
				w = t.w / 2,
				h = t.h / 2,
				l = t.l + 1;

			t.q = [
				// top right
				new Quadtree(x + w, y,     w, h, l),
				// top left
				new Quadtree(x,     y,     w, h, l),
				// bottom left
				new Quadtree(x,     y + h, w, h, l),
				// bottom right
				new Quadtree(x + w, y + h, w, h, l),
			];
		},

		// invokes callback with index of each overlapping quad
		quads: function(x, y, w, h, cb) {
			let t            = this,
				q            = t.q,
				hzMid        = t.x + t.w / 2,
				vtMid        = t.y + t.h / 2,
				startIsNorth = y     < vtMid,
				startIsWest  = x     < hzMid,
				endIsEast    = x + w > hzMid,
				endIsSouth   = y + h > vtMid;

			// top-right quad
			startIsNorth && endIsEast && cb(q[0]);
			// top-left quad
			startIsWest && startIsNorth && cb(q[1]);
			// bottom-left quad
			startIsWest && endIsSouth && cb(q[2]);
			// bottom-right quad
			endIsEast && endIsSouth && cb(q[3]);
		},

		add: function(o) {
			let t = this;

			if (t.q != null) {
				t.quads(o.x, o.y, o.w, o.h, q => {
					q.add(o);
				});
			}
			else {
				let os = t.o;

				os.push(o);

				if (os.length > MAX_OBJECTS && t.l < MAX_LEVELS) {
					t.split();

					for (let i = 0; i < os.length; i++) {
						let oi = os[i];

						t.quads(oi.x, oi.y, oi.w, oi.h, q => {
							q.add(oi);
						});
					}

					t.o.length = 0;
				}
			}
		},

		get: function(x, y, w, h, cb) {
			let t = this;
			let os = t.o;

			for (let i = 0; i < os.length; i++)
				cb(os[i]);

			if (t.q != null) {
				t.quads(x, y, w, h, q => {
					q.get(x, y, w, h, cb);
				});
			}
		},

		clear: function() {
			this.o.length = 0;
			this.q = null;
		},
	};

	Object.assign(Quadtree.prototype, proto);

	global.Quadtree = Quadtree;
})(this);