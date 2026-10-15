// Source: https://github.com/leeoniya/flatbush/blob/leeoniya/smol/dist/flatbush.js
// ISC license; see flatbush.LICENSE.
/*! Adapted from flatqueue. Copyright (c) 2025, Volodymyr Agafonkin. ISC license; see flatbush.LICENSE. */

class Queue {
    /** @type {number[]} */
    #ids = [];
    /** @type {number[]} */
    #values = [];
    #length = 0;

    get length() {
        return this.#length;
    }

    clear() {
        this.#length = 0;
    }

    /**
     * @param {number} id
     * @param {number} value
     */
    push(id, value) {
        const ids = this.#ids;
        const values = this.#values;
        let pos = this.#length++;
        while (pos > 0) {
            const parent = (pos - 1) >> 1;
            const parentValue = values[parent];
            if (value >= parentValue) break;
            ids[pos] = ids[parent];
            values[pos] = parentValue;
            pos = parent;
        }
        ids[pos] = id;
        values[pos] = value;
    }

    pop() {
        if (this.#length === 0) return undefined;
        const ids = this.#ids;
        const values = this.#values;
        const top = ids[0];
        const last = --this.#length;
        if (last > 0) {
            const id = ids[last];
            const value = values[last];
            const half = last >> 1;
            let pos = 0;

            while (pos < half) {
                const left = (pos << 1) + 1;
                const right = left + 1;
                // Select the smaller child without a data-dependent branch.
                const child = left + (+(right < last) & +(values[right] < values[left]));
                if (values[child] >= value) break;
                ids[pos] = ids[child];
                values[pos] = values[child];
                pos = child;
            }

            ids[pos] = id;
            values[pos] = value;
        }
        return top;
    }
}

/** @typedef {Int8ArrayConstructor | Uint8ArrayConstructor | Uint8ClampedArrayConstructor | Int16ArrayConstructor | Uint16ArrayConstructor | Int32ArrayConstructor | Uint32ArrayConstructor | Float32ArrayConstructor | Float64ArrayConstructor} TypedArrayConstructor */
/** @typedef {Int8Array | Uint8Array | Uint8ClampedArray | Int16Array | Uint16Array | Int32Array | Uint32Array | Float32Array | Float64Array} TypedArray */

class Flatbush {

    /** @type {TypedArray} */
    #boxes;
    /** @type {Uint16Array | Uint32Array} */
    #indices;
    /** @type {number[]} */
    #levelBounds;
    #pos = 0;
    #queue = new Queue();

    /**
     * Create a Flatbush index that will hold a given number of items.
     * @param {number} numItems
     * @param {number} [nodeSize=16] Size of the tree node (16 by default).
     * @param {TypedArrayConstructor} [ArrayType=Float64Array] The array type used for coordinates storage (`Float64Array` by default).
     */
    constructor(numItems, nodeSize = 16, ArrayType = Float64Array) {
        this.numItems = numItems;
        this.nodeSize = nodeSize;

        // calculate the total number of nodes in the R-tree to allocate space for
        // and the index of each tree level (used in search later)
        let n = numItems;
        let numNodes = n;
        this.#levelBounds = [n * 4];
        do {
            n = Math.ceil(n / this.nodeSize);
            numNodes += n;
            this.#levelBounds.push(numNodes * 4);
        } while (n > 1);

        this.ArrayType = ArrayType;
        this.IndexArrayType = numNodes < 16384 ? Uint16Array : Uint32Array;

        this.#boxes = new ArrayType(numNodes * 4);
        this.#indices = new this.IndexArrayType(numNodes);
        this.minX = Infinity;
        this.minY = Infinity;
        this.maxX = -Infinity;
        this.maxY = -Infinity;
    }

    /**
     * Add a given rectangle to the index.
     * @param {number} minX
     * @param {number} minY
     * @param {number} maxX
     * @param {number} maxY
     * @returns {number} A zero-based, incremental number that represents the newly added rectangle.
     */
    add(minX, minY, maxX = minX, maxY = minY) {
        const pos = this.#pos;
        const index = pos >> 2;
        const boxes = this.#boxes;
        this.#indices[index] = index;
        boxes[pos] = minX;
        boxes[pos + 1] = minY;
        boxes[pos + 2] = maxX;
        boxes[pos + 3] = maxY;
        this.#pos = pos + 4;

        if (minX < this.minX) this.minX = minX;
        if (minY < this.minY) this.minY = minY;
        if (maxX > this.maxX) this.maxX = maxX;
        if (maxY > this.maxY) this.maxY = maxY;

        return index;
    }

