var Viewer = (function() {
//***************************************************************************************************
//
//	definition of global variables
//
//***************************************************************************************************/
var canvas = {}; // = document.getElementById("viewer-canvas"); // id of canvas in the DOM
var $canvas = {}; // jQuery object of the canvas element
var gl = {}; // stores the webgl context

var shaders = {}; // set storing the shaders
var shaderPrograms = {}; // array storing the loaded shader programs
var scenes = {};
var elements = {}; // set of loaded triangle meshes and fiber bundles

elements.fibres = {};
elements.meshes = {};
elements.activations = {};
elements.connections = {};
elements.niftiis = {};
elements.textures = {};
elements.texIds = [];

var variables = {};

// webgl
variables.webgl = {};
variables.webgl.needsRedraw = false; // flag indicating the scene needs redrawing, only drawing the scene 
									 // when something changed to reduces cpu usage
variables.webgl.preloadTextures; // stores the preload textures interval for clearinterval()
variables.webgl.preloadCounterAxial = 1; // 
variables.webgl.preloadCounterCoronal = 1; //
variables.webgl.lastRot = mat4.create(); // accumulates the rotations from the arcball
mat4.identity(variables.webgl.lastRot);
variables.webgl.thisRot = mat4.create(); // current rotation matrix
mat4.identity(variables.webgl.thisRot);
variables.webgl.mvMatrix = mat4.create(); // model view matrix
variables.webgl.pMatrix = mat4.create(); // projection matrix
variables.webgl.nMatrix = mat3.create(); // normal matrix
mat4.rotateX(variables.webgl.thisRot, 2.0);
mat4.rotateY(variables.webgl.thisRot, -2.2);
mat4.rotateZ(variables.webgl.thisRot, 0.2);
variables.webgl.rttFrameBuffer; // framebuffer for offscreen rendering
variables.webgl.rttTexture; // texture to render into
variables.webgl.lightPos = vec3.create(); // light position

// mouse interaction
variables.mouse = {};
variables.mouse.leftDown = false;
variables.mouse.middleDown = false;
variables.mouse.midClickX = 0;
variables.mouse.midClickY = 0;
variables.mouse.screenMoveX = 0;
variables.mouse.screenMoveY = 0;
variables.mouse.screenMoveXold = 0;
variables.mouse.screenMoveYold = 0;

// state of the currently displayed scene
variables.scene = {};
variables.scene.zoom = 1.0;
variables.scene.axial = 80;
variables.scene.coronal = 100;
variables.scene.sagittal = 80;
variables.scene.tex1 = 'none';
variables.scene.tex2 = "none"; //"fmri1";
variables.scene.localFibreColor = false;
variables.scene.showSlices = true;
variables.scene.renderTubes = true;
variables.scene.texThreshold1 = 1.0;
variables.scene.texThreshold2 = 1.0;
variables.scene.colormap = 1.0;
variables.scene.texAlpha2 = 1.0;
variables.scene.texInterpolation = true;
variables.scene.videoRecordingInterval;
		
// picking
variables.picking = {};
variables.picking.pickIndex = 1; // starting index for pick colors
variables.picking.pickArray = {};
variables.picking.pickMode = false;
variables.picking.oldPick = "none";
variables.picking.showTooltips = false;

// smooth transition mechanism 
variables.transition = {};
variables.transition.nextRot;
variables.transition.quatOldRot;
variables.transition.quatNextRot;
variables.transition.step = 0;
variables.transition.rotateInterval;
variables.transition.zoomOld;
variables.transition.zoomNext;
variables.transition.screenMoveXNext;
variables.transition.screenMoveYNext;
variables.transition.transitionOngoing = false;

// recording control
variables.recording = {};
variables.recording.record = {};
variables.recording.startTime;
variables.recording.recordSaving = false;
variables.recording.recordPlaying = false;
variables.recording.playStep = 0;

// connectom
variables.connectom = {};
variables.connectom.activationIndex = 0; // index of connectom activations, used to enumerate
variables.connectom.connectionIndex = 0; // index of connectom connections, used to enumerate
variables.connectom.activations = {};
variables.connectom.connections = {};
variables.connectom.timestep = 0;
variables.connectom.animate = false;
variables.connectom.animationInterval;

//***************************************************************************************************
//
//	init and loading of all the elements
//
//***************************************************************************************************/
function init(opts) {
	$canvas = $(opts.canvas);
	canvas = $canvas[0];
	
	variables.config = opts.config;
	
	$(Viewer).bind('loadElementsComplete', function(event) {
		// wenn alle Elemente geladen wurden, soll der ready-Event gefeuert werden.
		$(Viewer).trigger('ready');
		redraw();
	});
	
	// hier wird der eigentliche WebGL-Viewer initialisiert 
	try {
		initGL(canvas);
	} catch (e) {
		$(Viewer).trigger('webglNotSupported', e);
		return;
	}
	Arcball.set_win_size($canvas.width(), $canvas.height());
	loadShaders();

	if ('backgroundColor' in opts) {
		gl.clearColor(opts.backgroundColor[0], opts.backgroundColor[1], opts.backgroundColor[2], opts.backgroundColor[3]);
	} else {
		gl.clearColor(1.0, 1.0, 1.0, 1.0);
	}

	gl.enable(gl.DEPTH_TEST);

	initTextureFramebuffer();

	if ('elements' in opts && opts.elements.length) {
		loadElements(opts.elements);
	}

	if ('activations' in opts && opts.activations.length) {
		loadActivations(opts.activations);
	}

	if ('connections' in opts && opts.connections.length) {
		loadConnections(opts.connections);
	}

	loadScenes();
	
	canvas.onmousedown = handleMouseDown;
	canvas.onmouseup = handleMouseUp;
	canvas.onmousemove = handleMouseMove;
	canvas.addEventListener('DOMMouseScroll', handleMouseWheel, false);
	canvas.addEventListener('mousewheel', handleMouseWheel, false);

	redraw();
	tick();
}

function tick() {
	requestAnimFrame(tick);
	drawScene();
}

//***************************************************************************************************
//
//	init webgl
//
//***************************************************************************************************/
function initGL(canvas) {
	//gl = WebGLDebugUtils.makeDebugContext(canvas.getContext("experimental-webgl"));
	gl = canvas.getContext("experimental-webgl", {preserveDrawingBuffer: true});
	gl.viewportWidth = $canvas.width();
	gl.viewportHeight = $canvas.height();
}

function initTextureFramebuffer() {
	variables.webgl.rttFrameBuffer = gl.createFramebuffer();
	gl.bindFramebuffer(gl.FRAMEBUFFER, variables.webgl.rttFrameBuffer);
	variables.webgl.rttFrameBuffer.width = 512;
	variables.webgl.rttFrameBuffer.height = 512;

	variables.webgl.rttTexture = gl.createTexture();
	gl.bindTexture(gl.TEXTURE_2D, variables.webgl.rttTexture);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_NEAREST);
	gl.generateMipmap(gl.TEXTURE_2D);

	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, variables.webgl.rttFrameBuffer.width, variables.webgl.rttFrameBuffer.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

	var renderbuffer = gl.createRenderbuffer();
	gl.bindRenderbuffer(gl.RENDERBUFFER, renderbuffer);
	gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, variables.webgl.rttFrameBuffer.width, variables.webgl.rttFrameBuffer.height);

	gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, variables.webgl.rttTexture, 0);
	gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, renderbuffer);

	gl.bindTexture(gl.TEXTURE_2D, null);
	gl.bindRenderbuffer(gl.RENDERBUFFER, null);
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

//***************************************************************************************************
//
//	load functions
//
//***************************************************************************************************/
function loadElements(elementsToLoad) {
	$(Viewer).trigger('loadElementsStart');

	// alle Elemente durchgehen, 
	$.each(elementsToLoad, function(i, el) {
		$(Viewer).trigger('loadElementStart', {
			'id' : el.id,
			'name' : el.name,
			'type' : el.type
		});

		switch( el.type ) {
		case "mesh" :
			loadMesh(el);
			break;
		case "fibre" :
			loadFibre(el);
			break;
		case "texture" :
			loadTexture(el);
			$(Viewer).trigger('loadTexture', {
				'id' : el.id,
				'name' : elements.niftiis[el.id].name
			});
			break;
			default:
		}
	});
	//  den loadElementsComplete-Event feuern, wenn alle Elemente geladen sind.
	$(Viewer).trigger('loadElementsComplete');
	variables.scene.tex1 = elements.texIds[0];
	redraw();
}

function loadActivations(activationsToLoad) {
	$(Viewer).trigger('loadActivationsStart');

	$.each(activationsToLoad, function(i, ac) {
		createActivation( ac.id, ac.name, ac.coord.x, ac.coord.y, ac.coord.z, ac.size, ac.color.r, ac.color.g, ac.color.b );
		elements.activations[ac.id].fromJSON = true;

		$(Viewer).trigger('newActivation', {
			'id' : ac.id,
			'name' : ac.name,
			'active' : true
		});
		
		$(Viewer).trigger('loadActivationComplete', {
			'id' : ac.id
		});
		
		var saveAct = {};
        saveAct.id = ac.id;
        saveAct.name = ac.name;
        saveAct.co = elements.activations[ac.id].coordinates;
        saveAct.size = ac.size;
        saveAct.rgb = elements.activations[ac.id].rgb;
        variables.connectom.activations[ac.id] = saveAct;
	});
	
	$(Viewer).trigger('loadActivationsComplete');
}

function loadConnections(connectionsToLoad) {
	$(Viewer).trigger('loadConnectionsStart');

	$.each(connectionsToLoad, function(i, con) {
		var fromId = con.fromId;
		var toId = con.toId;
		
		var cofp = elements.activations[fromId].coordinates;
		var cotp = elements.activations[toId].coordinates;
		var color = con.color;
		var strength = con.strength;
		var size = con.size;
		var distance = con.distance;
		var speed = con.speed;
		var color2 = con.color2;
		var strength2 = con.strength2;
		var size2 = con.size2;
		var distance2 = con.distance2;
		var speed2 = con.speed2;
		
		addConnection( fromId, toId, color, strength, size, distance, speed, color2, strength2, size2, distance2, speed2, false );
		
		$(Viewer).trigger('loadConnectionComplete', {
			'id' : con.id
		});
	});

	$(Viewer).trigger('loadConnectionssComplete');
}

function loadScenes() {
    
	$(Viewer).trigger('loadScenesStart');
	$.getJSON(settings.DATA_URL + 'scenes.json', function(data) {
		$.each(data, function(i, sc) {
			scenes[sc.id] = {};
			scenes[sc.id].cameraPosition = sc.cameraPosition;
			scenes[sc.id].cameraTranslation = sc.cameraTranslation;
			scenes[sc.id].cameraZoom = sc.cameraZoom;
			scenes[sc.id].elementsAvailable = sc.elementsAvailable;
			scenes[sc.id].elementsActive = sc.elementsActive;
			scenes[sc.id].activationsAvailable = sc.activationsAvailable;
			scenes[sc.id].activationsActive = sc.activationsActive;
			scenes[sc.id].slices = sc.slices;
			scenes[sc.id].texture1 = sc.texture1;
			scenes[sc.id].texture2 = sc.texture2;
			scenes[sc.id].isView = sc.isView;
			scenes[sc.id].name = sc.name;

			$(Viewer).trigger('loadSceneComplete', {
				'id' : sc.id,
				'isView' : sc.isView,
				'name' : sc.name
			});
		});
		$(Viewer).trigger('loadScenesComplete');
	});
}


