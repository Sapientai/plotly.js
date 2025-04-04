'use strict';

var d3 = require('@plotly/d3');

var Registry = require('../../registry');
var Lib = require('../../lib');
var Axes = require('../../plots/cartesian/axes');

var readPaths = require('./draw_newshape/helpers').readPaths;
var displayOutlines = require('./display_outlines');
var drawLabel = require('./display_labels');

var clearOutlineControllers = require('./handle_outline').clearOutlineControllers;

var Color = require('../color');
var Drawing = require('../drawing');
var arrayEditor = require('../../plot_api/plot_template').arrayEditor;

var dragElement = require('../dragelement');
var setCursor = require('../../lib/setcursor');

var constants = require('./constants');
var helpers = require('./helpers');
var getPathString = helpers.getPathString;


// Shapes are stored in gd.layout.shapes, an array of objects
// index can point to one item in this array,
//  or non-numeric to simply add a new one
//  or -1 to modify all existing
// opt can be the full options object, or one key (to be set to value)
//  or undefined to simply redraw
// if opt is blank, val can be 'add' or a full options object to add a new
//  annotation at that point in the array, or 'remove' to delete this one

module.exports = {
    draw: draw,
    drawOne: drawOne,
    eraseActiveShape: eraseActiveShape,
    drawLabel: drawLabel,
};

function draw(gd) {
    var fullLayout = gd._fullLayout;

    // Only deactivate shapes that no longer exist
    if(fullLayout._activeShapeIndex >= 0) {
        var activeShapeExists = false;
        if (fullLayout.shapes) {
            for (var i = 0; i < fullLayout.shapes.length; i++) {
                if (i === fullLayout._activeShapeIndex && fullLayout.shapes[i].visible === true) {
                    activeShapeExists = true;
                    break;
                }
            }
        }
        if (!activeShapeExists) {
            deactivateShape(gd);
        }
    }

    // Remove previous shapes before drawing new in shapes in fullLayout.shapes
    fullLayout._shapeUpperLayer.selectAll('path').remove();
    fullLayout._shapeLowerLayer.selectAll('path').remove();
    fullLayout._shapeUpperLayer.selectAll('text').remove();
    fullLayout._shapeLowerLayer.selectAll('text').remove();

    for(var k in fullLayout._plots) {
        var shapelayer = fullLayout._plots[k].shapelayer;
        if(shapelayer) {
            shapelayer.selectAll('path').remove();
            shapelayer.selectAll('text').remove();
        }
    }

    for(var i = 0; i < fullLayout.shapes.length; i++) {
        if(fullLayout.shapes[i].visible === true) {
            drawOne(gd, i);
        }
    }

    // may need to resurrect this if we put text (LaTeX) in shapes
    // return Plots.previousPromises(gd);

}

function shouldSkipEdits(gd) {
    return !!gd._fullLayout._outlining;
}

function couldHaveActiveShape(gd) {
    // for now keep config.editable: true as it was before shape-drawing PR
    return !gd._context.edits.shapePosition;
}

