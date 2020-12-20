/**
 * quadtree-js
 * @version 1.2.3
 * @license MIT
 * @author Timo Hausmann
 */

 /* https://github.com/timohausmann/quadtree-js.git v1.2.3 */

/*
Copyright © 2012-2020 Timo Hausmann

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

;(function() {

    /**
     * Quadtree Constructor
     * @param Object bounds            bounds of the node { x, y, width, height }
     * @param Integer max_objects      (optional) max objects a node can hold before splitting into 4 subnodes (default: 10)
     * @param Integer max_levels       (optional) total max levels inside root Quadtree (default: 4)
     * @param Integer level            (optional) depth level, required for subnodes (default: 0)
     */
    function Quadtree(bounds, max_objects, max_levels, level) {

        this.max_objects    = max_objects || 10;
        this.max_levels     = max_levels || 4;

        this.level  = level || 0;
        this.bounds = bounds;

        this.objects    = [];
        this.nodes      = [];
    };


    /**
     * Split the node into 4 subnodes
     */
    Quadtree.prototype.split = function() {

        var nextLevel   = this.level + 1,
            subWidth    = this.bounds.width/2,
            subHeight   = this.bounds.height/2,
            x           = this.bounds.x,
            y           = this.bounds.y;

        //top right node
        this.nodes[0] = new Quadtree({
            x       : x + subWidth,
            y       : y,
            width   : subWidth,
            height  : subHeight
        }, this.max_objects, this.max_levels, nextLevel);

        //top left node
        this.nodes[1] = new Quadtree({
            x       : x,
            y       : y,
            width   : subWidth,
            height  : subHeight
        }, this.max_objects, this.max_levels, nextLevel);

        //bottom left node
        this.nodes[2] = new Quadtree({
            x       : x,
            y       : y + subHeight,
            width   : subWidth,
            height  : subHeight
        }, this.max_objects, this.max_levels, nextLevel);

        //bottom right node
        this.nodes[3] = new Quadtree({
            x       : x + subWidth,
            y       : y + subHeight,
            width   : subWidth,
            height  : subHeight
        }, this.max_objects, this.max_levels, nextLevel);
    };


    /**
     * Determine which node the object belongs to
     * @param Object pRect      bounds of the area to be checked, with x, y, width, height
     * @return Array            an array of indexes of the intersecting subnodes
     *                          (0-3 = top-right, top-left, bottom-left, bottom-right / ne, nw, sw, se)
     */
    Quadtree.prototype.getIndex = function(pRect, callback) {

        var verticalMidpoint    = this.bounds.x + (this.bounds.width/2),
            horizontalMidpoint  = this.bounds.y + (this.bounds.height/2);

        var startIsNorth = pRect.y < horizontalMidpoint,
            startIsWest  = pRect.x < verticalMidpoint,
            endIsEast    = pRect.x + pRect.width > verticalMidpoint,
            endIsSouth   = pRect.y + pRect.height > horizontalMidpoint;

        //top-right quad
        if(startIsNorth && endIsEast) {
            callback(0);
        }

        //top-left quad
        if(startIsWest && startIsNorth) {
            callback(1);
        }

        //bottom-left quad
        if(startIsWest && endIsSouth) {
            callback(2);
        }

        //bottom-right quad
        if(endIsEast && endIsSouth) {
            callback(3);
        }
    };


    /**
     * Insert the object into the node. If the node
     * exceeds the capacity, it will split and add all
     * objects to their corresponding subnodes.
     * @param Object pRect        bounds of the object to be added { x, y, width, height }
     */
    Quadtree.prototype.insert = function(pRect) {

        var i = 0;

        //if we have subnodes, call insert on matching subnodes
        if(this.nodes.length) {
            this.getIndex(pRect, i => {
                this.nodes[i].insert(pRect);
            });

            return;
        }

        //otherwise, store object here
        this.objects.push(pRect);

        //max_objects reached
        if(this.objects.length > this.max_objects && this.level < this.max_levels) {

            //split if we don't already have subnodes
            if(!this.nodes.length) {
                this.split();
            }

            //add all objects to their corresponding subnode
            for(i=0; i<this.objects.length; i++) {
                this.getIndex(this.objects[i], k => {
                    this.nodes[k].insert(this.objects[i]);
                });
            }

            //clean up this node
            this.objects = [];
        }
     };


    /**
     * Return all objects that could collide with the given object
     * @param Object pRect      bounds of the object to be checked { x, y, width, height }
     * @return Array            array with all detected objects
     */
    Quadtree.prototype.retrieve = function(pRect, cb) {
        for (let i = 0; i < this.objects.length; i++)
            cb(this.objects[i])

        //if we have subnodes, retrieve their objects
        if (this.nodes.length) {
            this.getIndex(pRect, i => {
                this.nodes[i].retrieve(pRect, cb);
            });
        }
    };


    /**
     * Clear the quadtree
     */
    Quadtree.prototype.clear = function() {

        this.objects = [];

        for(var i=0; i < this.nodes.length; i++) {
            if(this.nodes.length) {
                this.nodes[i].clear();
              }
        }

        this.nodes = [];
    };

    //export for commonJS or browser
    if(typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
        module.exports = Quadtree;
    } else {
        window.Quadtree = Quadtree;
    }

})();