// ***************************************************************************************************
//
// functions for smooth transitions between scenes
//
// ***************************************************************************************************/
function activateScene(id) {
	if (variables.transition.rotateInterval)
		clearInterval(variables.transition.rotateInterval);

	if (!(id in scenes)) {
		$(Viewer).trigger('sceneUnknown');
		return false;
	}

	nextScene = id;

	variables.transition.nextRot = mat4.create();
	mat4.identity(variables.transition.nextRot);
	mat4.rotateX(variables.transition.nextRot, scenes[id].cameraPosition[0]);
	mat4.rotateY(variables.transition.nextRot, scenes[id].cameraPosition[1]);
	mat4.rotateZ(variables.transition.nextRot, scenes[id].cameraPosition[2]);

	variables.transition.quatOldRot = mat4toQuat(variables.webgl.thisRot);
	variables.transition.quatNextRot = mat4toQuat(variables.transition.nextRot);

	variables.transition.screenMoveXNext = scenes[id].cameraTranslation[0];
	variables.transition.screenMoveYNext = scenes[id].cameraTranslation[1];
	variables.transition.zoomNext = scenes[id].cameraZoom;

	variables.transition.zoomOld = variables.scene.zoom;
	variables.mouse.screenMoveXOld = variables.mouse.screenMoveX;
	variables.mouse.screenMoveYOld = variables.mouse.screenMoveY;

	variables.transition.step = 0;
	variables.transition.transitionOngoing = true;
	variables.transition.rotateInterval = setInterval(rotateToNextPosition, 30);
}

function rotateToNextPosition() {
	++variables.transition.step;
	if (variables.transition.step == 20) {
		clearInterval(variables.transition.rotateInterval);
		activateScene1(nextScene);
		variables.transition.transitionOngoing = false;
	}

	d = Math.log(variables.transition.step) / Math.log(20);

	variables.webgl.lastRot = mat4.create();
	mat4.identity(variables.webgl.lastRot);
	variables.webgl.thisRot = mat4.create();
	mat4.identity(variables.webgl.thisRot);

	q = quat4.create();
	q = slerp(variables.transition.quatOldRot, variables.transition.quatNextRot, d);
	quat4.toMat4(q, variables.webgl.thisRot);

	variables.scene.zoom = (1.0 - d) * variables.transition.zoomOld + d * variables.transition.zoomNext;
	variables.mouse.screenMoveX = (1.0 - d) * variables.mouse.screenMoveXOld + d * variables.transition.screenMoveXNext;
	variables.mouse.screenMoveY = (1.0 - d) * variables.mouse.screenMoveYOld + d * variables.transition.screenMoveYNext;

	redraw();
}

function activateScene1(id) {
	$(Viewer).trigger('activateSceneStart', {
		'id' : id,
		'scene' : scenes[id]
	});

	$.each(elements, function(id, element) {
		hideElement(id);
	});
	variables.scene.axial = scenes[id].slices[0];
	variables.scene.coronal = scenes[id].slices[1];
	variables.scene.sagittal = scenes[id].slices[2];

	changeTexture(scenes[id].texture1);
	changeTexture2(scenes[id].texture2);
	
	$.each(scenes[id].elementsActive, function(index, value) {
		showElement(value);
	});

	$.each(scenes[id].activationsActive, function(index, value) {
		showActivation(value);
	});
	

	$(Viewer).trigger('activateSceneComplete', {
		'id' : id,
		'scene' : scenes[id],
		'tex1' : variables.scene.tex1,
		'tex2' : variables.scene.tex2
	});
	redraw();
}

function activateView(id) {
	if (variables.transition.rotateInterval)
		clearInterval(variables.transition.rotateInterval);
	variables.transition.nextRot = mat4.create();
	mat4.identity(variables.transition.nextRot);
	mat4.rotateX(variables.transition.nextRot, scenes[id].cameraPosition[0]);
	mat4.rotateY(variables.transition.nextRot, scenes[id].cameraPosition[1]);
	mat4.rotateZ(variables.transition.nextRot, scenes[id].cameraPosition[2]);

	variables.transition.quatOldRot = mat4toQuat(variables.webgl.thisRot);
	variables.transition.quatNextRot = mat4toQuat(variables.transition.nextRot);

	variables.transition.screenMoveXNext = 0;
	variables.transition.screenMoveYNext = 0;
	variables.transition.zoomNext = 1.0;

	variables.transition.zoomOld = variables.scene.zoom;
	variables.mouse.screenMoveXOld = variables.mouse.screenMoveX;
	variables.mouse.screenMoveYOld = variables.mouse.screenMoveY;

	variables.transition.step = 0;
	variables.transition.transitionOngoing = true;
	variables.transition.rotateInterval = setInterval(rotateToNextPosition2, 30);
}

function rotateToNextPosition2() {
	++variables.transition.step;
	if (variables.transition.step == 20) {
		clearInterval(variables.transition.rotateInterval);
		variables.transition.transitionOngoing = false;
	}

	d = Math.log(variables.transition.step) / Math.log(20);

	variables.webgl.lastRot = mat4.create();
	mat4.identity(variables.webgl.lastRot);
	variables.webgl.thisRot = mat4.create();
	mat4.identity(variables.webgl.thisRot);

	q = quat4.create();
	q = slerp(variables.transition.quatOldRot, variables.transition.quatNextRot, d);
	quat4.toMat4(q, variables.webgl.thisRot);

	variables.scene.zoom = (1.0 - d) * variables.transition.zoomOld + d * variables.transition.zoomNext;
	variables.mouse.screenMoveX = (1.0 - d) * variables.mouse.screenMoveXOld + d * variables.transition.screenMoveXNext;
	variables.mouse.screenMoveY = (1.0 - d) * variables.mouse.screenMoveYOld + d * variables.transition.screenMoveYNext;

	redraw();
}

//***************************************************************************************************
//
//	shader management
//
//***************************************************************************************************/
function loadShaders() {
	getShader('mesh', 'vs');
	getShader('mesh', 'fs');
	getShader('fibre_t', 'vs');
	getShader('fibre_t', 'fs');
	getShader('fibre_l', 'vs');
	getShader('fibre_l', 'fs');
	getShader('slice', 'vs');
	getShader('slice', 'fs');
	initShader('slice');
	initShader('mesh');
	initShader('fibre_l');
	initShader('fibre_t');
}

function getShader(name, type) {
	var shader;
	$.ajax({
		url : 'static/shaders/' + name + '.' + type,
		async : false,
		success : function(data) {

			if (type == 'fs') {
				shader = gl.createShader(gl.FRAGMENT_SHADER);
			} else {
				shader = gl.createShader(gl.VERTEX_SHADER);
			}
			gl.shaderSource(shader, data);
			gl.compileShader(shader);

			if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
				alert(gl.getShaderInfoLog(shader));
				return null;
			}
			shaders[name + '_' + type] = shader;
		}
	});
}

function initShader(name) {
	shaderPrograms[name] = gl.createProgram();
	gl.attachShader(shaderPrograms[name], shaders[name + '_vs']);
	gl.attachShader(shaderPrograms[name], shaders[name + '_fs']);
	gl.linkProgram(shaderPrograms[name]);

	if (!gl.getProgramParameter(shaderPrograms[name], gl.LINK_STATUS)) {
		alert("Could not initialise shaders\n" + gl.LINK_STATUS);
	}

	gl.useProgram(shaderPrograms[name]);

	shaderPrograms[name].vertexPositionAttribute = gl.getAttribLocation(shaderPrograms[name], "aVertexPosition");
	gl.enableVertexAttribArray(shaderPrograms[name].vertexPositionAttribute);

	shaderPrograms[name].vertexNormalAttribute = gl.getAttribLocation(shaderPrograms[name], "aVertexNormal");
	gl.enableVertexAttribArray(shaderPrograms[name].vertexNormalAttribute);

	shaderPrograms[name].textureCoordAttribute = gl.getAttribLocation(shaderPrograms[name], "aTextureCoord");
	gl.enableVertexAttribArray(shaderPrograms[name].textureCoordAttribute);

	shaderPrograms[name].vertexColorAttribute = gl.getAttribLocation(shaderPrograms[name], "aVertexColor");
	gl.enableVertexAttribArray(shaderPrograms[name].vertexColorAttribute);

	shaderPrograms[name].pMatrixUniform  = gl.getUniformLocation(shaderPrograms[name], "uPMatrix");
	shaderPrograms[name].mvMatrixUniform = gl.getUniformLocation(shaderPrograms[name], "uMVMatrix");
	shaderPrograms[name].nMatrixUniform  = gl.getUniformLocation(shaderPrograms[name], "uNMatrix");
	shaderPrograms[name].pointLightingLocationUniform     = gl.getUniformLocation(shaderPrograms[name], "uPointLightingLocation");
	
	if (name == "slice") {
		shaderPrograms[name].colorMapUniform   = gl.getUniformLocation(shaderPrograms[name], "uColorMap");
		shaderPrograms[name].samplerUniform    = gl.getUniformLocation(shaderPrograms[name], "uSampler");
		shaderPrograms[name].samplerUniform1   = gl.getUniformLocation(shaderPrograms[name], "uSampler1");
		shaderPrograms[name].minUniform        = gl.getUniformLocation(shaderPrograms[name], "uMin");
		shaderPrograms[name].maxUniform        = gl.getUniformLocation(shaderPrograms[name], "uMax");
		shaderPrograms[name].threshold1Uniform = gl.getUniformLocation(shaderPrograms[name], "uThreshold1");
		shaderPrograms[name].threshold2Uniform = gl.getUniformLocation(shaderPrograms[name], "uThreshold2");
		shaderPrograms[name].alpha2Uniform     = gl.getUniformLocation(shaderPrograms[name], "uAlpha2");
	}
	
	if (name == "mesh") {
		shaderPrograms[name].cutWhiteUniform = gl.getUniformLocation(shaderPrograms[name], "uCutWhite");	
	}
	
	if (name == "fibre_t" || name == "fibre_l") {
		shaderPrograms[name].fibreColorUniform     = gl.getUniformLocation(shaderPrograms[name], "uFibreColor");
		shaderPrograms[name].fibreColorModeUniform = gl.getUniformLocation(shaderPrograms[name], "uFibreColorMode");
	}

	if (name == "fibre_t") {
		shaderPrograms[name].zoomUniform           = gl.getUniformLocation(shaderPrograms[name], "uZoom");
		shaderPrograms[name].thicknessUniform      = gl.getUniformLocation(shaderPrograms[name], "uThickness");
		shaderPrograms[name].animateUniform        = gl.getUniformLocation(shaderPrograms[name], "uAnimate");
		shaderPrograms[name].lengthUniform         = gl.getUniformLocation(shaderPrograms[name], "uLength");
		shaderPrograms[name].speedUniform          = gl.getUniformLocation(shaderPrograms[name], "uSpeed");
		shaderPrograms[name].blobsizeUniform       = gl.getUniformLocation(shaderPrograms[name], "uBlobSize");
		shaderPrograms[name].distanceUniform       = gl.getUniformLocation(shaderPrograms[name], "uDistance");
		shaderPrograms[name].timestepUniform       = gl.getUniformLocation(shaderPrograms[name], "uTimestep");
		shaderPrograms[name].barShiftUniform       = gl.getUniformLocation(shaderPrograms[name], "uBarShift");	
	}

	if (name == "fibre_t" || name == "mesh" || name == "fibre_l" ) {
		shaderPrograms[name].alphaUniform    = gl.getUniformLocation(shaderPrograms[name], "uAlpha");
		shaderPrograms[name].pickingUniform   = gl.getUniformLocation(shaderPrograms[name], "uPicking");
		shaderPrograms[name].pickColorUniform = gl.getUniformLocation(shaderPrograms[name], "uPickColor");
	}
	
}