function drawOne(gd, index) {
    // remove the existing shape if there is one.
    // because indices can change, we need to look in all shape layers
    gd._fullLayout._paperdiv
        .selectAll('.shapelayer [data-index="' + index + '"]')
        .remove();

    // Add this: Clean up outline controllers for this shape
    gd._fullLayout._paperdiv
        .selectAll('.outline-controller[data-index="' + index + '"]')
        .remove();

    var o = helpers.makeShapesOptionsAndPlotinfo(gd, index);
    var options = o.options;
    var plotinfo = o.plotinfo;

    // Handle clear_selection before visibility check
    if(options.clear_selection === true && gd._fullLayout._activeShapeIndex === index) {
        console.log('clearing shape', index);
        deactivateShape(gd);
        // Clean up outline controllers for this index
        gd._fullLayout._paperdiv
            .selectAll('.outline-controller[data-index="' + index + '"]')
            .remove();
        
        // Reset the clear_selection flag after deactivating
        options.clear_selection = false;
        if (gd._fullLayout.shapes[index]) {
            gd._fullLayout.shapes[index].clear_selection = false;
        }
    }

    // this shape is gone - quit now after deleting it
    // TODO: use d3 idioms instead of deleting and redrawing every time
    if(!options._input || options.visible !== true) {
        // Check all shapes when one is removed
        var shapes = gd._fullLayout.shapes || [];
        for (var i = 0; i < shapes.length + 1; i++) {
            if (gd._fullLayout._activeShapeIndex === i) {
                deactivateShape(gd);
                // Clean up outline controllers for all indices
                gd._fullLayout._paperdiv
                    .selectAll('.outline-controller[data-index="' + i + '"]')
                    .remove();
            }
        }
        return;
    }

    if(options.layer === 'above') {
        drawShape(gd._fullLayout._shapeUpperLayer);
    } else if(options.xref === 'paper' || options.yref === 'paper') {
        drawShape(gd._fullLayout._shapeLowerLayer);
    } else if(options.layer === 'between') {
        drawShape(plotinfo.shapelayerBetween);
    } else {
        if(plotinfo._hadPlotinfo) {
            var mainPlot = plotinfo.mainplotinfo || plotinfo;
            drawShape(mainPlot.shapelayer);
        } else {
            // Fall back to _shapeLowerLayer in case the requested subplot doesn't exist.
            // This can happen if you reference the shape to an x / y axis combination
            // that doesn't have any data on it (and layer is below)
            drawShape(gd._fullLayout._shapeLowerLayer);
        }
    }

    function drawShape(shapeLayer) {
        var d = getPathString(gd, options);
        var attrs = {
            'data-index': index,
            'fill-rule': options.fillrule,
            d: d,
            'class': 'shape-path'
        };


        var opacity = options.opacity;
        var fillColor = options.fillcolor;
        var lineColor = options.line.width ? options.line.color : 'rgba(0,0,0,0)';
        var lineWidth = options.line.width;
        var lineDash = options.line.dash;
        if(options.editable === true) {
            // ensure invisible border to activate the shape
            lineWidth = 5;
            lineDash = 'solid';
        }

        var isOpen = d[d.length - 1] !== 'Z';

        var isActiveShape = couldHaveActiveShape(gd) &&
            options.editable && gd._fullLayout._activeShapeIndex === index;

        if(isActiveShape) {
            opacity = gd._fullLayout.activeshape.opacity;
        }

        var shapeGroup = shapeLayer.append('g')
            .classed('shape-group', true)
            .attr({ 'data-index': index });

        var path = shapeGroup.append('path')
            .attr(attrs)
            .style('opacity', opacity)
            .call(Color.stroke, lineColor)
            .call(Color.fill, fillColor)
            .call(Drawing.dashLine, lineDash, lineWidth);

        path.style({
            'cursor': 'pointer',
            'pointer-events': 'all',
            'z-index': '-1'
        });

        // Updated click handler with Dash-compatible structure
        path.node().addEventListener('click', function(evt) {
            
            // First check if we're hovering over a data point
            if (gd._hoverdata) {
                return;
            }

            evt.stopPropagation();
            evt.preventDefault();
            
            // Check if this shape is already active
            var isDeactivating = (index === gd._fullLayout._activeShapeIndex);
            
            // Structure matching Dash's expected format
            if (isDeactivating) {
                var eventData = {
                    points: []
                };
            } else {
                var eventData = {
                    points: [{
                        curveNumber: -1,  // Special number for shapes
                        pointNumber: index,
                        pointIndex: index,
                        data: {
                            shapeId: options.id || `shape-${index}`,
                            type: 'shape'
                        },
                        x: options.x0,
                        y: options.y0,
                        customdata: {
                            type: 'shape',
                            index: index,
                            shapeId: options.id || `shape-${index}`,
                            x0: options.x0,
                            y0: options.y0,
                            x1: options.x1,
                            y1: options.y1,
                            fillcolor: options.fillcolor,
                            selected: !isDeactivating  // true when activating, false when deactivating
                        }
                    }]
                };
            }
            
            
            if (gd && typeof gd.emit === 'function') {
                // Clear any existing hover states
                gd._hoverdata = null;
                if (gd._fullLayout) {
                    gd._fullLayout._hoversubplot = null;
                }
                
                // Emit the click event
                gd.emit('plotly_click', eventData);
            }

            // Handle shape activation/deactivation
            if (isDeactivating) {
                deactivateShape(gd);
            } else {
                gd._fullLayout._activeShapeIndex = index;
                gd._fullLayout._deactivateShape = deactivateShape;
                draw(gd);
            }
            
            return false;
        });

        setClipPath(shapeGroup, gd, options);
        drawLabel(gd, index, options, shapeGroup);

        // Add pointer-events back only when not hovering over data
        gd.on('plotly_unhover', function() {
            path.style('pointer-events', 'all');
        });

        gd.on('plotly_hover', function() {
            path.style('pointer-events', 'none');
        });


        var editHelpers;
        if(isActiveShape || gd._context.edits.shapePosition) editHelpers = arrayEditor(gd.layout, 'shapes', options);

        if(isActiveShape) {
            path.style({
                cursor: 'ew-resize',
            });

            var dragOptions = {
                element: path.node(),
                plotinfo: plotinfo,
                gd: gd,
                editHelpers: editHelpers,
                hasText: options.label.text || options.label.texttemplate,
                isActiveShape: true,
                horizontalOnly: true
            };

            var polygons = readPaths(d, gd);
            // display polygons on the screen
            displayOutlines(polygons, path, dragOptions);
        } else {
            if(gd._context.edits.shapePosition) {
                setupDragElement(gd, path, options, index, shapeLayer, editHelpers, true);
            } else if(options.editable === true) {
                path.style('pointer-events',
                    (isOpen || Color.opacity(fillColor) * opacity <= 0.5) ? 'stroke' : 'all'
                );
            }
        }
    }
}