    /** Perform indexing of the added rectangles. */
    finish() {
        const boxes = this.#boxes;

        if (this.numItems <= this.nodeSize) {
            // only one node, skip sorting and just fill the root box
            boxes[this.#pos++] = this.minX;
            boxes[this.#pos++] = this.minY;
            boxes[this.#pos++] = this.maxX;
            boxes[this.#pos++] = this.maxY;
            return;
        }

        const {numItems, minX, minY, nodeSize} = this;
        const indices = this.#indices;
        const levelBounds = this.#levelBounds;
        const width = (this.maxX - minX) || 1;
        const height = (this.maxY - minY) || 1;
        const hilbertValues = new Int32Array(numItems);
        const hilbertMax = (1 << 16) - 1;
        const sx = hilbertMax / width;
        const sy = hilbertMax / height;

        // map item centers into Hilbert coordinate space and calculate Hilbert values
        for (let i = 0, pos = 0; i < numItems; i++) {
            const itemMinX = boxes[pos++];
            const itemMinY = boxes[pos++];
            const itemMaxX = boxes[pos++];
            const itemMaxY = boxes[pos++];
            const x = (sx * ((itemMinX + itemMaxX) / 2 - minX)) | 0;
            const y = (sy * ((itemMinY + itemMaxY) / 2 - minY)) | 0;
            hilbertValues[i] = hilbert(x, y);
        }

        // sort items by their Hilbert value (for packing later)
        sort(hilbertValues, boxes, indices, 0, numItems - 1, nodeSize);

        // generate nodes at each tree level, bottom-up
        let pos = numItems * 4;
        for (let i = 0, readPos = 0; i < levelBounds.length - 1; i++) {
            const end = levelBounds[i];

            // generate a parent node for each block of consecutive <nodeSize> nodes
            while (readPos < end) {
                const nodeIndex = readPos;

                // calculate bbox for the new node
                let nodeMinX = boxes[readPos++];
                let nodeMinY = boxes[readPos++];
                let nodeMaxX = boxes[readPos++];
                let nodeMaxY = boxes[readPos++];
                for (let j = 1; j < nodeSize && readPos < end; j++) {
                    nodeMinX = Math.min(nodeMinX, boxes[readPos++]);
                    nodeMinY = Math.min(nodeMinY, boxes[readPos++]);
                    nodeMaxX = Math.max(nodeMaxX, boxes[readPos++]);
                    nodeMaxY = Math.max(nodeMaxY, boxes[readPos++]);
                }

                // add the new node to the tree data
                indices[pos >> 2] = nodeIndex;
                boxes[pos++] = nodeMinX;
                boxes[pos++] = nodeMinY;
                boxes[pos++] = nodeMaxX;
                boxes[pos++] = nodeMaxY;
            }
        }
        this.#pos = pos;
    }

    /**
     * Search the index by a bounding box.
     * @param {number} minX
     * @param {number} minY
     * @param {number} maxX
     * @param {number} maxY
     * @param {(index: number, x0: number, y0: number, x1: number, y1: number) => boolean} [filterFn] An optional function that is called on every found item; if supplied, only items for which this function returns true will be included in the results array.
     * @returns {number[]} An array of indices of items intersecting or touching the given bounding box.
     */
    search(minX, minY, maxX, maxY, filterFn) {
        const {nodeSize} = this;
        const boxes = this.#boxes;
        const levelBounds = this.#levelBounds;
        const indices = this.#indices;
        const numItems4 = this.numItems * 4;

        /** @type number | undefined */
        let nodeIndex = boxes.length - 4;
        let level = levelBounds.length - 1; // start at the root level
        const q = [];
        const results = [];

        let contained = false; // whether the current node's bbox is fully inside the query

        while (nodeIndex !== undefined) {
            // find the end index of the node, capped at the level boundary
            const end = Math.min(nodeIndex + nodeSize * 4, levelBounds[level]);
            const isNode = nodeIndex >= numItems4;

            if (contained) {
                this.#collectContained(nodeIndex, end, level, numItems4, results, filterFn);

            } else {
                // search through child nodes
                for (let /** @type {number} */ pos = nodeIndex; pos < end; pos += 4) {
                    // check if node bbox intersects with query bbox
                    const x0 = boxes[pos];
                    if (maxX < x0) continue;
                    const y0 = boxes[pos + 1];
                    if (maxY < y0) continue;
                    const x1 = boxes[pos + 2];
                    if (minX > x1) continue;
                    const y1 = boxes[pos + 3];
                    if (minY > y1) continue;

                    const index = indices[pos >> 2] | 0;

                    if (isNode) {
                        // node intersects; flag it as contained if its bbox is fully inside the query
                        const c = +(minX <= x0 && minY <= y0 && maxX >= x1 && maxY >= y1);
                        q.push(index | c, level - 1); // node; add it and its level to the search queue

                    } else if (filterFn === undefined || filterFn(index, x0, y0, x1, y1)) {
                        results.push(index); // leaf item
                    }
                }
            }

            level = /** @type {number} */ (q.pop());
            nodeIndex = q.pop();
            if (nodeIndex !== undefined) {
                contained = (nodeIndex & 1) === 1;
                nodeIndex &= -2;
            }
        }

        return results;
    }

    /**
     * Collect all leaves of a subtree that's fully inside the query, skipping intersection tests.
     * Because the tree is packed bottom-up, those leaves occupy one contiguous block of the leaf
     * level, so we skip traversal entirely: descend to the first leaf, then sweep the flat range.
     * @param {number} nodeIndex
     * @param {number} end
     * @param {number} level
     * @param {number} numItems4
     * @param {number[]} results
     * @param {((index: number, x0: number, y0: number, x1: number, y1: number) => boolean) | undefined} filterFn
     */
    #collectContained(nodeIndex, end, level, numItems4, results, filterFn) {
        const boxes = this.#boxes;
        const indices = this.#indices;
        let pos = nodeIndex;
        for (let l = level; l > 0; l--) pos = indices[pos >> 2];
        const leafEnd = Math.min(pos + (end - nodeIndex) * this.nodeSize ** level, numItems4);
        if (filterFn === undefined) {
            for (; pos < leafEnd; pos += 4) results.push(indices[pos >> 2] | 0);
        } else {
            for (; pos < leafEnd; pos += 4) {
                const index = indices[pos >> 2] | 0;
                if (filterFn(index, boxes[pos], boxes[pos + 1], boxes[pos + 2], boxes[pos + 3])) results.push(index);
            }
        }
    }

    /**
     * Search items in order of distance from the given point.
     * @param {number} x
     * @param {number} y
     * @param {number} [maxResults=Infinity]
     * @param {number} [maxDistance=Infinity]
     * @param {(index: number) => boolean} [filterFn] An optional function for filtering the results.
     * @returns {number[]} An array of indices of items found.
     */
    neighbors(x, y, maxResults = Infinity, maxDistance = Infinity, filterFn) {
        const {nodeSize} = this;
        const boxes = this.#boxes;
        const levelBounds = this.#levelBounds;
        const indices = this.#indices;
        const q = this.#queue;
        const numItems4 = this.numItems * 4;
        const nodeSize4 = nodeSize * 4;
        const results = [];
        const maxDistSquared = maxDistance * maxDistance;

        // For a single nearest neighbor (maxResults === 1), track the closest leaf seen so far and use
        // it as a tightened distance bound, skipping pushes of nodes/leaves that can't beat it
        const trackNearest = maxResults === 1;
        let bound = maxDistSquared;

        // Tree nodes and leaves share the queue; encode leaves with LSB = 1 so we can tell them
        // apart with `& 1`. Seed with the root node — any priority works since the queue is empty.
        q.push((boxes.length - 4) << 1, 0);

        while (q.length) {
            const top = /** @type {number} */ (q.pop());
            // if the closest queued entry is a leaf, it's the next result in distance order
            if (top & 1) {
                results.push(top >> 1);
                if (results.length === maxResults) break;
                continue;
            }

            const nodeIndex = top >> 1;
            const isLeafLevel = nodeIndex < numItems4;
            const end = Math.min(nodeIndex + nodeSize4, upperBound(nodeIndex, levelBounds));

            for (let pos = nodeIndex; pos < end; pos += 4) {
                const minX = boxes[pos];
                const minY = boxes[pos + 1];
                const maxX = boxes[pos + 2];
                const maxY = boxes[pos + 3];
                const dx = Math.max(Math.max(minX - x, x - maxX), 0);
                const dy = Math.max(Math.max(minY - y, y - maxY), 0);
                const dist = dx * dx + dy * dy;
                if (dist > bound) continue;

                const childIndex = indices[pos >> 2] | 0;
                if (isLeafLevel) {
                    if (filterFn === undefined || filterFn(childIndex)) {
                        q.push((childIndex << 1) | 1, dist); // leaf item (odd id)
                        if (trackNearest && dist < bound) bound = dist; // tighten bound to the closest leaf so far
                    }
                } else {
                    q.push(childIndex << 1, dist); // node (even id)
                }
            }
        }

        q.clear();
        return results;
    }
}

/**
 * Binary search for the first value in the array bigger than the given.
 * @param {number} value
 * @param {number[]} arr
 */
function upperBound(value, arr) {
    let i = 0;
    let j = arr.length - 1;
    while (i < j) {
        const m = (i + j) >> 1;
        if (arr[m] > value) {
            j = m;
        } else {
            i = m + 1;
        }
    }
    return arr[i];
}

/**
 * Custom quicksort that partially sorts bbox data alongside the hilbert values.
 * @param {Int32Array} values
 * @param {TypedArray} boxes
 * @param {Uint16Array | Uint32Array} indices
 * @param {number} left
 * @param {number} right
 * @param {number} nodeSize
 */
function sort(values, boxes, indices, left, right, nodeSize) {
    const stack = [left, right];

    while (stack.length) {
        const r = stack.pop() || 0;
        const l = stack.pop() || 0;

        if (r - l <= nodeSize && Math.floor(l / nodeSize) >= Math.floor(r / nodeSize)) continue;

        const a = values[l];
        const b = values[(l + r) >> 1];
        const c = values[r];
        const pivot = ((a > b) !== (a > c)) ? a :
            ((b < a) !== (b < c)) ? b : c;

        let i = l - 1;
        let j = r + 1;

        while (true) {
            do i++; while (values[i] < pivot);
            do j--; while (values[j] > pivot);
            if (i >= j) break;
            swap(values, boxes, indices, i, j);
        }

        stack.push(l, j, j + 1, r);
    }
}

/**
 * Swap two values and two corresponding boxes.
 * @param {Int32Array} values
 * @param {TypedArray} boxes
 * @param {Uint16Array | Uint32Array} indices
 * @param {number} i
 * @param {number} j
 */
function swap(values, boxes, indices, i, j) {
    const temp = values[i];
    values[i] = values[j];
    values[j] = temp;

    const k = 4 * i;
    const m = 4 * j;

    const a = boxes[k];
    const b = boxes[k + 1];
    const c = boxes[k + 2];
    const d = boxes[k + 3];
    boxes[k] = boxes[m];
    boxes[k + 1] = boxes[m + 1];
    boxes[k + 2] = boxes[m + 2];
    boxes[k + 3] = boxes[m + 3];
    boxes[m] = a;
    boxes[m + 1] = b;
    boxes[m + 2] = c;
    boxes[m + 3] = d;

    const e = indices[i];
    indices[i] = indices[j];
    indices[j] = e;
}

/**
 * Fast Hilbert curve algorithm by http://threadlocalmutex.com/
 * Ported from C++ https://github.com/rawrunprotected/hilbert_curves (public domain)
 * @param {number} x
 * @param {number} y
 */
function hilbert(x, y) {
    let a = x ^ y;
    let b = 0xFFFF ^ a;
    let c = 0xFFFF ^ (x | y);
    let d = x & (y ^ 0xFFFF);

    let A = a | (b >> 1);
    let B = (a >> 1) ^ a;
    let C = c ^ ((c >> 1) ^ (b & (d >> 1)));
    let D = d ^ ((a & (c >> 1)) ^ (d >> 1));

    a = (A & (A >> 2)) ^ (B & (B >> 2));
    b = (A & (B >> 2)) ^ (B & ((A ^ B) >> 2));
    c = C ^ ((A & (C >> 2)) ^ (B & (D >> 2)));
    d = D ^ ((B & (C >> 2)) ^ ((A ^ B) & (D >> 2)));

    A = (a & (a >> 4)) ^ (b & (b >> 4));
    B = (a & (b >> 4)) ^ (b & ((a ^ b) >> 4));
    C = c ^ ((a & (c >> 4)) ^ (b & (d >> 4)));
    D = d ^ ((b & (c >> 4)) ^ ((a ^ b) & (d >> 4)));

    c = C ^ ((A & (C >> 8)) ^ (B & (D >> 8)));
    d = D ^ ((B & (C >> 8)) ^ ((A ^ B) & (D >> 8)));

    c ^= c >> 1;
    d ^= d >> 1;
    a = x ^ y;
    b = d | (0xFFFF ^ (a | c));

    a = (a | (a << 8)) & 0x00FF00FF;
    a = (a | (a << 4)) & 0x0F0F0F0F;
    a = (a | (a << 2)) & 0x33333333;
    a = (a | (a << 1)) & 0x55555555;

    b = (b | (b << 8)) & 0x00FF00FF;
    b = (b | (b << 4)) & 0x0F0F0F0F;
    b = (b | (b << 2)) & 0x33333333;
    b = (b | (b << 1)) & 0x55555555;

    // shift into signed SMI range for performance
    return (((b << 1) | a) >>> 0) - 0x80000000;
}

export { Flatbush as default };