function setMeshUniforms() {
	gl.useProgram(shaderPrograms['mesh']);
	gl.uniformMatrix4fv(shaderPrograms['mesh'].pMatrixUniform, false, variables.webgl.pMatrix);
	gl.uniformMatrix4fv(shaderPrograms['mesh'].mvMatrixUniform, false, variables.webgl.mvMatrix);
	gl.uniformMatrix3fv(shaderPrograms['mesh'].nMatrixUniform, false, variables.webgl.nMatrix);
	gl.uniform1f(shaderPrograms['mesh'].alphaUniform, 1.0);
	gl.uniform3f(shaderPrograms['mesh'].pointLightingLocationUniform, variables.webgl.lightPos[0], variables.webgl.lightPos[1], variables.webgl.lightPos[2]);
	gl.uniform1i(shaderPrograms['mesh'].pickingUniform, variables.picking.pickMode);
}

function setFibreLineUniforms() {
	gl.useProgram(shaderPrograms['fibre_l']);
	gl.uniformMatrix4fv(shaderPrograms['fibre_l'].pMatrixUniform, false, variables.webgl.pMatrix);
	gl.uniformMatrix4fv(shaderPrograms['fibre_l'].mvMatrixUniform, false, variables.webgl.mvMatrix);
	gl.uniformMatrix3fv(shaderPrograms['fibre_l'].nMatrixUniform, false, variables.webgl.nMatrix);
	gl.uniform1f(shaderPrograms['fibre_l'].alphaUniform, 1.0);
	gl.uniform3f(shaderPrograms['fibre_l'].pointLightingLocationUniform, variables.webgl.lightPos[0], variables.webgl.lightPos[1], variables.webgl.lightPos[2]);
	gl.uniform1i(shaderPrograms['fibre_l'].pickingUniform, variables.picking.pickMode);
	gl.uniform1i(shaderPrograms['fibre_l'].fibreColorModeUniform, variables.scene.localFibreColor);
}


function setFiberTubeUniforms() {
	gl.useProgram(shaderPrograms['fibre_t']);
	gl.uniformMatrix4fv(shaderPrograms['fibre_t'].pMatrixUniform, false, variables.webgl.pMatrix);
	gl.uniformMatrix4fv(shaderPrograms['fibre_t'].mvMatrixUniform, false, variables.webgl.mvMatrix);
	gl.uniformMatrix3fv(shaderPrograms['fibre_t'].nMatrixUniform, false, variables.webgl.nMatrix);

	gl.uniform3f(shaderPrograms['fibre_t'].pointLightingLocationUniform, variables.webgl.lightPos[0], variables.webgl.lightPos[1], variables.webgl.lightPos[2]);
	gl.uniform1f(shaderPrograms['fibre_t'].zoomUniform, variables.scene.zoom);

	gl.uniform1i(shaderPrograms['fibre_t'].fibreColorModeUniform, variables.scene.localFibreColor);
	gl.uniform1i(shaderPrograms['fibre_t'].pickingUniform, variables.picking.pickMode);
	
	gl.uniform1i(shaderPrograms['fibre_t'].animateUniform, false);
	gl.uniform1i(shaderPrograms['fibre_t'].timestepUniform, 0);
	gl.uniform1f(shaderPrograms['fibre_t'].blobsizeUniform, 0.0);
	gl.uniform1f(shaderPrograms['fibre_t'].speedUniform, 0.0);
	gl.uniform1f(shaderPrograms['fibre_t'].lengthUniform, 0.0);
	gl.uniform1f(shaderPrograms['fibre_t'].distanceUniform, 0.0);
	gl.uniform1f(shaderPrograms['fibre_t'].barShiftUniform, 0.0);
}

//***************************************************************************************************
//
// texture management
//
//***************************************************************************************************/
var waitId=0;
var waitOrient=0;
var waitPos=0;

function getTexture(id, orient, pos) {
	if (elements.textures[id][orient + pos]) {
		return elements.textures[id][orient + pos];
	} else {
		if ( elements.niftiis[id].loaded() ) {
			elements.textures[id][orient + pos] = gl.createTexture();
			elements.textures[id][orient + pos].image = elements.niftiis[id].getImage(orient, pos);
			handleLoadedTexture(elements.textures[id][orient + pos]);
		}
		else {
			// start time out and look a little bit later
			waitId = id;
			waitOrient = orient;
			waitPos = pos;
			setTimeout( waitForTextureLoad, 200 );
		}
	}
}

function waitForTextureLoad() {
	if ( elements.niftiis[waitId].loaded() ) {
		elements.textures[waitId][waitOrient + waitPos] = gl.createTexture();
		elements.textures[waitId][waitOrient + waitPos].image = elements.niftiis[waitId].getImage(waitOrient, waitPos);
		handleLoadedTexture(elements.textures[waitId][waitOrient + waitPos]);
	}
	else {
		// start time out and look a little bit later
		setTimeout( waitForTextureLoad, 200 );
	}
}

function handleLoadedTexture(texture) {
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, texture.image);
	if ( variables.scene.texInterpolation ) {
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	}
	else {
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	}
	gl.generateMipmap(gl.TEXTURE_2D);
	gl.bindTexture(gl.TEXTURE_2D, null);
	delete texture.image;
	redraw();
}


//***************************************************************************************************
//
// main functions that actually draw the entire scene
//
//***************************************************************************************************/
function redraw() {
	variables.webgl.needsRedraw = true;
}

var workaround = false;

function drawScene() {
	if (!variables.webgl.needsRedraw) {
		return;
	}
	variables.webgl.needsRedraw = false;

	gl.viewport(0, 0, gl.viewportWidth, gl.viewportHeight);
	gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

	mat4.ortho(-100 + variables.mouse.screenMoveX, 100 + variables.mouse.screenMoveX, -100 - variables.mouse.screenMoveY, 100 - variables.mouse.screenMoveY, -500, 500, variables.webgl.pMatrix);

	mat4.identity(variables.webgl.mvMatrix);
	zv = vec3.create();
	zv[0] = variables.scene.zoom;
	zv[1] = variables.scene.zoom;
	zv[2] = variables.scene.zoom;
	mat4.scale(variables.webgl.mvMatrix, zv);

	variables.webgl.lightPos[0] = 0.0;
	variables.webgl.lightPos[1] = 0.0;
	variables.webgl.lightPos[2] = -1.0;

	var dim = elements.niftiis[variables.scene.tex1].getDims();
	mat4.translate(variables.webgl.mvMatrix, [ dim[0]/-2.0, dim[1]/-2.0, dim[2]/-2.0 ]);

	mat4.inverse(variables.webgl.thisRot);
	mat4.multiply(variables.webgl.thisRot, variables.webgl.mvMatrix, variables.webgl.mvMatrix);
	mat4.inverse(variables.webgl.thisRot);

	mat4.toInverseMat3(variables.webgl.mvMatrix, variables.webgl.nMatrix);
	mat3.transpose(variables.webgl.nMatrix);

	mat4.multiplyVec3(variables.webgl.thisRot, variables.webgl.lightPos);

	gl.disable(gl.BLEND);
	gl.enable(gl.DEPTH_TEST);

	if ( !workaround ) {
		//initShaders2();
		workaround = true;
	}
	
	if ( variables.scene.showSlices ) {
		drawSlices();
	}
	
	$.each(elements.fibres, function() {
		if (this.display) {
			drawFibers(this);
			
		}
	});
	
	$.each(elements.connections, function() {
		if (this.display) {
			drawFibers(this);
			
		}
	});
	
	$.each(elements.activations, function() {
		if (this.display) {
			drawMesh(this);
		}
	});

	$.each(elements.meshes, function() {
		if (this.display) {
			if (!(this.id == 'head')) {
				drawMesh(this);
			}
		}
	});
	
	if (elements.meshes['head'] && elements.meshes['head'].display) {
		drawMesh(elements.meshes['head']);
	}
}

function drawPickScene() {
	variables.picking.pickMode = true;

	gl.viewport(0, 0, variables.webgl.rttFrameBuffer.width, variables.webgl.rttFrameBuffer.height);
	gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

	mat4.ortho(-100 + variables.mouse.screenMoveX, 100 + variables.mouse.screenMoveX, -100 - variables.mouse.screenMoveY, 100 - variables.mouse.screenMoveY, -500, 500, variables.webgl.pMatrix);

	mat4.identity(variables.webgl.mvMatrix);
	zv = vec3.create();
	zv[0] = variables.scene.zoom;
	zv[1] = variables.scene.zoom;
	zv[2] = variables.scene.zoom;
	mat4.scale(variables.webgl.mvMatrix, zv);

	variables.webgl.lightPos[0] = 0.0;
	variables.webgl.lightPos[1] = 0.0;
	variables.webgl.lightPos[2] = -1.0;

	var dim = elements.niftiis[variables.scene.tex1].getDims();
	mat4.translate(variables.webgl.mvMatrix, [ dim[0]/-2.0, dim[1]/-2.0, dim[2]/-2.0 ]);

	mat4.inverse(variables.webgl.thisRot);
	mat4.multiply(variables.webgl.thisRot, variables.webgl.mvMatrix, variables.webgl.mvMatrix);
	mat4.inverse(variables.webgl.thisRot);

	mat4.toInverseMat3(variables.webgl.mvMatrix, variables.webgl.nMatrix);
	mat3.transpose(variables.webgl.nMatrix);

	mat4.multiplyVec3(variables.webgl.thisRot, variables.webgl.lightPos);

	gl.disable(gl.BLEND);
	gl.enable(gl.DEPTH_TEST);
	
	if ( variables.scene.showSlices ) {
		drawSlices();
	}
	
	$.each(elements, function() {
		if (this.display) {
			if (this.type === 'fibre' || this.type === 'connection') {
				drawFibers(this);
			}
		}
	});

	$.each(elements, function() {
		if (this.type == 'activation' && this.display) {
			drawMesh(this);
		}
	});

	variables.picking.pickMode = false;
}