function setClipPath(shapePath, gd, shapeOptions) {
    // note that for layer="below" the clipAxes can be different from the
    // subplot we're drawing this in. This could cause problems if the shape
    // spans two subplots. See https://github.com/plotly/plotly.js/issues/1452
    //
    // if axis is 'paper' or an axis with " domain" appended, then there is no
    // clip axis
    var clipAxes = (shapeOptions.xref + shapeOptions.yref).replace(/paper/g, '').replace(/[xyz][1-9]* *domain/g, '');

    Drawing.setClipUrl(
        shapePath,
        clipAxes ? 'clip' + gd._fullLayout._uid + clipAxes : null,
        gd
    );
}

function setupDragElement(gd, shapePath, shapeOptions, index, shapeLayer, editHelpers, horizontalOnly) {
    var MINWIDTH = 10;
    var MINHEIGHT = 10;

    var xPixelSized = shapeOptions.xsizemode === 'pixel';
    var yPixelSized = shapeOptions.ysizemode === 'pixel';
    var isLine = shapeOptions.type === 'line';
    var isPath = shapeOptions.type === 'path';

    var modifyItem = editHelpers.modifyItem;

    var x0, y0, x1, y1, xAnchor, yAnchor;
    var n0, s0, w0, e0, optN, optS, optW, optE;
    var pathIn;

    var shapeGroup = d3.select(shapePath.node().parentNode);

    // setup conversion functions
    var xa = Axes.getFromId(gd, shapeOptions.xref);
    var xRefType = Axes.getRefType(shapeOptions.xref);
    var ya = Axes.getFromId(gd, shapeOptions.yref);
    var yRefType = Axes.getRefType(shapeOptions.yref);
    var shiftXStart = shapeOptions.x0shift;
    var shiftXEnd = shapeOptions.x1shift;
    var shiftYStart = shapeOptions.y0shift;
    var shiftYEnd = shapeOptions.y1shift;
    var x2p = function(v, shift) {
        var dataToPixel = helpers.getDataToPixel(gd, xa, shift, false, xRefType);
        return dataToPixel(v);
    };
    var y2p = function(v, shift) {
        var dataToPixel = helpers.getDataToPixel(gd, ya, shift, true, yRefType);
        return dataToPixel(v);
    };
    var p2x = helpers.getPixelToData(gd, xa, false, xRefType);
    var p2y = helpers.getPixelToData(gd, ya, true, yRefType);

    var sensoryElement = obtainSensoryElement();
    var dragOptions = {
        element: sensoryElement.node(),
        gd: gd,
        prepFn: startDrag,
        doneFn: endDrag,
        clickFn: abortDrag
    };
    var dragMode;

    dragElement.init(dragOptions);

    sensoryElement.node().onmousemove = updateDragMode;

    function obtainSensoryElement() {
        return isLine ? createLineDragHandles() : shapePath;
    }

    function createLineDragHandles() {
        var minSensoryWidth = 10;
        var sensoryWidth = Math.max(shapeOptions.line.width, minSensoryWidth);

        // Helper shapes group
        // Note that by setting the `data-index` attr, it is ensured that
        // the helper group is purged in this modules `draw` function
        var g = shapeLayer.append('g')
            .attr('data-index', index)
            .attr('drag-helper', true);

        // Helper path for moving
        g.append('path')
          .attr('d', shapePath.attr('d'))
          .style({
              cursor: 'move',
              'stroke-width': sensoryWidth,
              'stroke-opacity': '0' // ensure not visible
          });

        // Helper circles for resizing
        var circleStyle = {
            'fill-opacity': '0' // ensure not visible
        };
        var circleRadius = Math.max(sensoryWidth / 2, minSensoryWidth);

        g.append('circle')
          .attr({
              'data-line-point': 'start-point',
              cx: xPixelSized ? x2p(shapeOptions.xanchor) + shapeOptions.x0 : x2p(shapeOptions.x0, shiftXStart),
              cy: yPixelSized ? y2p(shapeOptions.yanchor) - shapeOptions.y0 : y2p(shapeOptions.y0, shiftYStart),
              r: circleRadius
          })
          .style(circleStyle)
          .classed('cursor-grab', true);

        g.append('circle')
          .attr({
              'data-line-point': 'end-point',
              cx: xPixelSized ? x2p(shapeOptions.xanchor) + shapeOptions.x1 : x2p(shapeOptions.x1, shiftXEnd),
              cy: yPixelSized ? y2p(shapeOptions.yanchor) - shapeOptions.y1 : y2p(shapeOptions.y1, shiftYEnd),
              r: circleRadius
          })
          .style(circleStyle)
          .classed('cursor-grab', true);

        return g;
    }

    function updateDragMode(evt) {
        if(shouldSkipEdits(gd)) {
            dragMode = null;
            return;
        }

        if(isLine) {
            if(evt.target.tagName === 'path') {
                dragMode = 'move';
                setCursor(shapePath, 'ew-resize');
            } else {
                dragMode = evt.target.attributes['data-line-point'].value === 'start-point' ?
                    'resize-over-start-point' : 'resize-over-end-point';
                setCursor(shapePath, 'ew-resize');
            }
        } else {
            var dragBBox = dragOptions.element.getBoundingClientRect();
            var w = dragBBox.right - dragBBox.left;
            var x = evt.clientX - dragBBox.left;

            if(!isPath && w > MINWIDTH && !evt.shiftKey) {
                var cursor = x < w * 0.25 ? 'w' :
                            x > w * 0.75 ? 'e' : 
                            'ew';
                setCursor(shapePath, cursor + '-resize');
                dragMode = cursor;
            } else {
                setCursor(shapePath, 'ew-resize');
                dragMode = 'move';
            }
        }
    }

    function startDrag(evt) {
        if(shouldSkipEdits(gd)) return;

        // setup update strings and initial values
        if(xPixelSized) {
            xAnchor = x2p(shapeOptions.xanchor);
        }
        if(yPixelSized) {
            yAnchor = y2p(shapeOptions.yanchor);
        }

        if(shapeOptions.type === 'path') {
            pathIn = shapeOptions.path;
        } else {
            x0 = xPixelSized ? shapeOptions.x0 : x2p(shapeOptions.x0);
            y0 = yPixelSized ? shapeOptions.y0 : y2p(shapeOptions.y0);
            x1 = xPixelSized ? shapeOptions.x1 : x2p(shapeOptions.x1);
            y1 = xPixelSized ? shapeOptions.y1 : y2p(shapeOptions.y1);
        }

        if(x0 < x1) {
            w0 = x0;
            optW = 'x0';
            e0 = x1;
            optE = 'x1';
        } else {
            w0 = x1;
            optW = 'x1';
            e0 = x0;
            optE = 'x0';
        }

        // For fixed size shapes take opposing direction of y-axis into account.
        // Hint: For data sized shapes this is done by the y2p function.
        if((!yPixelSized && y0 < y1) || (yPixelSized && y0 > y1)) {
            n0 = y0;
            optN = 'y0';
            s0 = y1;
            optS = 'y1';
        } else {
            n0 = y1;
            optN = 'y1';
            s0 = y0;
            optS = 'y0';
        }

        // setup dragMode and the corresponding handler
        updateDragMode(evt);
        renderVisualCues(shapeLayer, shapeOptions);
        deactivateClipPathTemporarily(shapePath, shapeOptions, gd);
        dragOptions.moveFn = (dragMode === 'move') ? moveShape : resizeShape;
        dragOptions.altKey = evt.altKey;
    }

    function endDrag() {
        if(shouldSkipEdits(gd)) return;

        setCursor(shapePath);
        removeVisualCues(shapeLayer);

        // Don't rely on clipPath being activated during re-layout
        setClipPath(shapePath, gd, shapeOptions);
        Registry.call('_guiRelayout', gd, editHelpers.getUpdateObj());
    }

    function abortDrag() {
        if(shouldSkipEdits(gd)) return;

        removeVisualCues(shapeLayer);
    }

    function moveShape(dx, dy) {
        dy = 0;

        if(shapeOptions.type === 'path') {
            var noOp = function(coord) { return coord; };
            var moveX = noOp;
            var moveY = function(y) { return y; };

            if(xPixelSized) {
                modifyItem('xanchor', shapeOptions.xanchor = p2x(xAnchor + dx));
            } else {
                moveX = function moveX(x) { return p2x(x2p(x) + dx); };
                if(xa && xa.type === 'date') moveX = helpers.encodeDate(moveX);
            }

            modifyItem('path', shapeOptions.path = movePath(pathIn, moveX, moveY));
        } else {
            if(xPixelSized) {
                modifyItem('xanchor', shapeOptions.xanchor = p2x(xAnchor + dx));
            } else {
                modifyItem('x0', shapeOptions.x0 = p2x(x0 + dx));
                modifyItem('x1', shapeOptions.x1 = p2x(x1 + dx));
            }
            if(yPixelSized) {
                modifyItem('yanchor', shapeOptions.yanchor);
            } else {
                modifyItem('y0', shapeOptions.y0);
                modifyItem('y1', shapeOptions.y1);
            }
        }

        shapePath.attr('d', getPathString(gd, shapeOptions));
        renderVisualCues(shapeLayer, shapeOptions);
        drawLabel(gd, index, shapeOptions, shapeGroup);
    }

    function resizeShape(dx, dy) {
        dy = 0;

        if(isPath) {
            var noOp = function(coord) { return coord; };
            var moveX = noOp;
            var moveY = function(y) { return y; };

            if(xPixelSized) {
                modifyItem('xanchor', shapeOptions.xanchor = p2x(xAnchor + dx));
            } else {
                moveX = function moveX(x) { return p2x(x2p(x) + dx); };
                if(xa && xa.type === 'date') moveX = helpers.encodeDate(moveX);
            }

            modifyItem('path', shapeOptions.path = movePath(pathIn, moveX, moveY));
        } else if(isLine) {
            if(dragMode === 'resize-over-start-point') {
                modifyItem('x0', shapeOptions.x0 = xPixelSized ? x0 + dx : p2x(x0 + dx));
                modifyItem('y0', shapeOptions.y0);
            } else if(dragMode === 'resize-over-end-point') {
                modifyItem('x1', shapeOptions.x1 = xPixelSized ? x1 + dx : p2x(x1 + dx));
                modifyItem('y1', shapeOptions.y1);
            }
        } else {
            var has = function(str) { return dragMode.indexOf(str) !== -1; };
            var hasW = has('w');
            var hasE = has('e');

            var newW = hasW ? w0 + dx : w0;
            var newE = hasE ? e0 + dx : e0;

            if(newE - newW > MINWIDTH) {
                modifyItem(optW, shapeOptions[optW] = xPixelSized ? newW : p2x(newW));
                modifyItem(optE, shapeOptions[optE] = xPixelSized ? newE : p2x(newE));
            }
            modifyItem(optN, shapeOptions[optN]);
            modifyItem(optS, shapeOptions[optS]);
        }

        shapePath.attr('d', getPathString(gd, shapeOptions));
        renderVisualCues(shapeLayer, shapeOptions);
        drawLabel(gd, index, shapeOptions, shapeGroup);
    }

    function renderVisualCues(shapeLayer, shapeOptions) {
        if(xPixelSized || yPixelSized) {
            renderAnchor();
        }

        function renderAnchor() {
            var isNotPath = shapeOptions.type !== 'path';

            // d3 join with dummy data to satisfy d3 data-binding
            var visualCues = shapeLayer.selectAll('.visual-cue').data([0]);

            // Enter
            var strokeWidth = 1;
            visualCues.enter()
              .append('path')
              .attr({
                  fill: '#fff',
                  'fill-rule': 'evenodd',
                  stroke: '#000',
                  'stroke-width': strokeWidth
              })
              .classed('visual-cue', true);

            // Update
            var posX = x2p(
              xPixelSized ?
                shapeOptions.xanchor :
                Lib.midRange(
                  isNotPath ?
                    [shapeOptions.x0, shapeOptions.x1] :
                    helpers.extractPathCoords(shapeOptions.path, constants.paramIsX))
            );
            var posY = y2p(
              yPixelSized ?
                shapeOptions.yanchor :
                Lib.midRange(
                  isNotPath ?
                    [shapeOptions.y0, shapeOptions.y1] :
                    helpers.extractPathCoords(shapeOptions.path, constants.paramIsY))
            );

            posX = helpers.roundPositionForSharpStrokeRendering(posX, strokeWidth);
            posY = helpers.roundPositionForSharpStrokeRendering(posY, strokeWidth);

            if(xPixelSized && yPixelSized) {
                var crossPath = 'M' + (posX - 1 - strokeWidth) + ',' + (posY - 1 - strokeWidth) +
                  'h-8v2h8 v8h2v-8 h8v-2h-8 v-8h-2 Z';
                visualCues.attr('d', crossPath);
            } else if(xPixelSized) {
                var vBarPath = 'M' + (posX - 1 - strokeWidth) + ',' + (posY - 9 - strokeWidth) +
                  'v18 h2 v-18 Z';
                visualCues.attr('d', vBarPath);
            } else {
                var hBarPath = 'M' + (posX - 9 - strokeWidth) + ',' + (posY - 1 - strokeWidth) +
                  'h18 v2 h-18 Z';
                visualCues.attr('d', hBarPath);
            }
        }
    }

    function removeVisualCues(shapeLayer) {
        shapeLayer.selectAll('.visual-cue').remove();
    }

    function deactivateClipPathTemporarily(shapePath, shapeOptions, gd) {
        var xref = shapeOptions.xref;
        var yref = shapeOptions.yref;
        var xa = Axes.getFromId(gd, xref);
        var ya = Axes.getFromId(gd, yref);

        var clipAxes = '';
        if(xref !== 'paper' && !xa.autorange) clipAxes += xref;
        if(yref !== 'paper' && !ya.autorange) clipAxes += yref;

        Drawing.setClipUrl(
            shapePath,
            clipAxes ? 'clip' + gd._fullLayout._uid + clipAxes : null,
            gd
        );
    }
}

