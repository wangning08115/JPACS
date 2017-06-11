/*
 * Depends:
 * 1. jCanvasScript
 * 2. jQuery
 * 3. require.js
 */


define(['jquery', 'jCanvaScript', 'dicomUtil', 'dicom/annObject', 'module'], function (jQuery, jc, dicom, annObject, module) {

	var dicomTag = dicom.dicomTag,
		colors = dicom.colors,
		eventType = dicom.eventType,
		viewContext = dicom.viewContext,
		annType = annObject.annType;
		
	var countDistance = dicom.countDistance,
		imageToScreen = dicom.imageToScreen,
		screenToImage = dicom.screenToImage,
		getSineTheta = dicom.getSineTheta,
		getCosineTheta = dicom.getCosineTheta;
	
    jQuery.fn.onPositionChanged = function (trigger, millis) {
        if (millis == null) millis = 100;
        var o = $(this[0]); // our jquery object
        if (o.length < 1) return o;

        var lastPos = null;
        var lastOff = null;
        setInterval(function () {
            if (o == null || o.length < 1) return o; // abort if element is non existend eny more
            if (lastPos == null) lastPos = o.position();
            if (lastOff == null) lastOff = o.offset();
            var newPos = o.position();
            var newOff = o.offset();
            if (lastPos.top != newPos.top || lastPos.left != newPos.left) {
                $(this).trigger('onPositionChanged', { lastPos: lastPos, newPos: newPos });
                if (typeof (trigger) == "function") trigger(lastPos, newPos);
                lastPos = o.position();
            }
            if (lastOff.top != newOff.top || lastOff.left != newOff.left) {
                $(this).trigger('onOffsetChanged', { lastOff: lastOff, newOff: newOff });
                if (typeof (trigger) == "function") trigger(lastOff, newOff);
                lastOff = o.offset();
            }
        }, millis);

        return o;
    };

    //define enums

    var globalViewerId = 1;

    function newViewerId() {
        globalViewerId++;
        return "viewer_" + globalViewerId;
    }

    var overlaySetting = {
        color: dicom.colors.white,
        font: 'Times New Roman',
        fontSize: 17
    };

    function overlay(tag, pos, prefix) {
        this.group = tag.group;
        this.element = tag.element;
        this.position = pos;
        this.prefix = prefix;
        this.ptStart = { x: 0, y: 0 };
        this.isCreated = false;
        //this.type = annType.overlay;
    }

    overlay.prototype.create = function (viewer) {
        if (this.isCreated) {
            return;
        }

        this.parent = viewer;
        this.id = viewer._newObjectId();

        var fontSize = overlaySetting.fontSize;
        var v1 = Math.floor(this.position / 4);//0,1,2,3
        var v2 = this.position % 4;//0,1,2,3
        var align = 'left';

        if (v1 % 2 == 0) {//left
            this.ptStart.x = 5;
        } else {
            align = 'right';
            this.ptStart.x = viewer.canvas.width - 10;
        }

        if (v1 < 2) {//top
            this.ptStart.y = (v2 + 1) * fontSize;
        } else {
            this.ptStart.y = viewer.canvas.height - (fontSize + (3 - v2) * fontSize);
        }

        var idLbl = this.id + "_ol";
        var font = "{0}px {1}".format(overlaySetting.fontSize, overlaySetting.font);
        jc.text(this.prefix, this.ptStart.x, this.ptStart.y).id(idLbl).layer(viewer.olLayerId).color(colors.white).font(font).align(align);
        this.label = jc('#' + idLbl);

        this.isCreated = true;
    }

    overlay.prototype.updateString = function (value) {
        if (this.label) {
            if (this.prefix) {
                value = this.prefix + ': ' + value;
            }

            this.label.string(value);
        }
    }

    /**********************************
    * the dicomFile clas
    */

    function dicomFile() {
        this.id = undefined;
        this.imgDataUrl = undefined;
        this.imgWidth = 0;
        this.imgHeight = 0;
        this.windowWidth = 0;
        this.windowCenter = 0;
        this.dicomTags = [];
        this.overlayString = '';
        this.annotationString = '';
        this.transformString = '';
    }

    /*********************************
	 * the dicomViewer class
     localWL means whether to calculate WL at the client side, default is undefined (false)
	 */
    function dicomViewer(canvasId, localWL) {
        this.version = 1; //for serialize
        this.id = newViewerId();
        this.canvasId = canvasId;
        this.localWL = !!localWL;

        this.annotationList = [];
        this.overlayList = [];
        this.dicomTagList = [];

        this.isReady = false;
        this.curSelectObj = undefined;

        this.eventHandlers = {};
        this._objectIndex = 0;
        
        this.cursorUrl = "";
    }

    dicomViewer.prototype._newObjectId = function () {
        this._objectIndex++;
        return this.id + "_obj_" + this._objectIndex;
    }

    dicomViewer.prototype.load = function (dcmFile, callBack) {
        this.dicomFile = dcmFile;
        this.imgWidth = dcmFile.imgWidth;
        this.imgHeight = dcmFile.imgHeight;
        this.windowCenter = dcmFile.windowCenter;
        this.windowWidth = dcmFile.windowWidth;
        this.imgDataUrl = dcmFile.imgDataUrl;
        this.dicomTagList = dcmFile.dicomTags;

        var dv = this;
        this.canvas = document.getElementById(dv.canvasId);
        this.canvas.oncontextmenu = function (evt) {
            dv.onContextMenu.call(dv, evt);
        };
        this.canvas.onmousewheel = function (evt) {
            dv.onMouseWheel.call(dv, evt);
        };

        $(this.canvas).on('keyup', function (key) {
            dv.onKeyUp.call(dv, key);
        });

        jc.start(dv.canvasId, true);

        $(this.canvas).onPositionChanged(function () {
            //console.log('canvas pos changed');
            jc.canvas(dv.canvasId).restart();
        });

        this.imgLayerId = this.id + '_imgLayer';
        this.olLayerId = this.id + '_overlayLayer';

        dv.imgLayer = jc.layer(dv.imgLayerId).down('bottom');
        dv.olLayer = jc.layer(dv.olLayerId).up('top');

        //register imglayer events
        dv.imgLayer.mousedown(function (arg) {
            dv.onMouseDown.call(dv, arg)
        });
        dv.imgLayer.mousemove(function (arg) {
            dv.onMouseMove.call(dv, arg)
        });
        dv.imgLayer.mouseup(function (arg) {
            dv.onMouseUp.call(dv, arg)
        });
        dv.imgLayer.click(function (arg) {
            dv.onClick.call(dv, arg)
        });

		this.setContext(viewContext.pan);
		
        this.adjustWL(this.windowWidth, this.windowCenter, function () {
            if (callBack) {
                callBack.call(dv);
            }

            dv.draggable(true);
            dv.isReady = true;

            var strJSON = dcmFile.serializeJSON;
            if (strJSON) {
                this.deSerialize(strJSON);
            } else {
                this.bestFit();
            }
        });
    }

    dicomViewer.prototype.save = function () {
        var dcmFile = {};
        dcmFile.id = this.dicomFile.id;
        dcmFile.version = this.version;
        dcmFile.windowWidth = this.windowWidth;
        dcmFile.windowCenter = this.windowCenter;

        dcmFile.serializeJSON = this.serialize();

        return dcmFile;
    }

    dicomViewer.prototype.adjustWL = function (windowWidth, windowCenter, callback) {
        var dv = this;
        dv._adjustWLCallback = callback;

        if (this.localWL) {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', dv.imgDataUrl, true);
            xhr.responseType = 'arraybuffer';

            xhr.onload = function (e) {
                if (this.status == 200) {
                    //get binary data as a response
                    dv.pixelData = new Uint16Array(this.response);
                    dv._adjustWLLocal(windowWidth, windowCenter);
                } else {
                    alert('failed to get image data');
                }
            };

            xhr.send();
        } else {
            this._getImgPixelData(windowWidth, windowCenter);
        }
    }

    dicomViewer.prototype._requestJpgImg = function (request) {
        var dv = this;

        console.log(new Date().toLocaleTimeString() + ': start request image file,' + request.windowWidth + ',' + request.windowCenter);

        var imgDataUrl = dv.imgDataUrl;
        imgDataUrl += "?windowWidth=" + request.windowWidth + "&windowCenter=" + request.windowCenter;

        var img = new Image();
        img.onload = function () {
            dv._reloadImgWithWL(img, request.windowWidth, request.windowCenter, dv._adjustWLCallback);

            console.log(new Date().toLocaleTimeString() + ':finish load imgData: ' + request.windowWidth + "," + request.windowCenter);
            dv._imgDataWorker.isBusy = false;

            if (dv._imgDataRequest.length > 0) {
                var req = dv._imgDataRequest.pop();

                //console.log('pop request and do it: ' + req.windowWidth + ',' + req.windowCenter);
                dv._requestJpgImg(req);
                dv._imgDataRequest = [];
            }
        }

        img.src = imgDataUrl;
    }

    dicomViewer.prototype._getImgPixelData = function (windowWidth, windowCenter) {
        var dv = this;

        //directly get image data
        if (!dv._helpCanvas) {
            dv._helpCanvas = document.createElement('canvas');
        }

        if (!this._imgDataWorker) {
            this._imgDataWorker = {};
            this._imgDataRequest = [];
            this._imgDataWorker.isBusy = false;
        }

        var request = { 'windowWidth': windowWidth, 'windowCenter': windowCenter, 'imgDataUrl': dv.imgDataUrl };
        if (dv._imgDataWorker.isBusy) {
            console.info('push request: ' + windowWidth + ',' + windowCenter);
            this._imgDataRequest.push(request);
        } else {
            this._requestJpgImg(request);
            dv._imgDataWorker.isBusy = true;
        }
    }

    //with worker
    dicomViewer.prototype._adjustWLFromServer = function (windowWidth, windowCenter) {
        var dv = this;
        if (!this._imgData) {//used to accept the image data
            this._imgData = new Uint8ClampedArray(this.imgWidth * this.imgHeight * 4);
        }
        var worker = this._imgDataWorker;
        if (!this._imgDataWorker) {
            var workerJs;
            var sc = document.getElementsByTagName("script");
            for (idx = 0; idx < sc.length; idx++) {
                s = sc.item(idx);
                if (s.src && s.src.match(/imgDataWorker\.js$/)) {
                    workerJs = s.src;
                    break;
                }
            }

            this._imgDataRequest = [];
            this._imgDataWorker = new Worker(workerJs);
            this._imgDataWorker.isBusy = false;

            this._imgDataWorker.addEventListener('message', function (msg) {
                var grayData = new Uint8ClampedArray(msg.data.grayData);
                var windowWidth = msg.data.windowWidth, windowCenter = msg.data.windowCenter,
                    width = dv.imgWidth, height = dv.imgHeight,
                    success = msg.data.success;
                dv._imgData = grayData;

                if (!success) {
                    console.log('failed to request imgdata.')
                    return;
                }

                if (!window.createImageBitmap) {//IE
                    if (!dv._helpCanvas) {
                        dv._helpCanvas = document.createElement('canvas');
                    }
                    var canvas = dv._helpCanvas;
                    canvas.width = width;
                    canvas.height = height,
                    ctx = canvas.getContext('2d');
                    ctx.clearRect(0, 0, width, height);

                    var imageData = ctx.createImageData(width, height);
                    imageData.data.set(grayData);
                    ctx.putImageData(imageData, 0, 0);

                    dv._reloadImgWithWL(canvas, windowWidth, windowCenter, dv._adjustWLCallback);
                } else {
                    var imageData = new ImageData(grayData, width, height);
                    var a = createImageBitmap(imageData, 0, 0, width, height);

                    Promise.all([createImageBitmap(imageData, 0, 0, width, height)]).then(function (sprites) {
                        var imgBitmap = sprites[0];
                        dv._reloadImgWithWL(imgBitmap, windowWidth, windowCenter, dv._adjustWLCallback);
                    });
                }

                console.log('finish imgData: ' + windowWidth + "," + windowCenter);
                dv._imgDataWorker.isBusy = false;

                if (dv._imgDataRequest.length > 0) {
                    var req = dv._imgDataRequest.pop();
                    req['grayData'] = dv._imgData.buffer;
                    console.log('pop request and do it: ' + req.windowWidth + ',' + req.windowCenter);
                    dv._imgDataWorker.postMessage(req, [dv._imgData.buffer]);
                    dv._imgDataWorker.isBusy = true;

                    dv._imgDataRequest = [];
                }
            }, false);
        }

        var request = { 'windowWidth': windowWidth, 'windowCenter': windowCenter, 'imgDataUrl': dv.imgDataUrl };
        request['grayData'] = dv._imgData.buffer;
        if (this._imgDataWorker.isBusy) {
            console.info('push request: ' + request.windowWidth + ',' + request.windowCenter);
            this._imgDataRequest.push(request);
        } else {
            this._imgDataWorker.postMessage(request, [dv._imgData.buffer]);
            dv._imgDataWorker.isBusy = true;
        }
    }

    //not with worker
    dicomViewer.prototype._adjustWLFromServer2 = function (request) {
        var dv = this;

        console.log(new Date().toLocaleTimeString() + ': start request pixel data,' + request.windowWidth + ',' + request.windowCenter);

        var imgDataUrl = dv.imgDataUrl;
        imgDataUrl += "?windowWidth=" + request.windowWidth + "&windowCenter=" + request.windowCenter;

        var xhr = new XMLHttpRequest();
        xhr.open('GET', imgDataUrl, true);
        xhr.responseType = 'arraybuffer';

        xhr.onload = function (e) {
            if (this.status == 200) {

                console.log(new Date().toLocaleTimeString() + ': end request pixel data');
                dv._imgData = new Uint8ClampedArray(this.response);
                // get binary data as a response
                //var bytes = new Uint8Array(this.response);
                //var len = bytes.length;
                ////grayData = bytes;
                //var curValue, index;
                //for (var i = 0; i < len; i++) {
                //    curValue = bytes[i];
                //    index = 4 * i;
                //    dv._imgData[index] = curValue;
                //    dv._imgData[index + 1] = curValue;
                //    dv._imgData[index + 2] = curValue;
                //    dv._imgData[index + 3] = 255;
                //}

                console.log(new Date().toLocaleTimeString() + ': start load image');

                var canvas = dv._helpCanvas, width = dv.imgWidth, height = dv.imgHeight;
                canvas.width = width;
                canvas.height = height,
                ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, width, height);

                var imageData = ctx.createImageData(width, height);
                imageData.data.set(dv._imgData);
                ctx.putImageData(imageData, 0, 0);

                dv._reloadImgWithWL(canvas, request.windowWidth, request.windowCenter, dv._adjustWLCallback);

                delete dv._imgData;
                dv._imgData = undefined;//release the buff

                console.log(new Date().toLocaleTimeString() + ':finish load imgData: ' + request.windowWidth + "," + request.windowCenter);
                dv._imgDataWorker.isBusy = false;

                if (dv._imgDataRequest.length > 0) {
                    var req = dv._imgDataRequest.pop();

                    console.log('pop request and do it: ' + req.windowWidth + ',' + req.windowCenter);
                    dv._requestPixelData(req);
                    dv._imgDataWorker.isBusy = true;

                    dv._imgDataRequest = [];
                }
            } else {

            }
        };

        xhr.send();
    }

    dicomViewer.prototype._adjustWLLocal = function (windowWidth, windowCenter) {
        var dv = this;

        if (!this._wlWorker) {
            var workerJs;
            var sc = document.getElementsByTagName("script");
            for (idx = 0; idx < sc.length; idx++) {
                s = sc.item(idx);
                if (s.src && s.src.match(/wlWorker\.js$/)) {
                    workerJs = s.src;
                    break;
                }
            }

            this._wlReqeust = [];
            this._wlWorker = new Worker(workerJs);
            this._wlWorker.isBusy = false;

            this._wlWorker.addEventListener('message', function (msg) {
                dv.pixelData = new Uint16Array(msg.data.pixelData);
                var grayData = new Uint8ClampedArray(msg.data.grayData);
                var width = msg.data.width, height = msg.data.height, windowWidth = msg.data.windowWidth, windowCenter = msg.data.windowCenter;
                dv._imgData = grayData;

                if (!window.createImageBitmap) {//IE
                    if (!dv._helpCanvas) {
                        dv._helpCanvas = document.createElement('canvas');
                    }
                    var canvas = dv._helpCanvas;
                    canvas.width = width;
                    canvas.height = height,
                    ctx = canvas.getContext('2d');
                    ctx.clearRect(0, 0, width, height);

                    var imageData = ctx.createImageData(width, height);
                    imageData.data.set(grayData);
                    ctx.putImageData(imageData, 0, 0);

                    dv._reloadImgWithWL(canvas, windowWidth, windowCenter, dv._adjustWLCallback);
                } else {
                    var imageData = new ImageData(grayData, width, height);
                    var a = createImageBitmap(imageData, 0, 0, width, height);

                    Promise.all([createImageBitmap(imageData, 0, 0, width, height)]).then(function (sprites) {
                        var imgBitmap = sprites[0];
                        dv._reloadImgWithWL(imgBitmap, windowWidth, windowCenter, dv._adjustWLCallback);
                    });
                }

                console.log('finish adjustWL: ' + windowWidth + "," + windowCenter);
                dv._wlWorker.isBusy = false;

                if (dv._wlReqeust.length > 0) {
                    var req = dv._wlReqeust.pop();
                    req['pixelData'] = dv.pixelData.buffer;
                    req['grayData'] = dv._imgData.buffer;
                    console.log('pop request and do it: ' + req.windowWidth + ',' + req.windowCenter);
                    dv._wlWorker.postMessage(req, [dv.pixelData.buffer, dv._imgData.buffer]);
                    dv._wlWorker.isBusy = true;

                    dv._wlReqeust = [];
                }

            }, false);
        }

        var request = { 'windowWidth': windowWidth, 'windowCenter': windowCenter, 'width': this.imgWidth, 'height': this.imgHeight };
        request['pixelData'] = dv.pixelData.buffer;
        request['grayData'] = dv._imgData.buffer;
        if (this._wlWorker.isBusy) {
            console.info('push request: ' + request.windowWidth + ',' + request.windowCenter);
            this._wlReqeust.push(request);
        } else {
            this._wlWorker.postMessage(request, [dv.pixelData.buffer, dv._imgData.buffer]);
            dv._wlWorker.isBusy = true;
        }
    }

    dicomViewer.prototype._reloadImgWithWL = function (imgData, windowWidth, windowCenter, callback) {
        var dv = this;
        if (dv.jcImage) {
            dv.jcImage.del();
        }

        if (!imgData.src) {
            imgData.src = 'mock';//in order to make JC work
        }

        var imgId = dv.id + "_img_" + dv._newObjectId();
        jc.image(imgData).id(imgId).layer(dv.imgLayerId).down('bottom');
        dv.jcImage = jc('#' + imgId);

        dv.windowWidth = windowWidth;
        dv.windowCenter = windowCenter;
        dv.updateTag(dicomTag.windowWidth, dv.windowWidth);
        dv.updateTag(dicomTag.windowCenter, dv.windowCenter);

        if (!!callback) {
            callback.call(dv);
        }
    }

    dicomViewer.prototype.registerEvent = function (obj, type) {
        if (!this.eventHandlers[type]) {
            this.eventHandlers[type] = [];
        }

        var handlers = this.eventHandlers[type];
        var len = handlers.length,
			i;

        for (i = 0; i < len; i++) {
            if (handlers[i] === obj) {
                return; //exists already
            }
        }

        handlers.push(obj);
    }

    dicomViewer.prototype.unRegisterEvent = function (obj, type) {
        if (!this.eventHandlers[type]) {
            return;
        }

        var handlers = this.eventHandlers[type];
        var len = handlers.length,
			i, found = false;

        for (i = 0; i < len; i++) {
            if (handlers[i] === obj) {
                found = true;
                break;
            }
        }

        if (found) {
            handlers.splice(i, 1);
        }
    }

    dicomViewer.prototype._handleEvent = function (arg, type, handler) {
        if (!this.isReady) {
            return;
        }
        var handlers = this.eventHandlers[type]
        if (!handlers || handlers.length == 0) {
            return;
        }

        if (arg.x) {
            arg = screenToImage(arg, this.imgLayer.transform());
        }

        handlers.forEach(function (obj) {
            if (obj[handler]) {
                obj[handler](arg);
            }
        });
    }

    dicomViewer.prototype.onKeyUp = function (key) {
        if (!this.isReady) {
            return;
        }
        console.log(key.keyCode);
        if (key.keyCode == 46) {//user press Delete
            this.deleteCurObject();
        }
    }

    dicomViewer.prototype.onClick = function (evt) {
        if (!this.isReady) {
            return;
        }
        this._handleEvent(evt, eventType.click, 'onClick');
    }

    dicomViewer.prototype.onMouseDown = function (evt) {
        if (!this.isReady) {
            return;
        }
        //if in select context, and not click any object, will unselect all objects.
        if (this.curContext == viewContext.select) {
            if (!evt.event.cancelBubble) {
                if (this.curSelectObj && this.curSelectObj.setEdit) {
                    this.curSelectObj.setEdit(false);
                    this.curSelectObj = undefined;
                }

                this.draggable(true);
            } else {
                this.draggable(false);
            }
        }

        if (!evt.event.cancelBubble && this.curContext == viewContext.select) {

            if (this.curSelectObj && this.curSelectObj.setEdit) {
                this.curSelectObj.setEdit(false);
            }
        }

        this._handleEvent(evt, eventType.mouseDown, 'onMouseDown');
    }

    dicomViewer.prototype.onMouseMove = function (evt) {
        if (!this.isReady) {
            return;
        }
        
        this._handleEvent(evt, eventType.mouseMove, 'onMouseMove');
    }

    dicomViewer.prototype.onMouseUp = function (evt) {
        if (!this.isReady) {
            return;
        }
        this._handleEvent(evt, eventType.mouseUp, 'onMouseUp');
    }

    dicomViewer.prototype.onMouseWheel = function (evt) {
        if (!this.isReady) {
            return;
        }
        var scaleValue = 1;
        if (evt.wheelDelta / 120 > 0) {
            //up
            scaleValue = 1.1;
        } else { //down
            scaleValue = 0.9;
        }
		
		var log= "x:{0},y:{1}".format(evt.offsetX, evt.offsetY);
		console.log(log);
		
        var ptPrevious = this.imgLayer.getCenter();
        this.imgLayer.scale(scaleValue);
        var ptNow = this.imgLayer.getCenter();

        this.imgLayer.translate(ptPrevious.x - ptNow.x, ptPrevious.y - ptNow.y);
        this.updateTag(dicomTag.customScale, Math.round(this.getScale() * 100) / 100);

        //adjust objects' size
        this.annotationList.forEach(function (obj) {
            if (obj.onScale) {
                obj.onScale();
            }
        });

        this._handleEvent(scaleValue, eventType.mouseWheel, 'onMouseWheel');

        evt.stopImmediatePropagation();
        evt.stopPropagation();
        evt.preventDefault();
    }

    dicomViewer.prototype.onContextMenu = function (evt) {
        if (!this.isReady) {
            return;
        }
        if (this.curContext == viewContext.create) {
            this.setContext(viewContext.select);
        }
        //todo: add context menus

        evt.stopImmediatePropagation();
        evt.stopPropagation();
        evt.preventDefault();
    }

    dicomViewer.prototype.draggable = function (draggable) {
        var dv = this;
        var canvas = this.canvas;

        this.imgLayer.draggable({
            disabled: !draggable,
            start: function (arg) {
                this._lastPos = {x: arg.x, y: arg.y};
                this._startWL = {width: dv.windowWidth, center: dv.windowCenter};
                
                if(dv.curContext == viewContext.select || dv.curContext == viewContext.create){
                	canvas.style.cursor = 'move';
                }
            },
            stop: function (arg) {
                if (dv.curContext == viewContext.wl) {
					var ptImg = arg;
                    if (typeof (this._lastPos.x) != 'undefined') {
                        var deltaX = ptImg.x - this._lastPos.x;
                        var deltaY = ptImg.y - this._lastPos.y;
                        if (Math.abs(deltaX) > Math.abs(deltaY)) {
                            deltaY = 0;
                        } else {
                            deltaX = 0;
                        }
                        //console.log('deltaX: ' + deltaX + ',deltaY: ' + deltaY);
                        if(deltaX != 0 || deltaY != 0){
	                        this._startWL.width = Math.round(this._startWL.width + deltaX);
                        	this._startWL.center = Math.round(this._startWL.center + deltaY);
                        
                        	dv.adjustWL(this._startWL.width, this._startWL.center);
                        }
                    }

                    this._lastPos = {
                        x: ptImg.x,
                        y: ptImg.y
                    };
                }else if(dv.curContext == viewContext.select || dv.curContext == viewContext.create){
                	canvas.style.cursor = 'auto';
                }
                
                this.lastPos = {};
                this._startWL = {};
            },
            drag: function (arg) {
                if (dv.curContext == viewContext.wl) {
                    return true;
                }
            }
        });
    }

    dicomViewer.prototype.setWLModel = function () {
        this.setContext(viewContext.wl);
    }

    dicomViewer.prototype.setPanModel = function () {
        this.setContext(viewContext.pan);
    }

    dicomViewer.prototype.setSelectModel = function () {
        this.setContext(viewContext.select);
    }

    dicomViewer.prototype.setContext = function (ctx) {
        var lastContext = this.curContext;

        if (lastContext !== ctx) {
            var draggable = (ctx == viewContext.pan) || (ctx == viewContext.wl) || (ctx == viewContext.select && this.curSelectObj == null);
            this.draggable(draggable);

            this.curContext = ctx;
            this.selectObject(undefined);
        }
        
        var canvas = this.canvas;
        if(this.curContext == viewContext.wl){
        	var u = this.cursorUrl + '/adjustwl.cur';
 		   	canvas.style.cursor = "url('{0}'),move".format(u);
        }else if(this.curContext == viewContext.pan){
        	canvas.style.cursor = "move";
        }else if(this.curContext == viewContext.select){
        	canvas.style.cursor = "default";
        }else if(this.curContext == viewContext.create){
        	canvas.style.cursor = "default";
        }
    }

    dicomViewer.prototype.setDicomTags = function (tagList) {
        this.dicomTagList = tagList;

        //tags value maybe changed, redraw overlay
        this.refreshOverlay();
    }

    dicomViewer.prototype.updateTag = function (tag, value) {
        var i = 0, len = this.dicomTagList.length, found = false;
        for (i = 0; i < len; i++) {
            var tagE = this.dicomTagList[i];
            if (tagE.group == tag.group && tagE.element == tag.element) {
                tagE.value = value;
                found = true;
                break;
            }
        }

        if (!found) {
            this.dicomTagList.push(new dicomTag(tag.group, tag.element, value));
        }

        this.refreshOverlay();
    }

    dicomViewer.prototype.addOverlay = function (tag, pos, prefix) {
        var ol = new overlay(tag, pos, prefix);
        this.overlayList.push(ol);

        this.refreshOverlay();
    }

    dicomViewer.prototype.refreshOverlay = function () {
        var i = 0, len = this.overlayList.length;
        for (i = 0; i < len; i++) {
            var ol = this.overlayList[i];

            if (!ol.isCreated) {
                ol.create(this);
            }

            //find the tag
            var theTag = undefined;
            var j = 0, len2 = this.dicomTagList.length;
            for (j = 0; j < len2; j++) {
                var tag = this.dicomTagList[j];
                if (tag.group == ol.group && tag.element == ol.element) {
                    theTag = tag;
                    break;
                }
            }

            var value = '';
            if (theTag) {
                value = theTag.value;
            }

            ol.updateString(value);
        }
    }

    dicomViewer.prototype.selectObject = function (obj) {
        if (obj && obj instanceof annObject) {

            this.curSelectObj = obj;

            //set all other obj not in edit status
            this.annotationList.forEach(function (otherObj) {
                if (otherObj !== obj) {
                    otherObj.setEdit(false);
                } else {
                    otherObj.setEdit(true);
                }
            });
        } else {
            if (this.curSelectObj) {
                if (this.curSelectObj.isCreated) {
                    this.curSelectObj.setEdit(false);
                } else {
                    this.curSelectObj.del();
                }
            }

            this.curSelectObj = undefined;
        }
    }

    dicomViewer.prototype.deleteCurObject = function () {
        var curObj = this.curSelectObj;
        if (curObj) {
            this.deleteObject(curObj);
        }
    }

    dicomViewer.prototype.deleteObject = function (obj) {
        if (obj && obj instanceof annObject) {
            obj.del();

            var i = 0,
				len = this.annotationList.length;
            for (i = 0; i < len; i++) {
                if (this.annotationList[i] === obj) {
                    found = true;
                    break;
                }
            }

            if (found) {
                this.annotationList.splice(i, 1);
                if (this.curSelectObj === obj) {
                    this.curSelectObj = undefined;
                }
            }
        }
    }

	dicomViewer.prototype.createAnnObject = function(annObj){
		annObj.id = this._newObjectId();
		this.setContext(viewContext.create);

        this.curSelectObj = annObj;
        annObj.startCreate(this);

        return annObj;
	}
	
    dicomViewer.prototype.createRect = function () {
        var aRect = new annRect();
        aRect.id = this._newObjectId();
        this.setContext(viewContext.create);

        this.curSelectObj = aRect;
        aRect.startCreate(this);

        return aRect;
    }

    dicomViewer.prototype.createLine = function () {
        var aLine = new annLine();
        aLine.id = this._newObjectId();
        this.setContext(viewContext.create);

        this.curSelectObj = aLine;
        aLine.startCreate(this);

        return aLine;
    }

    dicomViewer.prototype._onObjectCreated = function (obj) {
        if (obj && obj.isCreated) {
            //finish create
            this.annotationList.push(obj);
            this.setContext(viewContext.select);
            this.selectObject(obj);
        }
    }

    dicomViewer.prototype.rotate = function (angle) {
        if (angle > 0) {
            this.imgLayer.rotate(angle, 'center');
        }
    }

    dicomViewer.prototype.scale = function (value) {
        if (value > 0) {
            this.imgLayer.scale(value);
            this.updateTag(dicomTag.customScale, Math.round(this.getScale() * 100) / 100);
        }
    }

    dicomViewer.prototype.getScale = function () {
        var scale = this.imgLayer.optns.scaleMatrix[0][0];
        if (scale < 0.1) {
            scale = 0.1
        };

        return scale;
    }

    dicomViewer.prototype.reset = function (value) {
        this.imgLayer.transform(1, 0, 0, 1, 0, 0, true);
        this.updateTag(dicomTag.customScale, Math.round(this.getScale() * 100) / 100);

        //adjust objects' size
        this.annotationList.forEach(function (obj) {
            if (obj.onScale) {
                obj.onScale();
            }
        });
    }

    dicomViewer.prototype.bestFit = function () {
        var imgWidth = this.imgWidth,
			imgHeight = this.imgHeight,
			canvasWidth = this.canvas.width,
			canvasHeight = this.canvas.height;
        var widthScale = canvasWidth / imgWidth,
			heightScale = canvasHeight / imgHeight;

        this.reset();
        if (widthScale < heightScale) {
            this.imgLayer.scale(widthScale);
            //this.imgLayer._y = (canvasHeight - imgHeight * widthScale) / 2;
            this.imgLayer.translate(0, (canvasHeight - imgHeight * widthScale) / 2);
        } else {
            this.imgLayer.scale(heightScale);
            //this.imgLayer._x = (canvasWidth - imgWidth * heightScale) / 2;
            this.imgLayer.translate((canvasWidth - imgWidth * heightScale) / 2, 0);
        }

        this.updateTag(dicomTag.customScale, Math.round(this.getScale() * 100) / 100);
        this.annotationList.forEach(function (obj) {
            if (obj.onScale) {
                obj.onScale();
            }
        });
    }

    //serialize to json string
    dicomViewer.prototype.serialize = function () {
        //1.annotation list
        //2.transform
        //3.window width/center => to tags
        var str = '{"version":{0},"annObjects":{1},"transForm":{2}, "scaleMatrix":{3}, "rotateMatrix":{4}, "translateMatrix":{5}}';

        var strAnnObjs = "[";
        if (this.annotationList) {
            var i = 0,
				len = this.annotationList.length;
            for (i = 0; i < len; i++) {
                strAnnObjs += this.annotationList[i].serialize();
                if (i < len - 1) {
                    strAnnObjs += ",";
                }
            }
        }
        strAnnObjs += "]";

        var transImg = this.imgLayer.transform();
        var strTrans = JSON.stringify(transImg);

        var strScaleMatrix = JSON.stringify(this.imgLayer.optns.scaleMatrix);
        var strRotateMatrix = JSON.stringify(this.imgLayer.optns.rotateMatrix);
        var strTranslateMatrix = JSON.stringify(this.imgLayer.optns.translateMatrix);

        str = str.format(this.version, strAnnObjs, strTrans, strScaleMatrix, strRotateMatrix, strTranslateMatrix);
        return str;
    }

    dicomViewer.prototype.deSerialize = function (strJSON) {
        var jsonObj = (new Function("return " + strJSON))();
        if (jsonObj) {
            var dv = this;
            var version = jsonObj.version;
            var annObjs = jsonObj.annObjects;
            var trans = jsonObj.transForm;
            var scaleMatrix = jsonObj.scaleMatrix;
            var rotateMatrix = jsonObj.rotateMatrix;
            var translateMatrix = jsonObj.translateMatrix;

            this.imgLayer.transform(1, 0, 0, 1, 0, 0, true);

            this.imgLayer.optns.scaleMatrix = scaleMatrix;
            this.imgLayer.optns.rotateMatrix = rotateMatrix;
            this.imgLayer.optns.translateMatrix = translateMatrix;

            this.scale(1);
			
			var annPath = module.config().annPath || 'dicom';
            annObjs.forEach(function (obj) {
                var type = obj.type;
                require([annPath + '/' +obj.type], function(annObj){
                	var newObj = new annObj();
                	newObj.id = dv._newObjectId();
                	newObj.parent = dv;
                	newObj.deSerialize(obj);
                	
                	dv.selectObject();//select no-object
                });
            });
        }
    }
	
	//reuqire js moudle
	return dicomViewer;
	
});