function drawMesh(elem) {
	if (!elem || !elem.display)
		return;
	
	setMeshUniforms();
	// bind buffers for rendering
	if (!variables.mouse.leftDown && !variables.mouse.middleDown && !variables.transition.transitionOngoing ) {
		if ( !elem.sortedIndices || elem.dirty ) {
			sortMeshIndices(elem, variables.webgl.mvMatrix, variables.webgl.pMatrix);
			elem.dirty = false;
			elem.hasBuffer = false;
		}
	}
	
	if ( !elem.hasBuffer ) {
		bindBuffers(elem);
	}
	

	gl.bindBuffer(gl.ARRAY_BUFFER, elem.vertexPositionBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, elem.vertexPositionBuffer.data, gl.STATIC_DRAW);
	gl.vertexAttribPointer(shaderPrograms['mesh'].vertexPositionAttribute, elem.vertexPositionBuffer.itemSize, gl.FLOAT, false, 0, 0);

	gl.bindBuffer(gl.ARRAY_BUFFER, elem.vertexNormalBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, elem.vertexNormalBuffer.data, gl.STATIC_DRAW);
	gl.vertexAttribPointer(shaderPrograms['mesh'].vertexNormalAttribute, elem.vertexNormalBuffer.itemSize, gl.FLOAT, false, 0, 0);

	gl.bindBuffer(gl.ARRAY_BUFFER, elem.vertexColorBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, elem.vertexColorBuffer.data, gl.STATIC_DRAW);
	gl.vertexAttribPointer(shaderPrograms['mesh'].vertexColorAttribute, elem.vertexColorBuffer.itemSize, gl.FLOAT, false, 0, 0);
	
	gl.bindBuffer(gl.ARRAY_BUFFER, elem.vertexTexCoordBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, elem.vertexTexCoordBuffer.data, gl.STATIC_DRAW);
	gl.vertexAttribPointer(shaderPrograms['mesh'].textureCoordAttribute, elem.vertexTexCoordBuffer.itemSize, gl.FLOAT, false, 0, 0);

	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, elem.vertexIndexBuffer);
	gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, elem.vertexIndexBuffer.data, gl.STATIC_DRAW);

	gl.uniform3f(shaderPrograms['mesh'].pickColorUniform, elem.pickColor[0], elem.pickColor[1], elem.pickColor[2]);
	gl.uniform1i(shaderPrograms['mesh'].cutWhiteUniform, elem.cutWhite);

	gl.disable(gl.BLEND);
	gl.enable(gl.DEPTH_TEST);

	if (elem.transparency < 1.0) {
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		gl.enable(gl.BLEND);
		gl.uniform1f(shaderPrograms['mesh'].alphaUniform, elem.transparency);
	}

	gl.drawElements(gl.TRIANGLES, elem.vertexIndexBuffer.numItems, gl.UNSIGNED_SHORT, 0);

	gl.bindBuffer(gl.ARRAY_BUFFER, null);
	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
}

function drawFibers(elem) {

	if (!variables.mouse.leftDown && !variables.mouse.middleDown && !variables.transition.transitionOngoing ) {
		if ( !elem.sortedLines || elem.dirty ) {
			sortLineMeans(elem, variables.webgl.mvMatrix, variables.webgl.pMatrix);
			elem.dirty = false;
			elem.hasBuffer = false;
		}
	}

	if ( !elem.hasBuffer ) {
		bindBuffers(elem);
	}
	
	if ( variables.scene.renderTubes ) {
		setFiberTubeUniforms();
		gl.bindBuffer(gl.ARRAY_BUFFER, elem.vertexPositionBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, elem.vertexPositionBuffer.tubedata, gl.STATIC_DRAW);
		gl.vertexAttribPointer(shaderPrograms['fibre_t'].vertexPositionAttribute, elem.vertexPositionBuffer.itemSize, gl.FLOAT, false, 0, 0);

		gl.bindBuffer(gl.ARRAY_BUFFER, elem.vertexNormalBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, elem.vertexNormalBuffer.tubedata, gl.STATIC_DRAW);
		gl.vertexAttribPointer(shaderPrograms['fibre_t'].vertexNormalAttribute, elem.vertexNormalBuffer.itemSize, gl.FLOAT, false, 0, 0);

		gl.bindBuffer(gl.ARRAY_BUFFER, elem.vertexTexCoordBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, elem.vertexTexCoordBuffer.data, gl.STATIC_DRAW);
		gl.vertexAttribPointer(shaderPrograms['fibre_t'].textureCoordAttribute, elem.vertexTexCoordBuffer.itemSize, gl.FLOAT, false, 0, 0);
		
		gl.bindBuffer(gl.ARRAY_BUFFER, elem.vertexColorBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, elem.vertexColorBuffer.tubedata, gl.STATIC_DRAW);
		gl.vertexAttribPointer(shaderPrograms['fibre_t'].vertexColorAttribute, elem.vertexColorBuffer.itemSize, gl.FLOAT, false, 0, 0);
	
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, elem.vertexIndexBuffer);
		gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, elem.vertexIndexBuffer.data, gl.STATIC_DRAW);

		gl.uniform3f(shaderPrograms['fibre_t'].fibreColorUniform, elem.color.r, elem.color.g, elem.color.b);
		gl.uniform3f(shaderPrograms['fibre_t'].pickColorUniform, elem.pickColor[0], elem.pickColor[1], elem.pickColor[2]);
		gl.uniform1f(shaderPrograms['fibre_t'].thicknessUniform, 0.6);
		gl.uniform1f(shaderPrograms['fibre_t'].barShiftUniform, 0.0);
		
		if (elem.strength) {
			gl.uniform1f(shaderPrograms['fibre_t'].thicknessUniform, elem.strength);
			gl.uniform1i(shaderPrograms['fibre_t'].animateUniform, variables.connectom.animate);
			gl.uniform1i(shaderPrograms['fibre_t'].timestepUniform, variables.connectom.timestep);
			gl.uniform1f(shaderPrograms['fibre_t'].blobsizeUniform, elem.size);
			gl.uniform1f(shaderPrograms['fibre_t'].distanceUniform, elem.distance);
			gl.uniform1f(shaderPrograms['fibre_t'].speedUniform, elem.speed);
			gl.uniform1f(shaderPrograms['fibre_t'].lengthUniform, elem.length);
			gl.uniform1f(shaderPrograms['fibre_t'].barShiftUniform, elem.barShift);
		}

		gl.disable(gl.BLEND);
		gl.enable(gl.DEPTH_TEST);

		if (elem.transparency < 1.0) {
			gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
			gl.enable(gl.BLEND);
			gl.uniform1f(shaderPrograms['fibre_t'].alphaUniform, elem.transparency);
		}

		for ( var i = 0; i < elem.indices.length; ++i) {
			if ( elem.activFibres ) {
				if ( elem.activFibres[i] ) {
					gl.drawArrays(gl.TRIANGLE_STRIP, elem.lineStarts[elem.sortedLines[i]]*2, elem.indices[elem.sortedLines[i]] * 2);
				}
			}
			else {
				gl.drawArrays(gl.TRIANGLE_STRIP, elem.lineStarts[elem.sortedLines[i]]*2, elem.indices[elem.sortedLines[i]] * 2);
			}
		}
	}
	else {
		setFibreLineUniforms();
		gl.bindBuffer(gl.ARRAY_BUFFER, elem.vertexPositionBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, elem.vertexPositionBuffer.data, gl.STATIC_DRAW);
		gl.vertexAttribPointer(shaderPrograms['fibre_l'].vertexPositionAttribute, elem.vertexPositionBuffer.itemSize, gl.FLOAT, false, 0, 0);
		
		gl.bindBuffer(gl.ARRAY_BUFFER, elem.vertexNormalBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, elem.vertexNormalBuffer.data, gl.STATIC_DRAW);
		gl.vertexAttribPointer(shaderPrograms['fibre_l'].vertexNormalAttribute, elem.vertexNormalBuffer.itemSize, gl.FLOAT, false, 0, 0);
		
		gl.bindBuffer(gl.ARRAY_BUFFER, elem.vertexColorBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, elem.vertexColorBuffer.data, gl.STATIC_DRAW);
		gl.vertexAttribPointer(shaderPrograms['fibre_l'].vertexColorAttribute, elem.vertexColorBuffer.itemSize, gl.FLOAT, false, 0, 0);
		
		gl.bindBuffer(gl.ARRAY_BUFFER, elem.vertexTexCoordBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, elem.vertexTexCoordBuffer.data, gl.STATIC_DRAW);
		gl.vertexAttribPointer(shaderPrograms['fibre_l'].textureCoordAttribute, elem.vertexTexCoordBuffer.itemSize, gl.FLOAT, false, 0, 0);
		
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, elem.vertexIndexBuffer);
		gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, elem.vertexIndexBuffer.data, gl.STATIC_DRAW);
		
		gl.uniform3f(shaderPrograms['fibre_l'].fibreColorUniform, elem.color.r, elem.color.g, elem.color.b);
		gl.uniform3f(shaderPrograms['fibre_l'].pickColorUniform, elem.pickColor[0], elem.pickColor[1], elem.pickColor[2]);
		
		gl.disable(gl.BLEND);
		gl.enable(gl.DEPTH_TEST);

		if (elem.transparency < 1.0) {
			gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
			gl.enable(gl.BLEND);
			gl.uniform1f(shaderPrograms['fibre_l'].alphaUniform, elem.transparency);
		}
		
		for ( var i = 0; i < elem.indices.length; ++i) {
			if ( elem.activFibres ) {
				if ( elem.activFibres[i] ) {
					gl.drawArrays(gl.LINE_STRIP, elem.lineStarts[elem.sortedLines[i]], elem.indices[elem.sortedLines[i]]);
				}
			}
			else {
				gl.drawArrays(gl.LINE_STRIP, elem.lineStarts[elem.sortedLines[i]], elem.indices[elem.sortedLines[i]]);
			}
		}
	}
					
	gl.bindBuffer(gl.ARRAY_BUFFER, null);
	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
	//TODO
}

function bindBuffers(elem) {
	if (elem.type === 'fibre' || elem.type === 'connection') {
		var vertexPositionBuffer      = gl.createBuffer();
		vertexPositionBuffer.data     = new Float32Array(elem.vertices);
		vertexPositionBuffer.tubedata = new Float32Array(elem.tubeVertices);
		vertexPositionBuffer.itemSize = 3;
		vertexPositionBuffer.numItems = elem.tubeVertices.length / 3;

		var vertexNormalBuffer      = gl.createBuffer();
		vertexNormalBuffer.data     = new Float32Array(elem.normals);
		vertexNormalBuffer.tubedata = new Float32Array(elem.tubeNormals);
		vertexNormalBuffer.itemSize = 3;
		vertexNormalBuffer.numItems = elem.tubeNormals.length / 3;
		
		var vertexIndexBuffer      = gl.createBuffer();
		vertexIndexBuffer.data     = new Uint32Array(elem.indices);
		vertexIndexBuffer.itemSize = 1;
		vertexIndexBuffer.numItems = elem.indices.length;

		var vertexTexCoordBuffer      = gl.createBuffer();
		vertexTexCoordBuffer.data = new Float32Array(elem.tubeTexCoords);
		vertexTexCoordBuffer.itemSize = 2;
		vertexTexCoordBuffer.numItems = elem.tubeTexCoords.length / 2;
		
		var vertexColorBuffer      = gl.createBuffer();
		vertexColorBuffer.data     = new Float32Array(elem.colors);
		vertexColorBuffer.tubedata = new Float32Array(elem.tubeColors);
		vertexColorBuffer.itemSize = 4;
		vertexColorBuffer.numItems = elem.colors.length / 4;

		elem.vertexNormalBuffer   = vertexNormalBuffer;
		elem.vertexPositionBuffer = vertexPositionBuffer;
		elem.vertexIndexBuffer    = vertexIndexBuffer;
		elem.vertexTexCoordBuffer = vertexTexCoordBuffer;
		elem.vertexColorBuffer    = vertexColorBuffer;
	} 
	else {
		var vertexPositionBuffer = gl.createBuffer();
		vertexPositionBuffer.data = new Float32Array(elem.vertices);
		vertexPositionBuffer.itemSize = 3;
		vertexPositionBuffer.numItems = elem.vertices.length / 3;

		var vertexNormalBuffer = gl.createBuffer();
		vertexNormalBuffer.data = new Float32Array(elem.normals);
		vertexNormalBuffer.itemSize = 3;
		vertexNormalBuffer.numItems = elem.normals.length / 3;

		var vertexColorBuffer = gl.createBuffer();
		vertexColorBuffer.data = new Float32Array(elem.colors);
		vertexColorBuffer.itemSize = 4;
		vertexColorBuffer.numItems = elem.colors.length / 4;

		var vertexIndexBuffer = gl.createBuffer();
		vertexIndexBuffer.data = new Uint16Array(elem.sortedIndices);
		vertexIndexBuffer.itemSize = 1;
		vertexIndexBuffer.numItems = elem.indices.length;
		
		var texCoords = new Array(elem.colors.length / 2);
		for (var i = 0; i < texCoords.length; ++i ) {
			texCoords[i] = 0;
		}
		var vertexTexCoordBuffer      = gl.createBuffer();
		vertexTexCoordBuffer.data = new Float32Array(texCoords);
		vertexTexCoordBuffer.itemSize = 2;
		vertexTexCoordBuffer.numItems = texCoords.length / 2;

		elem.vertexNormalBuffer   = vertexNormalBuffer;
		elem.vertexPositionBuffer = vertexPositionBuffer;
		elem.vertexColorBuffer    = vertexColorBuffer;
		elem.vertexIndexBuffer    = vertexIndexBuffer;
		elem.vertexTexCoordBuffer = vertexTexCoordBuffer;
	}
	elem.hasBuffer = true;
}

