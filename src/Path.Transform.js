L.LineUtil.pointOnLine = function(start, final, distPx) {
  var ratio = 1 + distPx / start.distanceTo(final);
  return new L.Point(
    start.x + (final.x - start.x) * ratio,
    start.y + (final.y - start.y) * ratio
  );
};


L.Handler.PathTransform = L.Handler.extend({


  options: {
    rotation: true,
    scaling:  true,

    handlerOptions: {
      radius:      5,
      fillColor:   '#fff',
      color:       '#555',
      fillOpacity: 1
    },

    boundsOptions: {
      weight:    1,
      opacity:   1,
      dashArray: [3, 3],
      fill:      false
    },

    rotateHandleOptions: {
      weight: 1,
      opacity: 1
    },

    edgesCount:   4,
    handleLength: 20
  },


  initialize: function(path) {
    // references
    this._path = path;
    this._map  = null;

    // handlers
    this._activeMarker   = null;
    this._originMarker   = null;
    this._rotationMarker = null;

    // origins & temporary state
    this._rotationOrigin = null;
    this._scaleOrigin    = null;
    this._angle          = 0;
    this._scale          = L.point(1, 1);
    this._initialDist    = 0;
    this._rotationStart  = null;

    // preview and transform matrix
    this._matrix          = new L.Matrix(1, 0, 0, 1, 0, 0);
    this._projectedMatrix = new L.Matrix(1, 0, 0, 1, 0, 0);

    // ui elements
    this._handlersGroup  = null;
    this._rect         = null;
    this._handlers       = [];
    this._handleLine     = null;
  },


  enable: function() {
    if (this._path._map) {
      this._map = this._path._map;
      L.Handler.prototype.enable.call(this);
    }
  },


  addHooks: function() {
    this._createHandlers();
    this._path
      .on('dragstart', this._onDragStart, this)
      .on('dragend',   this._onDragEnd, this);
  },


  removeHooks: function() {
    this._hideHandlers();
  },


  /**
   * @return {} [description]
   */
  _update: function() {
    var matrix = this._matrix;

    // update handlers
    for (var i = 0, len = this._handlers.length; i < len; i++) {
      var handler = this._handlers[i];
      if (handler !== this._originMarker) {
        handler._point = matrix.transform(handler._initialPoint);
        handler._updatePath();
      }
    }

    matrix = matrix.clone().flip();

    this._path._applyTransform(matrix._matrix);
    this._rect._applyTransform(matrix._matrix);

    if (this.options.rotation) {
      this._handleLine._applyTransform(matrix._matrix);
    }
  },


  _apply: function() {
    console.log('apply transform');

    var map = this._map;

    L.circleMarker(this._getRotationOrigin(), { color: 'red' }).addTo(this._map);
    this._transformGeometries();

    // update handlers
    for (var i = 0, len = this._handlers.length; i < len; i++) {
      var handler = this._handlers[i];
      handler._latlng = map.layerPointToLatLng(handler._point);
      delete handler._initialPoint;
      handler.redraw();
    }

    this._matrix = L.matrix(1, 0, 0, 1, 0, 0);
    this._scale  = L.point(1, 1);
    this._angle  = 0;

    map.dragging.enable();
  },


  /**
   * Transform geometries separately
   */
  _transformGeometries: function() {
    var origin = this._origin;
    this._path._resetTransform();
    this._rect._resetTransform();

    this._transformPoints(this._path, this._matrix, origin);
    this._transformPoints(this._rect, this._matrix, origin);

    if (this.options.rotation) {
      this._handleLine._resetTransform();
      this._transformPoints(this._handleLine, this._matrix, origin);
    }
  },


  /**
   * @inheritDoc
   */
  _getProjectedMatrix: function(matrix, originPoint) {
    var map = this._map;
    var zoom = map.getMaxZoom();
    var matrix = L.matrix(1, 0, 0, 1, 0, 0);
    var origin;

    if (this._angle) {
      origin = map.project(this._rotationOriginLatLng, zoom);
      matrix = matrix.rotate(this._angle, origin).flip();
    }

    if (!(this._scale.x === 1 && this._scale.y === 1)) {
      origin = map.project(this._scaleOrigin, zoom);
      matrix = matrix
        ._add(L.matrix(1, 0, 0, 1, origin.x, origin.y))
        ._add(L.matrix(this._scale.x, 0, 0, this._scale.y, 0, 0))
        ._add(L.matrix(1, 0, 0, 1, -origin.x, -origin.y))
    }

    return matrix;
  },


  /**
   * @param  {L.LatLng} latlng
   * @param  {L.Matrix} matrix
   * @param  {L.Map}    map
   * @param  {Number}   zoom
   * @return {L.LatLng}
   */
  _transformPoint: function(latlng, matrix, map, zoom) {
    return map.unproject(matrix.transform(
      map.project(latlng, zoom)), zoom);
  },


  /**
   * Applies transformation, does it in one sweep for performance,
   * so don't be surprised about the code repetition.
   *
   * @param {L.Path}   path
   * @param {L.Matrix} matrix
   */
  _transformPoints: function(path, matrix, origin) {
    var map = path._map;
    var zoom = map.getMaxZoom();
    var i, len;

    var projectedMatrix = this._projectedMatrix = this._getProjectedMatrix();
    console.log(this._projectedMatrix._matrix);

    // console.time('transform');

    // all shifts are in-place
    if (path._point) { // L.Circle
      path._latlng = this._transformPoint(
        path._latlng, projectedMatrix, map, zoom);
    } else if (path._originalPoints) { // everything else
      for (i = 0, len = path._originalPoints.length; i < len; i++) {
        path._latlngs[i] = this._transformPoint(
          path._latlngs[i], projectedMatrix, map, zoom);
      }
    }

    // holes operations
    if (path._holes) {
      for (i = 0, len = path._holes.length; i < len; i++) {
        for (var j = 0, len2 = path._holes[i].length; j < len2; j++) {
          path._holes[i][j] = this._transformPoint(
            path._holes[i][j], projectedMatrix, map, zoom);
        }
      }
    }

    path.projectLatlngs();
    path._updatePath();

    //console.timeEnd('transform');
  },


  _transformHandlers: function() {
    // transform bounds and control points
    console.log('transform handlers');
  },


  _createHandlers: function() {
    console.log('create handlers');
    var map = this._map;
    this._handlersGroup = this._handlersGroup ||
                          new L.LayerGroup().addTo(map);
    this._rect = this._rect ||
                   this._getBoundingPolygon().addTo(this._handlersGroup);

    if (this.options.scaling) {
      this._handlers = [];
      for (var i = 0; i < this.options.edgesCount; i++) {
        // TODO: add stretching
        this._handlers.push(
          this._createHandler(this._rect._latlngs[i], i * 2, i)
          .addTo(this._handlersGroup));
      }
    }

    // add bounds
    if (this.options.rotation) {
      //add rotation handler
      this._createRotationHandlers();
    }
  },


  _createRotationHandlers: function() {
    var map     = this._map;
    var latlngs = this._rect._latlngs

    var bottom = new L.LatLng(
      latlngs[0].lat, (latlngs[0].lng + latlngs[3].lng) / 2);
    var top    = new L.LatLng(
      latlngs[1].lat, (latlngs[1].lng + latlngs[2].lng) / 2);

    var handlerPosition = map.layerPointToLatLng(
      L.LineUtil.pointOnLine(
        map.latLngToLayerPoint(bottom),
        map.latLngToLayerPoint(top),
        this.options.handleLength)
    );

    this._handleLine = new L.Polyline([top, handlerPosition],
      this.options.rotateHandleOptions).addTo(this._handlersGroup);
    this._rotationMarker = new L.CircleMarker(handlerPosition,
      this.options.handlerOptions)
      .addTo(this._handlersGroup)
      .on('mousedown', this._onRotateStart, this);

    this._rotationOriginLatLng = new L.LatLng(
      (top.lat + bottom.lat) / 2,
      (top.lng + bottom.lng) / 2
    );

    this._handlers.push(this._rotationMarker);
  },


  _getRotationOrigin: function() {
    var latlngs = this._rect._latlngs;
    var lb = latlngs[0];
    var rt = latlngs[2];

    return new L.LatLng(
      (lb.lat + rt.lat) / 2,
      (lb.lng + rt.lng) / 2
    );
  },


  _onRotateStart: function(evt) {
    var map = this._map;

    this._originMarker   = null;
    this._rotationOrigin = map.latLngToLayerPoint(this._getRotationOrigin());
    this._rotationStart  = evt.layerPoint;
    this._initialMatrix  = this._matrix.clone();

    this._angle = 0;
    this._path._map
      .on('mousemove', this._onRotate,     this)
      .on('mouseup',   this._onRotateEnd, this);

    this._cachePoints();
  },


  _onRotate: function(evt) {
    var pos = evt.layerPoint;
    var previous = this._rotationStart;
    var origin   = this._rotationOrigin;

    // rotation step angle
    this._angle = Math.atan2(pos.y - origin.y, pos.x - origin.x) -
                  Math.atan2(previous.y - origin.y, previous.x - origin.x);

    this._matrix = this._initialMatrix
      .clone()
      .rotate(this._angle, origin)
      .flip();

    this._update();
  },


  _onRotateEnd: function(evt) {
    this._path._map
      .off('mousemove', this._onRotate, this)
      .off('mouseup',   this._onRotateEnd, this);

    this._apply();
  },


  /**
   * @param  {Event} evt
   */
  _onScaleStart: function(evt) {
    var marker = evt.target;
    var map = this._map;

    map.dragging.disable();

    this._activeMarker = marker;

    this._originMarker = this._handlers[(marker.options.index + 2) % 4];
    this._scaleOrigin  = this._originMarker.getLatLng();

    this._initialMatrix = this._matrix.clone();
    this._cachePoints();

    this._map
      .on('mousemove', this._onScale,    this)
      .on('mouseup',   this._onScaleEnd, this);
    this._initialDist = this._originMarker._point
      .distanceTo(this._activeMarker._point);
  },


  _onScale: function(evt) {
    var originPoint = this._originMarker._point;
    var ratio = originPoint.distanceTo(evt.layerPoint) / this._initialDist;

    this._scale = new L.Point(ratio, ratio);

    // update matrix
    this._matrix = this._initialMatrix
      .clone()
      .scale(ratio, originPoint);

    this._update();
  },


  _onScaleEnd: function(evt) {
    this._map
      .off('mousemove', this._onScale,    this)
      .off('mouseup',   this._onScaleEnd, this);

    this._apply();
  },


  _cachePoints: function() {
    this._handlersGroup.eachLayer(function(layer) {
      layer.bringToFront();
    });
    for (var i = 0, len = this._handlers.length; i < len; i++) {
      var handler = this._handlers[i];
      handler._initialPoint = handler._point.clone();
    }
  },


  /**
   * Bounding polygon
   * @return {L.Polygon}
   */
  _getBoundingPolygon: function() {
    var bounds = this._path.getBounds();
    return new L.Rectangle(bounds, this.options.boundsOptions);
  },


  /**
   * Create corner marker
   * @param  {L.LatLng} latlng
   * @param  {Number}   type one of L.Handler.PathScale.HandlerTypes
   * @param  {Number}   index
   * @return {L.CircleMarker}
   */
  _createHandler: function(latlng, type, index) {
    var marker = new L.CircleMarker(latlng,
      L.Util.extend(this.options.handlerOptions, {
        type: type,
        index: index
      })
    );

    marker.on('mousedown', this._onScaleStart, this);
    return marker;
  },


  _hideHandlers: function() {

  },


  _onDragStart: function() {

  },


  _onDragEnd: function() {

  }


});

L.Path.addInitHook(function() {
  if (this.options.transform) {
    this.transform = new L.Handler.PathTransform(this, this.options.transform);
  }
});