function movePath(pathIn, moveX, moveY) {
    return pathIn.replace(constants.segmentRE, function(segment) {
        var paramNumber = 0;
        var segmentType = segment.charAt(0);
        var xParams = constants.paramIsX[segmentType];
        var yParams = constants.paramIsY[segmentType];
        var nParams = constants.numParams[segmentType];

        var paramString = segment.substr(1).replace(constants.paramRE, function(param) {
            if(paramNumber >= nParams) return param;

            if(xParams[paramNumber]) param = moveX(param);
            else if(yParams[paramNumber]) param = moveY(param);

            paramNumber++;

            return param;
        });

        return segmentType + paramString;
    });
}

function deactivateShape(gd) {
    if(!couldHaveActiveShape(gd)) return;

    var id = gd._fullLayout._activeShapeIndex;
    if(id >= 0) {
        clearOutlineControllers(gd);
        gd._fullLayout._paperdiv.selectAll('.outline-controller').remove();
        delete gd._fullLayout._activeShapeIndex;
        
        // Emit click event with empty points array
        if (gd && typeof gd.emit === 'function') {
            // Clear any existing hover states
            gd._hoverdata = null;
            if (gd._fullLayout) {
                gd._fullLayout._hoversubplot = null;
            }
            
            // Emit the click event with empty points
            gd.emit('plotly_click', {
                points: []
            });
        }
        
        draw(gd);
    }
}

function eraseActiveShape(gd) {
    if(!couldHaveActiveShape(gd)) return;

    clearOutlineControllers(gd);

    var id = gd._fullLayout._activeShapeIndex;
    var shapes = (gd.layout || {}).shapes || [];
    if(id < shapes.length) {
        var list = [];
        for(var q = 0; q < shapes.length; q++) {
            if(q !== id) {
                list.push(shapes[q]);
            }
        }

        delete gd._fullLayout._activeShapeIndex;

        return Registry.call('_guiRelayout', gd, {
            shapes: list
        });
    }
}