function drawSlices() {
	gl.useProgram(shaderPrograms['slice']);
	
	gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
	gl.enable(gl.BLEND);

	// initialize the secondary texture with an empty one
	gl.activeTexture(gl.TEXTURE1);
	gl.bindTexture(gl.TEXTURE_2D, null);
	gl.uniform1i(shaderPrograms['slice'].samplerUniform1, 1);
	gl.uniform1i(shaderPrograms['slice'].colorMapUniform,0);
	gl.uniform1f(shaderPrograms['slice'].minUniform, 0);
	gl.uniform1f(shaderPrograms['slice'].maxUniform, 0);
	gl.uniform1f(shaderPrograms['slice'].threshold1Uniform, 0);
	gl.uniform1f(shaderPrograms['slice'].threshold2Uniform, 0);

	var normalBuffer = gl.createBuffer();
	var normals = [ 0., 0., 1., 0., 0., 1., 0., 0., 1., 0., 0., 1. ];
	gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
	normalBuffer.data = new Float32Array(normals);
	gl.bufferData(gl.ARRAY_BUFFER, normalBuffer.data, gl.STATIC_DRAW);
	normalBuffer.itemSize = 3;
	normalBuffer.numItems = 4;
	gl.vertexAttribPointer(shaderPrograms['slice'].vertexNormalAttribute, normalBuffer.itemSize, gl.FLOAT, false, 0, 0);
	
	var colorBuffer = gl.createBuffer();
	var colors = [ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 ];
	gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.STATIC_DRAW);
	colorBuffer.itemSize = 4;
	colorBuffer.numItems = 4;
	gl.vertexAttribPointer(shaderPrograms['slice'].vertexColorAttribute, colorBuffer.itemSize, gl.FLOAT, false, 0, 0);
	
	var axialPosBuffer = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, axialPosBuffer);
	var ap = variables.scene.axial + 0.5;
	var vertices = [ 0, 0, ap, 256, 0.5, ap, 256, 256, ap, 0, 256, ap ];
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
	axialPosBuffer.itemSize = 3;
	axialPosBuffer.numItems = 4;
	gl.vertexAttribPointer(shaderPrograms['slice'].vertexPositionAttribute, axialPosBuffer.itemSize, gl.FLOAT, false, 0, 0);

	var axialTextureCoordBuffer = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, axialTextureCoordBuffer);
	var textureCoords = [ 0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0 ];
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(textureCoords), gl.STATIC_DRAW);
	axialTextureCoordBuffer.itemSize = 2;
	axialTextureCoordBuffer.numItems = 4;
	gl.vertexAttribPointer(shaderPrograms['slice'].textureCoordAttribute, axialTextureCoordBuffer.itemSize, gl.FLOAT, false, 0, 0);
	
	var axialVertexIndexBuffer = gl.createBuffer();
	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, axialVertexIndexBuffer);
	var vertexIndices = [ 0, 1, 2, 0, 2, 3 ];
	gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(vertexIndices), gl.STATIC_DRAW);
	axialVertexIndexBuffer.itemSize = 1;
	axialVertexIndexBuffer.numItems = 6;

	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, getTexture(variables.scene.tex1, 'axial', variables.scene.axial));
	gl.uniform1i(shaderPrograms['slice'].samplerUniform, 0);

	if (variables.scene.tex2 != "none") {
		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, getTexture(variables.scene.tex2, 'axial', variables.scene.axial));
		gl.uniform1i(shaderPrograms['slice'].samplerUniform1, 1);
		gl.uniform1i(shaderPrograms['slice'].colorMapUniform,variables.scene.colormap);
		gl.uniform1f(shaderPrograms['slice'].minUniform, elements.niftiis[variables.scene.tex2].getMin() );
		gl.uniform1f(shaderPrograms['slice'].maxUniform, elements.niftiis[variables.scene.tex2].getMax() );
		gl.uniform1f(shaderPrograms['slice'].threshold1Uniform, variables.scene.texThreshold1);
		gl.uniform1f(shaderPrograms['slice'].threshold2Uniform, variables.scene.texThreshold2);
		gl.uniform1f(shaderPrograms['slice'].alpha2Uniform, variables.scene.texAlpha2);
	}

	gl.uniformMatrix4fv(shaderPrograms['slice'].pMatrixUniform, false, variables.webgl.pMatrix);
	gl.uniformMatrix4fv(shaderPrograms['slice'].mvMatrixUniform, false, variables.webgl.mvMatrix);
	gl.uniformMatrix3fv(shaderPrograms['slice'].nMatrixUniform, false, variables.webgl.nMatrix);

	gl.drawElements(gl.TRIANGLES, axialVertexIndexBuffer.numItems, gl.UNSIGNED_SHORT, 0);

	var coronalPosBuffer = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, coronalPosBuffer);
	var cp = variables.scene.coronal + 0.5;
	var vertices = [ 0, cp, 0, 256, cp, 0, 256, cp, 256, 0, cp, 256 ];
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
	coronalPosBuffer.itemSize = 3;
	coronalPosBuffer.numItems = 4;
	gl.vertexAttribPointer(shaderPrograms['slice'].vertexPositionAttribute, coronalPosBuffer.itemSize, gl.FLOAT, false, 0, 0);

	var coronalTextureCoordBuffer = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, coronalTextureCoordBuffer);
	var textureCoords = [ 0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0 ];
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(textureCoords), gl.STATIC_DRAW);
	coronalTextureCoordBuffer.itemSize = 2;
	coronalTextureCoordBuffer.numItems = 4;
	gl.vertexAttribPointer(shaderPrograms['slice'].textureCoordAttribute, coronalTextureCoordBuffer.itemSize, gl.FLOAT, false, 0, 0);

	var coronalVertexIndexBuffer = gl.createBuffer();
	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, coronalVertexIndexBuffer);
	var vertexIndices = [ 0, 1, 2, 0, 2, 3 ];
	gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(vertexIndices), gl.STATIC_DRAW);
	coronalVertexIndexBuffer.itemSize = 1;
	coronalVertexIndexBuffer.numItems = 6;

	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, getTexture(variables.scene.tex1, 'coronal', variables.scene.coronal));
	gl.uniform1i(shaderPrograms['slice'].samplerUniform, 0);

	if (variables.scene.tex2 != "none") {
		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, getTexture(variables.scene.tex2, 'coronal', variables.scene.coronal));
		gl.uniform1i(shaderPrograms['slice'].samplerUniform1, 1);
	}

	gl.drawElements(gl.TRIANGLES, coronalVertexIndexBuffer.numItems, gl.UNSIGNED_SHORT, 0);

	var sagittalPosBuffer = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, sagittalPosBuffer);
	var sp = variables.scene.sagittal + 0.5;
	var vertices = [ sp, 0, 0, sp, 0, 256, sp, 256, 256, sp, 256, 0 ];
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
	sagittalPosBuffer.itemSize = 3;
	sagittalPosBuffer.numItems = 4;
	gl.vertexAttribPointer(shaderPrograms['slice'].vertexPositionAttribute, sagittalPosBuffer.itemSize, gl.FLOAT, false, 0, 0);

	var sagittalTextureCoordBuffer = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, sagittalTextureCoordBuffer);
	var textureCoords = [ 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 0.0 ];
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(textureCoords), gl.STATIC_DRAW);
	sagittalTextureCoordBuffer.itemSize = 2;
	sagittalTextureCoordBuffer.numItems = 4;
	gl.vertexAttribPointer(shaderPrograms['slice'].textureCoordAttribute, sagittalTextureCoordBuffer.itemSize, gl.FLOAT, false, 0, 0);

	var sagittalVertexIndexBuffer = gl.createBuffer();
	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, sagittalVertexIndexBuffer);
	var vertexIndices = [ 0, 1, 2, 0, 2, 3 ];
	gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(vertexIndices), gl.STATIC_DRAW);
	sagittalVertexIndexBuffer.itemSize = 1;
	sagittalVertexIndexBuffer.numItems = 6;

	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, getTexture(variables.scene.tex1, 'sagittal', variables.scene.sagittal));
	gl.uniform1i(shaderPrograms['slice'].samplerUniform, 0);

	if (variables.scene.tex2 != "none") {
		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, getTexture(variables.scene.tex2, 'sagittal', variables.scene.sagittal));
		gl.uniform1i(shaderPrograms['slice'].samplerUniform1, 1);
	}

	gl.drawElements(gl.TRIANGLES, sagittalVertexIndexBuffer.numItems, gl.UNSIGNED_SHORT, 0);

	gl.disable(gl.BLEND);
	gl.enable(gl.DEPTH_TEST);

	gl.bindBuffer(gl.ARRAY_BUFFER, null);
	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
}

//***************************************************************************************************
//
// everything mouse related
//
//***************************************************************************************************/

function fixupMouse(event) {
	event = event || window.event;

	var e = {
		event : event,
		target : event.target ? event.target : event.srcElement,
		which : event.which ? event.which : event.button === 1 ? 1 : event.button === 2 ? 3 : event.button === 4 ? 2 : 1,
		x : event[0] ? event[0] : event.clientX,
		y : event[1] ? event[1] : event.clientY
	};

	if (event.offsetX) {
		// chrome case, should work
		e.fixedX = event.offsetX;
		e.fixedY = event.offsetY;
	} else {
		e.fixedX = e.x - findPosX(canvas);
		e.fixedY = e.y - findPosY(canvas);
	}

	return e;
}

function findPosX(obj) {
	var curleft = 0;
	if (obj.offsetParent)
		while (1) {
			curleft += obj.offsetLeft;
			if (!obj.offsetParent)
				break;
			obj = obj.offsetParent;
		}
	else if (obj.x)
		curleft += obj.x;
	return curleft;
}

function findPosY(obj) {
	var curtop = 0;
	if (obj.offsetParent)
		while (1) {
			curtop += obj.offsetTop;
			if (!obj.offsetParent)
				break;
			obj = obj.offsetParent;
		}
	else if (obj.y)
		curtop += obj.y;
	return curtop;
}

function handleMouseDown(event) {
	e = fixupMouse(event);

	if (e.which == 1) {
		variables.mouse.leftDown = true;
		mat4.set(variables.webgl.thisRot, variables.webgl.lastRot);
		Arcball.click(e.fixedX, e.fixedY);
		recordCommand("mouse", "leftDown", e.fixedX, e.fixedY);
	} else if (e.which == 2) {
		variables.mouse.middleDown = true;
		variables.mouse.screenMoveXold = variables.mouse.screenMoveX;
		variables.mouse.screenMoveYold = variables.mouse.screenMoveY;

		variables.mouse.midClickX = e.fixedX;
		variables.mouse.midClickY = e.fixedY;
		recordCommand("mouse", "middleDown", e.fixedX, e.fixedY);
	}
	event.preventDefault();
	redraw();
}

function handleMouseUp(event) {
	e = fixupMouse(event);
	if (e.which == 1) {
		variables.mouse.leftDown = false;
		recordCommand("mouse", "leftUp");
	} else if (e.which == 2) {
		variables.mouse.middleDown = false;
		recordCommand("mouse", "middleUp");
	}
	event.preventDefault();
	redraw();
}

function handleMouseMove(event) {
	e = fixupMouse(event);
	recordCommand("mouse", "move", e.fixedX, e.fixedY);
	if (variables.picking.showTooltips && !variables.mouse.leftDown && !variables.mouse.middleDown) {
		gl.bindFramebuffer(gl.FRAMEBUFFER, variables.webgl.rttFrameBuffer);
		drawPickScene();

		pickX = (variables.webgl.rttFrameBuffer.width / gl.viewportWidth) * e.fixedX;
		pickY = (variables.webgl.rttFrameBuffer.height / gl.viewportHeight) * (gl.viewportHeight - e.fixedY);

		pixel = new Uint8Array(1 * 1 * 4);
		gl.readPixels(pickX, pickY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
		var pickColor = [ pixel[0], pixel[1], pixel[2] ].join();

		if (variables.picking.pickArray[pickColor]) {
			if (variables.picking.oldPick != elements[variables.picking.pickArray[pickColor]].id) {
				//console.log(elements[variables.picking.pickArray[pickColor]].name);
				$(Viewer).trigger('pickChanged', {
					'id' : elements[variables.picking.pickArray[pickColor]].id,
					'name' : elements[variables.picking.pickArray[pickColor]].name,
					'event' : e
				});
				variables.picking.oldPick = elements[variables.picking.pickArray[pickColor]].id;
			}
		} else {
			if (variables.picking.oldPick != "none") {
				$(Viewer).trigger('pickChanged', {
					'id' : "none",
					'name' : "none"
				});
				variables.picking.oldPick = "none";
			}
		}
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);

		return;
	}

	$(Viewer).trigger('pickChanged', {
		'id' : "none",
		'name' : "none"
	});
	variables.picking.oldPick = "none";

	if (variables.mouse.leftDown) {
		Arcball.drag(e.fixedX, e.fixedY);
		mat4.set(Arcball.get(), variables.webgl.thisRot);
		mat4.multiply(variables.webgl.lastRot, variables.webgl.thisRot, variables.webgl.thisRot);
		$.each(elements.meshes, function() {
			if (this.display) {
				this.dirty = true;
			}
		});
		$.each(elements.fibres, function() {
			if (this.display) {
				this.dirty = true;
			}
		});
		
	} else if (variables.mouse.middleDown) {
		variables.mouse.screenMoveX = variables.mouse.midClickX - e.fixedX + variables.mouse.screenMoveXold;
		variables.mouse.screenMoveY = variables.mouse.midClickY - e.fixedY + variables.mouse.screenMoveYold;
	}
	event.preventDefault();
	redraw();
}

function handleMouseWheel(e) {
	e = e ? e : window.event;
	wheelData = e.detail ? e.detail * -1 : e.wheelDelta / 40;
	if (variables.mouse.middleDown) {
		e.preventDefault();
		return;
	}
	if (wheelData < 0) {
		recordCommand("mouse", "wheel", -1);
		if ( variables.scene.zoom <= 1 ) {
			variables.scene.zoom -= 0.1;
		}
		else {
			variables.scene.zoom -= 0.5;
		}
	} else {
		recordCommand("mouse", "wheel", 0.5);
		if ( variables.scene.zoom <= 1 ) {
			variables.scene.zoom += 0.1;
		}
		else {
			variables.scene.zoom += 0.5;
		}
	}
	if (variables.scene.zoom < 0.5) {
		variables.scene.zoom = 0.5;
	}
	e.preventDefault();
	redraw();
}

//***************************************************************************************************
//
// functions for recording user input and replaying recordings
//
//***************************************************************************************************/
function initRecording() {
	variables.recording.recordSaving = true;
	variables.mouse.leftDown = false;
	$("#recordButton").val("Stop Recording");

	variables.recording.startTime = new Date();
	variables.recording.record.startTime = variables.recording.startTime.getTime();
	console.log("start time: " + variables.recording.record.startTime);

	variables.recording.record.startRot = mat4.create();
	variables.recording.record.startRot.set(variables.webgl.thisRot);

	variables.recording.record.axial = variables.scene.axial;
	variables.recording.record.coronal = variables.scene.coronal;
	variables.recording.record.sagittal = variables.scene.sagittal;
	variables.recording.record.colorTextures = variables.scene.colTex;
	variables.recording.record.localFibreColor = variables.scene.localFibreColor;

	variables.recording.record.commands = [];

	variables.recording.record.activeElements = [];

	$.each(elements, function() {
		if (this.display && this.type != "control") {
			variables.recording.record.activeElements.push(this.id);
		}
	});
}

function endRecording() {
	variables.recording.recordSaving = false;
	variables.mouse.leftDown = false;

	endTime = new Date();
	variables.recording.record.endTime = endTime.getTime();

	command = {};

	command.time = variables.recording.record.endTime;
	command.relTime = command.time - variables.recording.record.startTime;

	command.type = "end";

	variables.recording.record.commands.push(command);
	console.log("end time: " + variables.recording.record.endTime);
	console.log("recorded time: " + (variables.recording.record.endTime - variables.recording.record.startTime));
	$("#recordButton").val( "Record" );
}

function playRecording() {
	console.log("play recording ");
	variables.recording.recordPlaying = true;
	variables.mouse.leftDown = false;

	variables.webgl.lastRot = mat4.create();
	mat4.identity(variables.webgl.lastRot);
	variables.webgl.thisRot.set(variables.recording.record.startRot);

	variables.scene.axial = variables.recording.record.axial;
	variables.scene.coronal = variables.recording.record.coronal;
	variables.scene.sagittal = variables.recording.record.sagittal;
	variables.scene.colTex = variables.recording.record.colorTextures;
	variables.scene.localFibreColor = variables.recording.record.localFibreColor;

	$.each(elements, function(id, element) {
		hideElement(id);
	});

	$.each(variables.recording.record.activeElements, function(id, element) {
		showElement(element);
	});

	redraw();
	variables.recording.playStep = 0;
	playInterval();
}

function playInterval() {
	if (variables.recording.playStep >= variables.recording.record.commands.length || variables.recording.record.commands[variables.recording.playStep].type == "end") {
		console.log("finished playing recording");
		variables.recording.recordPlaying = false;
		variables.mouse.leftDown = false;
		return;
	}

	var c = variables.recording.record.commands[variables.recording.playStep];
	console.log(c.relTime + " " + c.type + " " + c.what + " " + c.arg1 + " " + c.arg2);

	switch (c.type) {
		case "mouse":
			switch (c.what) {
				case "leftDown":
					playMouseDown(1, c.arg1, c.arg2);
					break;
				case "middleDown":
					playMouseDown(2, c.arg1, c.arg2);
					break;
				case "leftUp":
					playMouseUp(1);
					break;
				case "middleUp":
					playMouseUp(2);
					break;
				case "move":
					playMouseMove(c.arg1, c.arg2);
					break;
				case "wheel":
					playMouseWheel(c.arg1);
				default:
					break;
			}
			break;
		case "element":
			switch (c.what) {
				case "toggle":
					if (c.arg1 != "control_toggle_recording")
						toggleElement(c.arg1);
					break;
				case "show":
					showElement(c.arg1);
					break;
				case "hide":
					hideElement(c.arg1);
					break;
			}
			break;
		case "slice":
			switch (c.what) {
				case "axial":
					setAxial(c.arg1);
					break;
				case "coronal":
					setCoronal(c.arg1);
					break;
				case "sagittal":
					setSagittal(c.arg1);
					break;
			}
			break;
		case "texture":
			//setColorTextures(c.arg1)
			break;
	}
	++variables.recording.playStep;
	setTimeout(playInterval, variables.recording.record.commands[variables.recording.playStep].relTime - c.relTime);
}

function recordCommand() {
	if (!variables.recording.recordSaving)
		return;

	command = {};

	commandTime = new Date();
	command.time = commandTime.getTime();
	command.relTime = command.time - variables.recording.record.startTime;

	command.type = arguments[0];
	command.what = arguments[1];
	command.arg1 = arguments[2];
	command.arg2 = arguments[3];

	variables.recording.record.commands.push(command);
}

function playMouseDown(which, x, y) {
	if (which == 1) {
		variables.mouse.leftDown = true;
		mat4.set(variables.webgl.thisRot, variables.webgl.lastRot);
		Arcball.click(x, y);
	} else if (which == 2) {
		variables.mouse.middleDown = true;
		variables.mouse.screenMoveXold = variables.mouse.screenMoveX;
		variables.mouse.screenMoveYold = variables.mouse.screenMoveY;

		variables.mouse.midClickX = x;
		variables.mouse.midClickY = y;
	}
	redraw();
}

function playMouseUp(which) {
	if (which == 1)
		variables.mouse.leftDown = false;
	else if (which == 2)
		variables.mouse.middleDown = false;
	redraw();
}

function playMouseMove(x, y) {
	if (variables.picking.showTooltips && !variables.mouse.leftDown && !variables.mouse.middleDown) {
		gl.bindFramebuffer(gl.FRAMEBUFFER, variables.webgl.rttFrameBuffer);
		drawPickScene();

		pickX = (variables.webgl.rttFrameBuffer.width / gl.viewportWidth) * x;
		pickY = (variables.webgl.rttFrameBuffer.height / gl.viewportHeight) * (gl.viewportHeight - y);

		pixel = new Uint8Array(1 * 1 * 4);
		gl.readPixels(pickX, pickY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
		var pickColor = [ pixel[0], pixel[1], pixel[2] ].join();

		if (variables.picking.pickArray[pickColor]) {
			if (variables.picking.oldPick != elements[variables.picking.pickArray[pickColor]].id) {
				//console.log(elements[variables.picking.pickArray[pickColor]].name);
				$(Viewer).trigger('pickChanged', {
					'id' : elements[variables.picking.pickArray[pickColor]].id,
					'name' : elements[variables.picking.pickArray[pickColor]].name,
					'event' : e
				});
				variables.picking.oldPick = elements[variables.picking.pickArray[pickColor]].id;
			}
		} else {
			if (variables.picking.oldPick != "none") {
				$(Viewer).trigger('pickChanged', {
					'id' : "none",
					'name' : "none"
				});
				variables.picking.oldPick = "none";
			}
		}
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);

		return;
	}

	$(Viewer).trigger('pickChanged', {
		'id' : "none",
		'name' : "none"
	});
	variables.picking.oldPick = "none";

	if (variables.mouse.leftDown) {
		Arcball.drag(x, y);

		mat4.set(Arcball.get(), variables.webgl.thisRot);
		mat4.multiply(variables.webgl.lastRot, variables.webgl.thisRot, variables.webgl.thisRot);
	} else if (variables.mouse.middleDown) {
		variables.mouse.screenMoveX = variables.mouse.midClickX - x + variables.mouse.screenMoveXold;
		variables.mouse.screenMoveY = variables.mouse.midClickY - y + variables.mouse.screenMoveYold;
	}
	redraw();
}

function playMouseWheel(value) {
	variables.scene.zoom += value;
	if (variables.scene.zoom < 1)
		variables.scene.zoom = 1;
	redraw();
}

//***************************************************************************************************
//
// public functions, getters and setters
//
//***************************************************************************************************/
function toggleElement(id) {
	if (id in elements.meshes) {
		elements.meshes[id].display = !elements.meshes[id].display;
		$(Viewer).trigger('elementDisplayChange', {
			'id' : id,
			'active' : elements.meshes[id].display
		});
	}
	else if (id in elements.fibres) {
		elements.fibres[id].display = !elements.fibres[id].display;
		$(Viewer).trigger('elementDisplayChange', {
			'id' : id,
			'active' : elements.fibres[id].display
		});
	}
	else {
		console.warn('Element "' + id + '" is unknown.');
		return false;
	}
	
	recordCommand("element", "toggle", id);
	redraw();
}

function toggleRecording() {
	variables.recording.recordSaving ? endRecording() : initRecording();
}


function showElement(id) {
	if (!(id in elements)) {
		console.warn('Element "' + id + '" is unknown.');
		return false;
	}
	elements[id].display = true;
	$(Viewer).trigger('elementDisplayChange', {
		'id' : id,
		'active' : true
	});
	recordCommand("element", "show", id);
	redraw();
}

function hideElement(id) {
	if (!(id in elements)) {
		console.warn('Element "' + id + '" is unknown.');
		return false;
	}
	elements[id].display = false;
	$(Viewer).trigger('elementDisplayChange', {
		'id' : id,
		'active' : false
	});
	recordCommand("element", "hide", id);
	redraw();
}

function toggleActivation(id) {
	if (id in elements.activations) {
		elements.activations[id].display = !elements.activations[id].display;
		$(Viewer).trigger('activationDisplayChange', {
			'id' : id,
			'active' : elements.activations[id].display
		});
	}
	else if (id in elements.connections) {
		elements.connections[id].display = !elements.connections[id].display;
		$(Viewer).trigger('activationDisplayChange', {
			'id' : id,
			'active' : elements.connections[id].display
		});
	}
	else {
		console.warn('Activation "' + id + '" is unknown.');
		return false;
	}
	recordCommand("element", "toggle", id);
	redraw();
}

function showActivation(id) {
	if (!(id in elements)) {
		console.warn('Activation "' + id + '" is unknown.');
		return false;
	}
	elements[id].display = true;
	$(Viewer).trigger('activationDisplayChange', {
		'id' : id,
		'active' : true
	});
	recordCommand("element", "show", id);
	redraw();
}

function hideActivation(id) {
	if (!(id in elements)) {
		console.warn('Activation "' + id + '" is unknown.');
		return false;
	}
	elements[id].display = false;
	$(Viewer).trigger('activationDisplayChange', {
		'id' : id,
		'active' : false
	});
	recordCommand("element", "hide", id);
	redraw();
}

function setAxial(position) {
	if (position < 0)
		position = 0;
	if (position > 255)
		position = 255;
	variables.scene.axial = parseFloat(position);
	recordCommand("slice", "axial", position);
	redraw();
}

function setCoronal(position) {
	if (position < 0)
		position = 0;
	if (position > 255)
		position = 255;
	variables.scene.coronal = parseFloat(position);
	recordCommand("slice", "coronal", position);
	redraw();
}

function setSagittal(position) {
	if (position < 0)
		position = 0;
	if (position > 255)
		position = 255;
	variables.scene.sagittal = parseFloat(position);
	recordCommand("slice", "sagittal", position);
	redraw();
}

function getAxial() {
	return variables.scene.axial;
}

function getCoronal() {
	return variables.scene.coronal;
}

function getSagittal() {
	return variables.scene.sagittal;
}

function updateSize() {
	gl.viewportWidth = $canvas.width();
	gl.viewportHeight = $canvas.height();
	Arcball.set_win_size(gl.viewportWidth, gl.viewportHeight);
	redraw();
}

function bind(event, callback) {
	$(Viewer).bind(event, callback);
}

function saveScene() {
	//console.log( JSON.stringify(variables));
	var activs = [];
    $.each(elements, function() {
        if (this.display) {
             activs.push(this.id);
        }
    });
    variables.scene.activ = activs;
	variables.connectom.animate = false;
	
	return JSON.stringify(variables);
}

function loadScene( saveString ) {
	var loadData;
	
	if (saveString != "") {
		try {
			loadData = JSON.parse(saveString);
		}
		catch(e) {
			alert("Error while loading");
			return;
		}
	}
	else {
		alert("Nothing to load!");
		return;
	}

	
	variables.webgl.thisRot.set(loadData.webgl.thisRot);
	variables.scene = loadData.scene;
	
	variables.connectom = loadData.connectom;

	$.each(loadData.connectom.activations, function() {
		createActivation(this.id, this.name, this.co[0], this.co[1], this.co[2], this.size, this.rgb.r, this.rgb.g, this.rgb.b );
		$(Viewer).trigger('newActivation', {
			'id' : this.id,
			'name' : this.name,
			'active' : true
		});
	});
	
	$.each(loadData.connectom.connections, function() {
		elements[this.id] = {};
		createConnection(this.id, this.name, this.cof, this.cot, this.color, this.strength, this.size, this.distance, this.speed, this.barShift);
		$(Viewer).trigger('newConnection', {
			'id' : this.id,
			'name' : this.name,
			'active' : false
		});
	});
	
	$.each(elements, function(id, element) {
		hideElement(id);
	});
	$.each(loadData.scene.activ, function() {
		showElement(this);
	});
	redraw();
}

function createActivation( id, name, x, y, z, size, r, g, b )
{
	var cof = tal2pixel(x, y, z);
	newActiv = createSphere(cof[0], cof[1], cof[2], size, {"r": r, "g": g, "b": b});
	newActiv.name = name;
	newActiv.co = cof;
	newActiv.type = 'activation';
	newActiv.display = false;
	newActiv.id = id;
	newActiv.hasBuffer = false;
	newActiv.fromJSON = false;
	newActiv.transparency = 1.0;
	
	newActiv.coordinates = [x,y,z];
	newActiv.size = size;
	newActiv.rgb = {"r": r, "g": g, "b": b};
	pickColor = createPickColor(variables.picking.pickIndex);
	variables.picking.pickIndex++;
	variables.picking.pickArray[pickColor.join()] = id;
	pc = [];
	pc[0] = pickColor[0] / 255;
	pc[1] = pickColor[1] / 255;
	pc[2] = pickColor[2] / 255;
	newActiv.pickColor = pc;
	
	elements.activations[id] = newActiv;
}

function addActivation( name, x, y, z, size, r, g, b ) {
	var id = 'ca' + variables.connectom.activationIndex;
	++variables.connectom.activationIndex;
	
	createActivation( id, name, x, y, z, size, r, g, b );
	
	$(Viewer).trigger('newActivation', {
		'id' : id,
		'name' : name,
		'active' : true
	});
	
	var saveAct = {};
    saveAct.id = id;
    saveAct.name = name;
    saveAct.co = elements.activations[id].coordinates;
    saveAct.size = size;
    saveAct.rgb = elements.activations[id].rgb;
    variables.connectom.activations[id] = saveAct;
    
    redraw();
}

function addConnection( fromId, toId, color, strength, size, distance, speed, color2, strength2, size2, distance2, speed2, display )
{
	var name = elements.activations[fromId].name + "-" + elements.activations[toId].name;
	var name2 = elements.activations[toId].name + "-" + elements.activations[fromId].name;
	var id = 'cc' + variables.connectom.connectionIndex;
	++variables.connectom.connectionIndex;
	var id2 = 'cc' + variables.connectom.connectionIndex;
	++variables.connectom.connectionIndex;
	var cofp = elements.activations[fromId].coordinates;
	var cotp = elements.activations[toId].coordinates;
	var cof = tal2pixel(cofp[0], cofp[1], cofp[2]);
	var cot = tal2pixel(cotp[0], cotp[1], cotp[2]);
	
	elements.connections[id] = {};
	elements.connections[id].fromId = fromId;
	elements.connections[id].toId = toId;
	createConnection(id, name, cof, cot, color, strength, size, distance, speed, -strength, display);
	elements.connections[id2] = {};
	elements.connections[id2].fromId = toId;
	elements.connections[id2].toId = fromId;
	elements.connections[id2].coId = id;
	elements.connections[id].coId = id2;
	createConnection(id2, name2, cot, cof, color2, strength2, size2, distance2, speed2, strength2, display);
	
	$(Viewer).trigger('newConnection', {
		'id' : id,
		'name' : name,
		'active' : true
	});
	
	$(Viewer).trigger('newConnection', {
		'id' : id2,
		'name' : name2,
		'active' : true
	});
	
	var saveCon = {};
    saveCon.id = id;
    saveCon.name = elements.connections[id].name;
    saveCon.cof = cof;
    saveCon.cot = cot;
    saveCon.strength = strength;
    saveCon.size = size;
    saveCon.distance = distance;
    saveCon.speed = speed;
    saveCon.color = color;
    saveCon.fromId = fromId;
    saveCon.toId = toId;
    saveCon.barShift = -strength;
    variables.connectom.connections[id] = saveCon;
    
    var saveCon2 = {};
    saveCon2.id = id2;
    saveCon2.name = elements.connections[id2].name;
    saveCon2.cof = cot;
    saveCon2.cot = cof;
    saveCon2.strength = strength2;
    saveCon2.size = size2;
    saveCon2.distance = distance2;
    saveCon2.speed = speed2;
    saveCon2.color = color2;
    saveCon2.fromId = toId;
    saveCon2.toId = fromId;
    saveCon2.barShift = strength2;
    variables.connectom.connections[id2] = saveCon2;
    
    redraw();
}

function createConnection(id, name, cof, cot, color, strength, size, distance, speed, barShift, display)
{
	elements.connections[id].vertices = [cof[0],cof[1],cof[2],cot[0],cot[1],cot[2]];
	elements.connections[id].indices = [];
	elements.connections[id].indices.push(2);
	
	elements.connections[id].id = id;
	elements.connections[id].name = name;
	elements.connections[id].type = 'connection';
	elements.connections[id].display = display;
	elements.connections[id].transparency = 1.0;
	elements.connections[id].hasBuffer = false;
	pickColor = createPickColor(variables.picking.pickIndex);
	variables.picking.pickArray[pickColor.join()] = id;
	variables.picking.pickIndex++;
	pc = [];
	pc[0] = pickColor[0] / 255;
	pc[1] = pickColor[1] / 255;
	pc[2] = pickColor[2] / 255;
	elements.connections[id].pickColor = pc;

	
	tubeVertices = [];
	tubeTexCoords = [];
	tubeColors = [];

	for ( var m = 0; m < elements.connections[id].vertices.length / 3; ++m) {
		tubeVertices.push(elements.connections[id].vertices[3 * m]);
		tubeVertices.push(elements.connections[id].vertices[3 * m + 1]);
		tubeVertices.push(elements.connections[id].vertices[3 * m + 2]);
		tubeVertices.push(elements.connections[id].vertices[3 * m]);
		tubeVertices.push(elements.connections[id].vertices[3 * m + 1]);
		tubeVertices.push(elements.connections[id].vertices[3 * m + 2]);
	}
	tubeTexCoords.push(1.0);
	tubeTexCoords.push(0.0);
	tubeTexCoords.push(-1.0);
	tubeTexCoords.push(0.0);
	tubeTexCoords.push(1.0);
	tubeTexCoords.push(1.0);
	tubeTexCoords.push(-1.0);
	tubeTexCoords.push(1.0);
	

	elements.connections[id].tubeVertices = tubeVertices;
	elements.connections[id].tubeTexCoords = tubeTexCoords;

	var tubeNormals = [];
	
	var x1 = elements.connections[id].vertices[0];
	var y1 = elements.connections[id].vertices[1];
	var z1 = elements.connections[id].vertices[2];
	var x2 = elements.connections[id].vertices[3];
	var y2 = elements.connections[id].vertices[4];
	var z2 = elements.connections[id].vertices[5];

	var nx = x1 - x2;
	var ny = y1 - y2;
	var nz = z1 - z2;

	for (var i=0; i <4; ++i) {
		tubeNormals.push(nx);
		tubeNormals.push(ny);
		tubeNormals.push(nz);
	}
	elements.connections[id].tubeNormals = tubeNormals;
	elements.connections[id].normals = tubeNormals;

	elements.connections[id].color = color;
	elements.connections[id].colors = [1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0,1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0];
	elements.connections[id].tubeColors = [1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0,1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0];
	elements.connections[id].strength = strength;
	elements.connections[id].size = size;
	elements.connections[id].distance = distance;
	elements.connections[id].speed = speed;
	elements.connections[id].barShift = barShift;
	
	elements.connections[id].length = Math.sqrt( nx*nx + ny*ny + nz*nz);
}

function toggleAnimation() {
	if (variables.connectom.animate) {
		clearInterval(variables.connectom.animationInterval);
		variables.connectom.animate = false;
	}
	else {
		variables.connectom.animationInterval = setInterval(animateConnections, 30);
		variables.connectom.animate = true;
	}
}

function animateConnections() {
	++variables.connectom.timestep;
	redraw();
}

function getActivation(id) {
	return elements.activations[id];
}

function getConnection(id) {
	return elements.connections[id];
}

var rotation = false;
var centerX = 0;
var centerY = 0;
var rotFrames = 0;
var animX = 0;
var animY = 0;
function autoRotate(aniX, aniY, steps, frames ) {
	console.log(aniX+ " " + aniY+ " " +  steps+ " " +  frames );
	if ( rotation ) {
		clearInterval(variables.webgl.preloadTextures);
		rotation = false;
		variables.transition.transitionOngoing = false;
		return;
	}
	animX = aniX;
	animY = aniY;
	centerX = canvas.width /2.0;
	centerY = canvas.height/2.0;
	
	variables.transition.transitionOngoing = true;
	rotation = true;
	mat4.set(variables.webgl.thisRot, variables.webgl.lastRot);
	Arcball.click(centerX, centerY);
	variables.webgl.preloadTextures = setInterval(autoRotateInterval, steps);
	rotFrames = frames;
}

function autoRotateInterval() {
	if ( rotFrames <= 0 ) {
		clearInterval(variables.webgl.preloadTextures);
		rotation = false;
		variables.transition.transitionOngoing = false;
		return;
	}
	console.log("rotation step");
	Arcball.drag(centerX+animX, centerY+animY);
	mat4.set(Arcball.get(), variables.webgl.thisRot);
	mat4.multiply(variables.webgl.lastRot, variables.webgl.thisRot, variables.webgl.thisRot);
	redraw();
	mat4.set(variables.webgl.thisRot, variables.webgl.lastRot);
	Arcball.click(centerX, centerY);
	--rotFrames;
}

function changeTexture(id) {
	variables.scene.tex1 = id;
	redraw();
}

function changeTexture2(id) {
	variables.scene.tex2 = id;

	var t1min = 0;
	var t1max = 0;
	var t1step = 0;
	var t2min = 0;
	var t2max = 0;
	var t2step = 0;
	if ( id === 'none') {
		variables.scene.colormap = 0;
	}
	else {
		t1min = elements.niftiis[id].getMin();
		t1max = 0;
		t1step = elements.niftiis[id].getMin() / 100 * -1.0;
		t2min = 0;
		t2max = elements.niftiis[id].getMax();
		t2step = elements.niftiis[id].getMax() / 100;
	
		if ( elements.niftiis[id].getType() === 'anatomy' || elements.niftiis[id].getType() === 'rgb' ) {
			variables.scene.colormap = 0;
		}
		else if ( elements.niftiis[id].getType() === 'fmri' ) {
			variables.scene.colormap = 1;
		}
		else if ( elements.niftiis[id].getType() === 'overlay' ) {
			variables.scene.colormap = 3;
		}
	}
	
	$(Viewer).trigger('colormapChanged', {
		'id' : variables.scene.colormap,
		't1' : variables.scene.texThreshold1,
		't1min' : t1min,
		't1max' : t1max,
		't1step' : t1step,
		't2' : variables.scene.texThreshold2,
		't2min' : t2min,
		't2max' : t2max,
		't2step' : t2step
	});
	
	redraw();
}

function changeColormap(id) {
	variables.scene.colormap = id;
	redraw();
}

function setThreshold1(value) {
	variables.scene.texThreshold1 = value;
	redraw();
}

function setThreshold2(value) {
	variables.scene.texThreshold2 = value;
	redraw();
}

function recalcFibres() {
	
	$.each(elements, function() {
		if (this.type == 'fibre' && this.display) {
			this.activFibres = new Array( this.indices.length );
			for (var i = 0; i < this.activFibres.length; ++i ) {
				this.activFibres[i] = false;
			}
		}
	});
	
	$.each(elements, function() {
		if (this.type == 'activation' && this.display) {
			var co = this.co;
			var size = this.size / 2;
			
			$.each(elements, function() {
				if (this.type == 'fibre' && this.display) {
											
					
					lineStart = 0;
					for ( var i = 0; i < this.indices.length; ++i) {
						for(var j = lineStart; j < lineStart+ this.indices[i]; ++j) {
							var xd = co[0] - this.vertices[j*3];
							var yd = co[1] - this.vertices[j*3+1];
							var zd = co[2] - this.vertices[j*3+2];
							if ( Math.sqrt( xd*xd + yd*yd + zd*zd) < size ) {
								this.activFibres[i] = true;
							}
						}
						lineStart += this.indices[i];
					}
				}
			});		
			
		}
	});
}

function resetFibres() {
	$.each(elements, function() {
		if (this.type == 'fibre') {
			this.activFibres = new Array( this.indices.length );
			for (var i = 0; i < this.activFibres.length; ++i ) {
				this.activFibres[i] = true;
			}
		}
	});
}

function setAlpha2(value) {
	variables.scene.texAlpha2 = value;
	redraw();
}

function getElementAlpha(id) {
	if ( elements.meshes[id] ) {
		return elements.meshes[id].transparency;
	}
	if ( elements.fibres[id] ) {
		return elements.fibres[id].transparency;
	}
}

function setElementAlpha(id, alpha) {
	if ( elements.meshes[id] ) {
		elements.meshes[id].transparency = alpha;
	}
	if ( elements.fibres[id] ) {
		elements.fibres[id].transparency = alpha;
	}
	redraw();
}

function screenshot() {
	var img = canvas.toDataURL("image/png");
	document.location.href = img.replace("image/png", "image/octet-stream");
}

var isVideoRecording = false;
var frameCount = 0;
function toggleVideoRecording() {
	if ( !isVideoRecording ) {
		frameCount = 0;
		variables.scene.videoRecordingInterval = setInterval(recordVideo, 50);
		isVideoRecording = true;
	}
	else {
		clearInterval( variables.scene.videoRecordingInterval );
		isVideoRecording = false;
	}
}

function recordVideo() {
	var data = canvas.toDataURL();
	
	var request = $.ajax({
	  url: "http://127.0.0.1:8080",
	  type: "POST",
	  data: "data=" + data + '&frame=' + frameCount,
	  dataType: "image/png"
	});

	request.done(function(msg) {
	  console.log( msg );
	});

	request.fail(function(jqXHR, textStatus) {
	  console.log( "Request failed: " + textStatus );
	});
	++frameCount;
}

function control(id) {
	switch (id) {
	case "fibreColor":
		variables.scene.localFibreColor = !variables.scene.localFibreColor;
		break;
	case "fibreTubes":
		variables.scene.renderTubes = !variables.scene.renderTubes;
		break;				
	case "tooltips":
		variables.picking.showTooltips = !variables.picking.showTooltips;
		break;
	case "slices":
		variables.scene.showSlices = !variables.scene.showSlices;
		break;
	case "interpolation":
		variables.scene.texInterpolation = !variables.scene.texInterpolation;
		textures = {};
		$.each(elements.niftiis, function() {
			elements.textures[this.id] = {};
		});
		break;
	case "recalcFibers":
		recalcFibres();
		break;
	case "resetFibers":
		resetFibres();
		break;
	case "animate":
		toggleAnimation();
		break;
	case "toggleRecording" :
		toggleRecording();
		break;
	case "playRecording" :
		playRecording();
		break;
	case "screenshot" :
		screenshot();
		break;
	case "updateSize" :
		updateSize();
		break;
	case "video" :
			toggleVideoRecording();
			break;
		default:
		}
		redraw();
}
	
	// Im Viewer-Singleton werden nur die im folgenden aufgefhrten
// Methoden/Eigenschaften nach
// auen sichtbar gemacht.
return {
	'init' : init,
	'bind' : bind,
	'toggleElement' : toggleElement,
	'showElement' : showElement,
	'hideElement' : hideElement,
	'toggleActivation' : toggleActivation,
	'activateScene' : activateScene,
	'activateView' : activateView,
	'setAxial' : setAxial,
	'setCoronal' : setCoronal,
	'setSagittal' : setSagittal,
	'getAxial' : getAxial,
	'getCoronal' : getCoronal,
	'getSagittal' : getSagittal,
	
	'saveScene' : saveScene,
	'loadScene' : loadScene,
	'autoRotate' : autoRotate,
	
	'getActivation' : getActivation,
	'getConnection' : getConnection,
	
	'changeTexture' : changeTexture,
	'changeTexture2' : changeTexture2,
	'changeColormap' : changeColormap,
	'setThreshold1' : setThreshold1,
	'setThreshold2' : setThreshold2,
	'setAlpha2' : setAlpha2,
	'getElementAlpha' : getElementAlpha,
	'setElementAlpha' : setElementAlpha,
	'control' : control,
	'pickInfo' : variables.picking,
	'elements' : elements
};
})();

