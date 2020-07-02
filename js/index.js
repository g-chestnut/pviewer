/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
var UPSTREAM_DOMAIN = "upstream.";
var SERVER_DOMAIN = UPSTREAM_DOMAIN;
var CAPTURE_DOMAIN = UPSTREAM_DOMAIN + UPSTREAM_DOMAIN;
var DRIVER_DOMAIN = UPSTREAM_DOMAIN + UPSTREAM_DOMAIN + UPSTREAM_DOMAIN;
var PT_STATUS = 100;
var PT_CMD = 101;
var PT_FILE = 102;
var PT_CAM_BASE = 110;
var PT_AUDIO_BASE = 120;
var P2P_API_KEY = "v8df88o1y4zbmx6r";
var PUBLIC_VIEWER = "http://picam360.github.io/picam360-viewer/";
var SIGNALING_HOST = "peer.picam360.com";
var SIGNALING_PORT = 443;
var SIGNALING_SECURE = true;

var app = (function() {
	var tilt = 0;
	var socket;
	var m_view_fov = 120;
	var auto_scroll = false;
	var view_offset_lock = false;
	var m_afov = false;
	var m_fpp = false;
	var m_vertex_type = "";
	var debug = 0;

	var m_pstcore = null;
	// main canvas
	var m_canvas;
	// overlay
	var m_overlay;
	var m_menu_str;
	var m_info_str;
	// webgl handling
	//TODO:var m_video_handler;
	// audio handling
	var m_audio_handler = null;
	// data stream handling
	var rtp;
	var rtcp;
	//TODO:var m_vpm_loader = null;
	// video decoder
	//TODO:var m_image_decoder = null;
	var opus_decoder;
	var audio_first_packet_s = 0;
	// motion processer unit
	var mpu;

	var server_url = window.location.href.split('?')[0];
	var m_options = {};
	var plugins = [];
	var watches = [];
	var statuses = [];
	var is_recording = false;
	var view_offset = new THREE.Quaternion();
	var p2p_num_of_members = 0;
	var peer_call = null;
	var p2p_uuid_call = "";
	var default_image_url = null;

	var cmd2upstream_list = [];
	var filerequest_list = [];

	var m_frame_active = false;
	var m_menu_visible = false;
	var m_upstream_info = "";
	var m_upstream_menu = "";
	
	var m_pc = null;

	function set_is_recording(value) {
		if (is_recording != value) {
			is_recording = value;
			if (is_recording) {
				document.getElementById('imgRec').src = "img/stop_record_icon.png";
			} else {
				document.getElementById('imgRec').src = "img/start_record_icon.png";
			}
		}
	}
	
	function parseBoolean(str) {
		return str == "yes" || str == "on" || str == "true" || str == "1";
	}

	function GetQueryString() {
		var result = {};
		if (1 < window.location.search.length) {
			var query = window.location.search.substring(1);
			var parameters = query.split('&');

			for (var i = 0; i < parameters.length; i++) {
				var element = parameters[i].split('=');

				var paramName = decodeURIComponent(element[0]);
				var paramValue = decodeURIComponent(element[1]);

				result[paramName] = paramValue;
			}
		}
		return result;
	}
	var query = GetQueryString();

	function execCopy(string) {
		var temp = document.createElement('textarea');

		temp.value = string;
		temp.selectionStart = 0;
		temp.selectionEnd = temp.value.length;

		var s = temp.style;
		s.position = 'fixed';
		s.left = '-100%';

		document.body.appendChild(temp);
		temp.focus();
		var result = document.execCommand('copy');
		temp.blur();
		document.body.removeChild(temp);
		return result;
	}

	function uuid() {
		var uuid = "",
			i, random;
		for (i = 0; i < 32; i++) {
			random = Math.random() * 16 | 0;

			if (i == 8 || i == 12 || i == 16 || i == 20) {
				uuid += "-"
			}
			uuid += (i == 12 ? 4 : (i == 16 ? (random & 3 | 8) : random))
				.toString(16);
		}
		return uuid;
	}

	function loadFile(path, callback) {
		var req = new XMLHttpRequest();
		req.responseType = "arraybuffer";
		req.open("get", path, true);
		req.send(null);

		req.onload = function() {
			callback([new Uint8Array(req.response)]);
		}
	}

	// interface for plugin
	function PluginHost(core) {

		function downloadAsFile(fileName, url) {
			var a = document.createElement('a');
			a.download = fileName;
			a.href = url;
			// a.target = "_blank";
			a.click();
		};

		function handle_command(cmd) {
			var split = cmd.split(' ');
			if (split[0] == "set_stereo") {
				self.set_stereo(split[1] == "true" || split[1] == "1");
			}
		}

		var self = {
			get_timediff_ms: function() {
				return core.timediff_ms;
			},
			get_plugin: function(name) {
				for (var i = 0; i < plugins.length; i++) {
					if (name == plugins[i].name) {
						return plugins[i];
					}
				}
				return null;
			},
			send_command: function(cmd, update) {
				if (cmd.indexOf(UPSTREAM_DOMAIN) == 0) {
					cmd = cmd.substr(UPSTREAM_DOMAIN.length);
					if(update){
						for (var i = 0; i < cmd2upstream_list.length; i++) {
							if(cmd2upstream_list[i].update){
								var cmd_s1 = cmd.split(' ')[0];
								var cmd_s2 = cmd2upstream_list[i].cmd.split(' ')[0];
								if(cmd_s1 == cmd_s2){
									cmd2upstream_list[i] = {cmd, update};
									return;
								}
							}
						}
					}
					cmd2upstream_list.push({cmd, update});
					return;
				}
				for (var i = 0; i < plugins.length; i++) {
					if (plugins[i].command_handler) {
						plugins[i].command_handler(cmd, update);
					}
				}
				handle_command(cmd, update);
			},
			send_event: function(sender, event) {
				for (var i = 0; i < plugins.length; i++) {
					if (plugins[i].event_handler) {
						plugins[i].event_handler(sender, event);
					}
				}
			},
			add_watch: function(name, callback) {
				watches[name] = callback;
			},
			get_view_quaternion: function() {
				if (mpu) {
					return mpu.get_quaternion();
				} else {
					return new THREE.Quaternion();
				}
			},
			get_view_north: function() {
				if (mpu) {
					return mpu.get_north();
				} else {
					return 0;
				}
			},
			get_fov: function() {
				return m_view_fov;
			},
			set_fov: function(value) {
				m_view_fov = value;
			},
			set_stereo: function(value) {

				try{
					if (DeviceMotionEvent 
							&& DeviceMotionEvent.requestPermission
							&& typeof DeviceMotionEvent.requestPermission === 'function') {
						DeviceMotionEvent.requestPermission().then(response => {
							if (response === 'granted') {
								console.log("ok");
							}
						}).catch(console.error);
					}
				} catch {}
				
//TODO:				
//				m_video_handler.setStereoEnabled(value);
//				if(m_video_handler.vr_supported()){
//					self.set_audio(value);
//				}
				self.send_event("PLUGIN_HOST", value ?
					"STEREO_ENABLED" :
					"STEREO_DISABLED");

				var cmd = UPSTREAM_DOMAIN;
				cmd += "set_vstream_param -p stereo=" + (value ? 1 : 0);
				self.send_command(cmd);
			},
			set_audio: function(value) {
				m_audio_handler.setAudioEnabled(value);
				self.send_event("PLUGIN_HOST", value ?
					"AUDIO_ENABLED" :
					"AUDIO_DISABLED");
			},
			set_view_offset: function(value) {
				if (view_offset_lock) {
					return;
				}
				view_offset = value;
				auto_scroll = false;
			},
			get_view_offset: function() {
				return view_offset.clone();
			},
			snap: function() {
				var key = uuid();
				self.send_command(SERVER_DOMAIN + "snap " + key);
				filerequest_list.push({
					filename: 'picam360.jpeg',
					key: key,
					callback: function(chunk_array) {
						var blob = new Blob(chunk_array, {
							type: "image/jpeg"
						});
						var url = (URL || webkitURL || mozURL)
							.createObjectURL(blob);
						downloadAsFile('picam360.jpeg', url);
					}
				});
			},
			rec: function() {
				if (is_recording) {
					var key = uuid();
					self.send_command(SERVER_DOMAIN + "stop_record " + key);
					filerequest_list.push({
						filename: 'picam360.mp4',
						key: key,
						callback: function(chunk_array) {
							var blob = new Blob(chunk_array, {
								type: "video/mp4"
							});
							var url = (URL || webkitURL || mozURL)
								.createObjectURL(blob);
							downloadAsFile('picam360.mp4', url);
						}
					});
				} else {
					self.send_command(SERVER_DOMAIN + "start_record");
				}
			},
			call: function(bln) {
				if (bln) {
					core.start_call();
				} else {
					core.stop_call();
				}
			},
			log: function(str, level) {
				if (level && level <= debug) {
					console.log(str);
				}
			},
			set_menu_visible: function(bln) {
				// self.send_command(CAPTURE_DOMAIN + 'set_menu_visible ' +
				// (bln?'1':'0'));
				m_menu_visible = bln;
				if(bln){
					m_overlay.innerHTML = m_menu_str;
				}else{
					m_overlay.innerHTML = m_info_str;
				}
				if(m_overlay.innerHTML) {
					m_overlay.style.visibility = "visible";
				}else{
					m_overlay.style.visibility = "hidden";
				}
			},
			set_menu: function(str) {
				m_menu_str = str;
				m_overlay.innerHTML = str;
				self.set_menu_visible(m_menu_visible);
			},
			set_info: function(str) {
				m_info_str = str;
				m_overlay.innerHTML = str;
				self.set_menu_visible(m_menu_visible);
			},
			getFile: function(path, callback) {
				if (!query['force-local'] && core.connected()) {
					var key = uuid();
					filerequest_list.push({
						filename: path,
						key: key,
						callback: callback
					});
					self.send_command(SERVER_DOMAIN + "get_file " + path + " " +
						key);
				} else {
					loadFile(path, callback);
				}
			},
			refresh_app_menu: function() {
				if (p2p_num_of_members >= 2) {
					document.getElementById("uiCall").style.display = "block";
				} else {
					document.getElementById("uiCall").style.display = "none";
				}
				for (var i = 0; i < plugins.length; i++) {
					if (plugins[i].on_refresh_app_menu) {
						plugins[i].on_refresh_app_menu(app.menu);
					}
				}
			},
			restore_app_menu: function() {
				app.menu.setMenuPage("menu.html", {
					callback: function() {
						for (var i = 0; i < plugins.length; i++) {
							if (plugins[i].on_restore_app_menu) {
								plugins[i].on_restore_app_menu(app.menu);
							}
						}
						self.refresh_app_menu();
					}
				});
			},
			add_overlay_object : function(obj) {
				//TODO:m_video_handler.add_overlay_object( obj );
			},
			remove_overlay_object : function(obj) {
				//TODO:m_video_handler.remove_overlay_object( obj );
			},
			load_vpm : function(url) {
//TODO:				m_vpm_loader = VpmLoader(url, query, m_video_handler.get_view_quaternion, m_image_decoder.decode, (info) => {
//					self.send_event('vpm_loader', info);
//				});
			},
		};
		return self;
	};
	var self = {
		plugin_host: null,
		isDeviceReady: false,
		// Application Constructor
		initialize: function() {
			app.receivedEvent('initialize');
			this.bindEvents();

			// window.addEventListener("orientationchange", function() {
			// alert(window.orientation);
			// });

			window.addEventListener('message', function(event) {
				if (!event.data || event.data.charAt(0) != '{') {
					return;
				}
				var args = JSON.parse(event.data);
				if (!args['function']) {
					alert("no handler : null");
					return;
				}
				switch (args['function']) {
					case 'dispatchEvent':
						var event = new CustomEvent(args['event_name'], {
							'detail': JSON.parse(args['event_data'])
						});
						window.dispatchEvent(event);
						break;
					default:
						alert("no handler : " + args['function']);
				}
			});
		},

		// Bind Event Listeners
		//
		// Bind any events that are required on startup. Common events are:
		// 'load', 'deviceready', 'offline', and 'online'.
		bindEvents: function() {
			document.addEventListener('deviceready', this.onDeviceReady, false);
		},
		// deviceready Event Handler
		//
		// The scope of 'this' is the event. In order to call the
		// 'receivedEvent'
		// function, we must explicitly call 'app.receivedEvent(...);'
		onDeviceReady: function() {
			app.receivedEvent('deviceready');
			app.isDeviceReady = true;
		},

		// Update DOM on a Received Event
		receivedEvent: function(id) {
			console.log('Received Event: ' + id);
		},

		init_common_options_done: false,
		init_common_options: function(callback) {
			if (this.init_common_options_done) {
				return;
			} else {
				this.init_common_options_done = true;
			}
			loadFile("common_config.json", function(chunk_array) {
				try{
					var txt = (new TextDecoder).decode(chunk_array[0]);
					if (txt) {
						m_options = JSON.parse(txt);
					}
				}catch{
					m_options = {};
				}
				if(!m_options.plugin_paths){
					m_options.plugin_paths = [];
				}
			});
		},
		init_options_done: false,
		init_options: function(callback) {
			if (this.init_options_done) {
				return;
			} else {
				this.init_options_done = true;
			}
			// @data : uint8array
			self.plugin_host
				.getFile("config.json", function(chunk_array) {
					var _options = {};
					try{
						var txt = (new TextDecoder).decode(chunk_array[0]);
						if (txt) {
							_options = JSON.parse(txt);
						}
					}catch{
						_options = {};
					}
					if (_options.fov && !query.fov) {
						self.plugin_host.set_fov(_options.fov);
					}
					if(_options.plugin_paths){
						_options.plugin_paths = m_options.plugin_paths.concat(_options.plugin_paths);
					}
					Object.assign(m_options, _options);
					if (m_options.view_offset && !query['view-offset']) {
						var euler = new THREE.Euler(THREE.Math
							.degToRad(m_options.view_offset[0]), THREE.Math
							.degToRad(m_options.view_offset[1]), THREE.Math
							.degToRad(m_options.view_offset[2]), "YXZ");

						view_offset = new THREE.Quaternion()
							.setFromEuler(euler);
					}
					if (query['plugin_paths']) {
						var plugin_paths = JSON.parse(query['plugin_paths']);
						m_options.plugin_paths = m_options.plugin_paths.concat(plugin_paths);
					}
					self.init_plugins(callback);
				});
		},
		
		init_plugins: function(callback) {
			if (!m_options.plugin_paths || m_options.plugin_paths.length == 0) {
				if (callback) {
					callback();
				}
				return;
			}
			function load_plugin(idx) {
				self.plugin_host
					.getFile(m_options.plugin_paths[idx], function(
						chunk_array) {
						var script_str = (new TextDecoder)
							.decode(chunk_array[0]);
						var script = document
							.createElement('script');
						script.onload = function() {
							console.log("loaded : " +
								m_options.plugin_paths[idx]);
							if (create_plugin) {
								var plugin = create_plugin(self.plugin_host);
								plugins.push(plugin);
								create_plugin = null;
							}
							if (idx + 1 < m_options.plugin_paths.length) {
								load_plugin(idx + 1);
							} else {
								for (var i = 0; i < plugins.length; i++) {
									if (plugins[i].init_options) {
										plugins[i]
											.init_options(m_options[plugins[i].name] || {});
									}
								}
								if (callback) {
									callback();
								}
							}
						};
						console.log("loding : " +
							m_options.plugin_paths[idx]);
						var blob = new Blob(chunk_array, {
							type: "text/javascript"
						});
						var url = window.URL || window.webkitURL;
						script.src = url.createObjectURL(blob);

						document.head.appendChild(script);
					});
			}
			load_plugin(0);
		},

		init_network: function(callback, err_callback) {
			// init network related matters
			// data stream handling
			rtp = Rtp();
			rtcp = Rtcp();
			// set rtp callback
			rtp
				.set_callback(function(packet) {
					var sequencenumber = packet.GetSequenceNumber();
					if ((sequencenumber % 100) == 0) {
						var latency = new Date().getTime() /
							1000 -
							(packet.GetTimestamp() + packet.GetSsrc() / 1E6) +
							self.timediff_ms / 1000;
						console.log("packet latency : seq=" + sequencenumber +
							", latency=" + latency + "sec");
					}
					if (packet.GetPayloadType() == PT_AUDIO_BASE) { // audio
						if (opus_decoder) {
							opus_decoder.decode(packet.GetPayload());
							if (audio_first_packet_s == 0) {
								var latency = new Date().getTime() /
									1000 -
									(packet.GetTimestamp() + packet.GetSsrc() / 1E6) +
									self.timediff_ms / 1000;
								console.log("audio_first_packet:latency:" +
									latency);
								audio_first_packet_s = new Date().getTime() / 1000;
							}
						}
					} else if (packet.GetPayloadType() == PT_CAM_BASE) { // image
						//TODO:m_image_decoder.decode(packet.GetPayload());
					} else if (packet.GetPayloadType() == PT_STATUS) { // status
						var str = (new TextDecoder)
							.decode(new Uint8Array(packet.GetPayload()));
						var split = str.split('"');
						var name = UPSTREAM_DOMAIN + split[1];
						var value = decodeURIComponent(split[3]);
						if (watches[name]) {
							watches[name](value);
						}
					} else if (packet.GetPayloadType() == PT_FILE) { // file
						var array = packet.GetPayload();
						var view = new DataView(array.buffer, array.byteOffset);
						var header_size = view.getUint16(0, false);
						var header = array.slice(2, 2 + header_size);
						var header_str = (new TextDecoder).decode(header);
						var data = array.slice(2 + header_size);
						var key = "dummy";
						var seq = 0;
						var eof = false;
						var split = header_str.split(" ");
						for (var i = 0; i < split.length; i++) {
							var separator = (/[=,\"]/);
							var _split = split[i].split(separator);
							if (_split[0] == "key") {
								key = _split[2];
							} else if (_split[0] == "seq") {
								seq = parseInt(_split[2]);
							} else if (_split[0] == "eof") {
								eof = _split[2] == "true";
							}
						}
						for (var i = 0; i < filerequest_list.length; i++) {
							if (filerequest_list[i].key == key) {
								if (seq == 0) {
									filerequest_list[i].chunk_array = [];
								}
								filerequest_list[i].chunk_array.push(data);
								if (eof) {
									filerequest_list[i]
										.callback(filerequest_list[i].chunk_array);
									filerequest_list.splice(i, 1);
									break;
								}
							}
						}
					}
				});
			// command to upstream
			setInterval(function() {
				if (!cmd2upstream_list.length) {
					return;
				}
				var {cmd} = cmd2upstream_list.shift();
				var xml = "<picam360:command id=\"" + app.rtcp_command_id +
					"\" value=\"" + cmd + "\" />"
				rtcp.sendpacket(rtcp.buildpacket(xml, PT_CMD));
				app.rtcp_command_id++;
			}, 33); // 30hz
			var connection_callback = function(conn) {
				var is_init = false;
				var init_con = function() {
					is_init = true;
					self.plugin_host.set_info("waiting image...");
					rtp.set_connection(conn);
					rtcp.set_connection(conn);
					callback();
				}
				var timediff_ms = 0;
				var min_rtt = 0;
				var ping_cnt = 0;
				if (query['frame-mode']) {
					var cmd = "<picam360:command id=\"0\" value=\"frame_mode " +
						query['frame-mode'] + "\" />"
					var pack = rtcp.buildpacket(cmd, PT_CMD);
					rtcp.sendpacket(conn, pack);
				}
				if (query['frame-width']) {
					var cmd = "<picam360:command id=\"0\" value=\"frame_width " +
						query['frame-width'] + "\" />"
					var pack = rtcp.buildpacket(cmd, PT_CMD);
					rtcp.sendpacket(conn, pack);
				}
				if (query['frame-height']) {
					var cmd = "<picam360:command id=\"0\" value=\"frame_height " +
						query['frame-height'] + "\" />"
					var pack = rtcp.buildpacket(cmd, PT_CMD);
					rtcp.sendpacket(conn, pack);
				}
				if (query['frame-fps']) {
					var cmd = "<picam360:command id=\"0\" value=\"frame_fps " +
						query['frame-fps'] + "\" />"
					var pack = rtcp.buildpacket(cmd, PT_CMD);
					rtcp.sendpacket(conn, pack);
				}
				if (query['frame-encode']) {
					var cmd = "<picam360:command id=\"0\" value=\"frame_encode " +
						query['frame-encode'] + "\" />"
					var pack = rtcp.buildpacket(cmd, PT_CMD);
					rtcp.sendpacket(conn, pack);
				}
				if (query['frame-bitrate']) {
					var cmd = "<picam360:command id=\"0\" value=\"frame_bitrate " +
						query['frame-bitrate'] + "\" />"
					var pack = rtcp.buildpacket(cmd, PT_CMD);
					rtcp.sendpacket(conn, pack);
				} { // ping
					var cmd = "<picam360:command id=\"0\" value=\"ping " +
						new Date().getTime() + "\" />"
					var pack = rtcp.buildpacket(cmd, PT_CMD);
				}
				rtcp.sendpacket(conn, pack);
				conn.addEventListener('message', function(data){
					if(data instanceof MessageEvent){
						data = data.data;
					}
					if (!is_init) {
						function handle_data(data){
							var pack = PacketHeader(data);
							if (pack.GetPayloadType() == PT_STATUS) {
								var str = (new TextDecoder)
									.decode(new Uint8Array(pack.GetPayload()));
								var split = str.split('"');
								var name = split[1];
								var value = split[3].split(' ');
								if (name == "pong") {
									ping_cnt++;
									var now = new Date().getTime();
									var rtt = now - parseInt(value[0]);
									var _timediff_ms = value[1] - (now - rtt / 2);
									if (min_rtt == 0 || rtt < min_rtt) {
										min_rtt = rtt;
										timediff_ms = _timediff_ms;
									}
									console.log(name + ":" + value + ":rtt=" +
										rtt);
									if (ping_cnt < 10) {
										var cmd = "<picam360:command id=\"0\" value=\"ping " +
											new Date().getTime() + "\" />"
										var pack = rtcp
											.buildpacket(cmd, PT_CMD);
										rtcp.sendpacket(conn, pack);
										return;
									} else {
										var cmd = "<picam360:command id=\"0\" value=\"set_timediff_ms " +
											timediff_ms + "\" />";
										var pack = rtcp
											.buildpacket(cmd, PT_CMD);
										rtcp.sendpacket(conn, pack);

										console.log("min_rtt=" + min_rtt +
											":timediff_ms:" +
											timediff_ms);
										self.timediff_ms = timediff_ms;
									}
								}
							}
							init_con();
						}
						if(data instanceof Blob) {
						    var fr = new FileReader();
						    fr.onload = function(evt) {
						      handle_data(evt.target.result);
						    };
						    fr.readAsArrayBuffer(data);
						}else{
							if (Array.isArray(data)) {
								for(_data of data){
									handle_data(_data);
								}
							}else{
								handle_data(data);
							}
						}
					}
				});
			};
			if (query['p2p-uuid']) {
				self.plugin_host.set_info("connecting via webrtc...");
				self
					.start_p2p(query['p2p-uuid'], connection_callback, function() {
						err_callback();
					});
			} else {
				var req = new XMLHttpRequest();
				req.responseType = "arraybuffer";

				req.addEventListener("readystatechange", function() {//check_if_direct_access_available
					if (this.readyState === 4) {
						if (this.status == 200) {
							self.plugin_host.set_info("connecting via websocket...");
							self.start_ws(connection_callback, function() {
								err_callback();
							});
						}else{
							err_callback();
						}
					}
				}, false);

				req.open("HEAD", "config.json", true);
				req.send(null);
			}
		},

		handle_audio_frame: function(left, right) {
			if (audio_first_packet_s != -1) {
				var latency = new Date().getTime() / 1000 -
					audio_first_packet_s;
				console.log("audio_first_decode:latency:" + latency);
				audio_first_packet_s = -1;
			}
			m_audio_handler.pushAudioStream(left, right);
		},

		init_watch: function() {
			self.plugin_host.add_watch("upstream.error", function(value) {
				switch (value.toLowerCase()) {
					case "exceeded_num_of_clients":
						self.plugin_host
							.set_info("error : Exceeded num of clients");
						break;
				}
			});
			self.plugin_host
				.add_watch("upstream.is_recording", function(value) {
					set_is_recording(value.toLowerCase() == 'true');
				});
			self.plugin_host.add_watch("upstream.p2p_num_of_members", function(
				value) {
				if (value != p2p_num_of_members) {
					p2p_num_of_members = value;
					try{
						self.plugin_host.restore_app_menu();
					}catch(e){
						// do nothing
					}
				}
			});
			self.plugin_host.add_watch("upstream.info", function(value) {
				m_upstream_info = value;
			});
			self.plugin_host.add_watch("upstream.menu", function(value) {
				m_upstream_menu = value;
			});

			self.plugin_host
				.add_watch("upstream.request_call", function(value) {
					if (p2p_uuid_call == value) {
						return;
					}
					p2p_uuid_call = value;
					if (!window.confirm('An incoming call')) {
						return;
					}
					navigator.getUserMedia({
						video: false,
						audio: true
					}, function(stream) {
						peer_call = new Peer({
							host: SIGNALING_HOST,
							port: SIGNALING_PORT,
							secure: SIGNALING_SECURE,
							key: P2P_API_KEY,
							debug: debug
						});
						var call = peer_call.call(p2p_uuid_call, stream);
						call.on('stream', function(remoteStream) {
							var audio = new Audio();
							if (navigator.userAgent.indexOf("Safari") > -1) {
								audio.srcObject = remoteStream;
							} else {
								audio.src = (URL || webkitURL || mozURL)
									.createObjectURL(remoteStream);
							}
							console.log("stream");
							audio.load();
							setTimeout(function() {
								audio.play();
							}, 2000);
						});
					}, function(err) {
						console.log('Failed to get local stream', err);
					});
				});
		},

		rtcp_command_id: 0,
		
		start_ws: function(callback, err_callback) {
			try{
				// websocket
				var ws_url = "ws://" + server_url.slice(server_url.indexOf("://")+3);
				var socket = new WebSocket(ws_url);
				socket.binaryType = 'arraybuffer';// blob or arraybuffer
				socket.addEventListener('open', function (event) {
					callback(socket);
				});
				socket.addEventListener('error', function (event) {
					self.plugin_host.set_info("error : Could not connect : " + event);
					err_callback();
				});
			}catch{
				err_callback();
			}
		},
		start_p2p: function(p2p_uuid, callback, err_callback) {
			var options = {
				host: SIGNALING_HOST,
				port: SIGNALING_PORT,
				secure: SIGNALING_SECURE,
				key: P2P_API_KEY,
				iceServers : [
	                         	{"urls": "stun:stun.l.google.com:19302"},
	                        	{"urls": "stun:stun1.l.google.com:19302"},
	                        	{"urls": "stun:stun2.l.google.com:19302"},
	                        ],
	        	debug: debug,
			};
			if (query['turn-server']) {
				options.iceServers.push({
					urls: 'turn:turn.picam360.com:3478',
					username: "picam360",
					credential: "picam360"
				});
			}
			var sig = new Signaling(options);
			sig.connect(function() {
				var pc = new RTCPeerConnection({
					sdpSemantics: 'unified-plan',
					iceServers: options.iceServers
				});
				m_pc = pc;

				sig.onoffer = function(offer) {
					var bitrate = 0;
					var lines = offer.payload.sdp.sdp.split('\r\n');
					for(var i=0;i<lines.length;i++){
						// vp9
						if(lines[i].startsWith('b=AS:')){
							bitrate = parseInt(lines[i].replace('b=AS:', ''));
						}
					}
					pc.setRemoteDescription(offer.payload.sdp).then(function() {
						return pc.createAnswer();
					}).then(function(sdp) {
						console.log('Created answer.');
						var lines = sdp.sdp.split('\r\n');
						for(var i=0;i<lines.length;i++){
							// stereo
							if(lines[i].startsWith('a=fmtp:111')){
								lines[i] = lines[i].replace(
									/a=fmtp:111/,
									'a=fmtp:111 stereo=1\r\na=fmtp:111');
							}
							// vp9
							if(lines[i].startsWith('m=video 9')){
								lines[i] = lines[i].replace(
										'm=video 9 UDP/TLS/RTP/SAVPF 96 97 98 99 100 101 127',
										'm=video 9 UDP/TLS/RTP/SAVPF 98 96 97 99 100 101 127');
							}
							// bitrate
							if(lines[i].startsWith('m=video 9')){
								if (bitrate) {
									lines[i] = lines[i] + '\r\n' +
											'b=AS:' + bitrate;
								}
							}
						}
						sdp.sdp = lines.join('\r\n');
						
						pc.setLocalDescription(sdp);
						sig.answer(offer.src, sdp);
					}).catch(function(err) {
						console.log('Failed answering:' + err);
					});
					pc.onicecandidate = function(event) {
						if (event.candidate) {
							sig.candidate(offer.src, event.candidate);
						} else {
							// All ICE candidates have been sent
						}
					};
					pc.ondatachannel = function(ev) {
						console.log('Data channel is created!');
						var dc = ev.channel;
						dc.onopen = function() {
							console.log("p2p connection established as downstream.");
							for(var receiver of m_pc.getReceivers()){
								switch(receiver.track.kind){
									case 'audio':
										var stream = new MediaStream([receiver.track]);
										m_audio_handler.loadAudio(stream);
										break;
									case 'video':
										var stream = new MediaStream([receiver.track]);
										//TODO:m_video_handler.set_stream(stream, receiver);
										break;
								}
							}
							dc.addEventListener('close', function(data){
								pc.close();
							});
							callback(dc);
						};
						dc.onclose = function() {
							self.plugin_host.set_info("p2p connection closed");
							m_frame_active = false;
						};
					};
					pc.onerror = function(err) {
						if (err.type == "peer-unavailable") {
							self.plugin_host.set_info("error : Could not connect " +
								p2p_uuid);
							m_pc = null;
							err_callback();
						}
					};
				};
				sig.oncandidate = function(candidate) {
					pc.addIceCandidate(candidate.payload.ice);
				};
				sig.request_offer(p2p_uuid);
			});
		},
		stop_p2p: function() {
			m_pc = null;
		},
		start_call: function() {
			p2p_uuid_call = uuid();
			peer_call = new Peer(p2p_uuid_call, {
				host: SIGNALING_HOST,
				port: SIGNALING_PORT,
				secure: SIGNALING_SECURE,
				key: P2P_API_KEY,
				debug: debug
			});
			peer_call.on('call', function(call) {
				navigator.getUserMedia({
					video: false,
					audio: true
				}, function(stream) {
					call.answer(stream);
					call.on('stream', function(remoteStream) {
						var audio = new Audio();
						if (navigator.userAgent.indexOf("Safari") > -1) {
							audio.srcObject = remoteStream;
						} else {
							audio.src = (URL || webkitURL || mozURL)
								.createObjectURL(remoteStream);
						}
						audio.load();
						setTimeout(function() {
							audio.play();
						}, 2000);
						self.plugin_host.send_command(SERVER_DOMAIN +
							"request_call " + ""); // reset
					});
				}, function(err) {
					console.log('Failed to get local stream', err);
				});
			});
			self.plugin_host.send_command(SERVER_DOMAIN + "request_call " +
				p2p_uuid_call);
		},
		stop_call: function() {},
		connected: function() {
			return (socket != null || m_pc != null);
		},
		start_animate: function() {
			function redraw() {
				m_pstcore._pstcore_poll_events();
				requestAnimationFrame(redraw);
			}
			requestAnimationFrame(redraw);
			
			
//			var raf_fps;
//			var frame_count = 0;
//			var start_time = new Date().getTime();
//			var last_time = new Date().getTime();
//
//			function pre_redraw() {
//				var now = new Date().getTime();
//				var _raf_fps = Math.round(1000.0/(now-last_time)/15)*15;
//				last_time = now;
//				frame_count++;
//				if(now - start_time > 1000){
//					raf_fps = Math.round(frame_count*1000.0/(now-start_time));
//					console.log("raf_fps=" + raf_fps);
//					
//					frame_count = 0;
//					start_time = new Date().getTime();
//					m_video_handler.requestAnimationFrame(redraw);
//				}else{
//					m_video_handler.requestAnimationFrame(pre_redraw);
//				}
//			}
//			m_video_handler.requestAnimationFrame(pre_redraw);
//			function redraw() {
//				try{
//					frame_count++;
//					if ((frame_count % 30) == 0) {
//						var divStatus = document.getElementById("divStatus");
//						if (divStatus) {
//							var status = "";
//							var texture_info = m_video_handler.get_info(); {
//								status += "texture<br/>";
//								status += "v-fps:" + texture_info.video_fps.toFixed(3) +
//									"<br/>";
//								if(texture_info.offscreen){
//									status += "o";
//								}
//								status += "r-fps:" + texture_info.animate_fps.toFixed(3) +
//									"<br/>";
//								if(m_vpm_loader){
//									//not realtime
//								}else{
//									status += "latency:" +
//										texture_info.latency_msec.toFixed(0) +
//										"ms<br/>";
//								}
//								status += "codec:" + texture_info.codec + "<br/>";
//								status += "<br/>";
//							}
//	
//							if(m_vpm_loader){
//								var mbps = m_vpm_loader.get_bitrate_mbps();
//								status += "packet<br/>";
//								status += "bitrate:" + mbps.toFixed(3) +
//									"Mbit/s<br/>";
//								var [preload_act, preload] = m_vpm_loader.get_preload();
//								status += "preload:" + preload_act + "/" + preload;
//								status += "<br/>";
//							} else if(m_pc){
//								status += "packet<br/>";
//								status += "bitrate:" + (texture_info.bitrate / 1e6).toFixed(3) +
//									"Mbit/s<br/>";
//								status += "<br/>";
//							}else if(rtp){
//								var rtp_info = rtp.get_info();
//								status += "packet<br/>";
//								status += "bitrate:" + rtp_info.bitrate.toFixed(3) +
//									"Mbit/s<br/>";
//								status += "<br/>";
//							} 
//	
//							if(m_upstream_info)
//							{
//								status += "upstream<br/>";
//								status += m_upstream_info.replace(/\n/gm, "<br/>");
//								status += "<br/>";
//							}
//	
//							divStatus.innerHTML = status;
//						}
//					}
//					if (m_menu_visible && (frame_count % 10) == 0) {
//						var info = ""; 
//						var defualt_color = "#ffffff";
//						var activated_color = "#00ffff";
//						var selected_color = "#ff00ff";
//						var marked_color = "#ffff00";
//						var rows = m_upstream_menu.split("\n");
//						var _nodes_index = rows[0].split(",");
//						var nodes_index = [];
//						for (var i = 0; i < _nodes_index.length; i++) {
//							nodes_index[_nodes_index[i].toLowerCase()] = i;
//						}
//						info += "<pre align=\"left\">";
//						for (var i = 1; i < rows.length; i++) {
//							if (!rows[i]) {
//								continue;
//							}
//							var nodes = rows[i].split(",");
//							var color = nodes[nodes_index["selected"]] == "1" ?
//								selected_color :
//								nodes[nodes_index["activated"]] == "1" ?
//								activated_color :
//								nodes[nodes_index["marked"]] == "1" ?
//								marked_color :
//								defualt_color;
//							info += " "
//								.repeat(4 * nodes[nodes_index["depth"]]) +
//								"<font color=\"" +
//								color +
//								"\">" +
//								nodes[nodes_index["name"]] +
//								"</font>" +
//								"<br/>";
//						}
//						info += "</pre>";
//						self.plugin_host.set_menu(info);
//					}
//					if (!m_frame_active) {
//						return;
//					}
//					m_video_handler.animate(m_view_fov);
//				} finally {
//					m_video_handler.requestAnimationFrame(redraw);
//				}
//			}
		},

		main: function() {
			app.receivedEvent('main');

			navigator.getUserMedia = navigator.getUserMedia ||
				navigator.webkitGetUserMedia || navigator.mozGetUserMedia;

			if (query['server-url']) {
				server_url = query['server-url'];
			}
			if (query['default-image-url']) {
				default_image_url = query['default-image-url'];
			}
			if (query['view-offset']) {
				var split = query['view-offset'].split(',');
				var euler = new THREE.Euler(THREE.Math
					.degToRad(parseFloat(split[0])), THREE.Math
					.degToRad(parseFloat(split[1])), THREE.Math
					.degToRad(parseFloat(split[2])), "YXZ");

				view_offset = new THREE.Quaternion().setFromEuler(euler);
			}
			if (query['fov']) {
				m_view_fov = parseFloat(query['fov']);
			}
			if (query['vertex-type']) {
				m_vertex_type = query['vertex-type'];
			}

			if (query['auto-scroll']) {
				auto_scroll = parseBoolean(query['auto-scroll']);
			}
			if (query['debug']) {
				debug = parseFloat(query['debug']);
			}
			if (query['view-offset-lock']) {
				view_offset_lock = parseBoolean(query['view-offset-lock']);
			}
			if (query['afov']) {
				m_afov = parseBoolean(query['afov']);
			}
			if (query['fpp']) {
				m_fpp = parseBoolean(query['fpp']);
			}

			m_canvas = document.getElementById('panorama');
			m_overlay = document.getElementById('overlay');

			self.plugin_host = PluginHost(self);
			self.init_common_options();

			m_pstcore = window.PstCoreLoader({
				preRun: [],
				postRun: [],
				print: function(msg) {
					console.log(msg);
				},
				printErr: function(e) {
					console.error(e);
				},
				canvas: function() {
					var e = m_canvas;
					return e;
				}(),
				onRuntimeInitialized : function() {
					console.log("pstcore initialized");
					const config = {
							"plugin_paths" : [
								"plugins/pvf_loader_st.so",
								"plugins/libde265_decoder_st.so",
								"plugins/pgl_renderer_st.so",
							],
					}
					if(window.cordova){
						config.plugins.push("plugins/cordova_binder_st.so");
					}
					const config_json = JSON.stringify(config);
					m_pstcore.pstcore_init(config_json);
					
					const url =
						"https://storage.granbosque.net/picam360_vpm/biwako_191213";
					m_pstcore.pstcore_start_pvf_loader(url);

					self.start_animate();
				},
				locateFile : function(path, prefix) {
					return "/lib/pstcore/" + path;
				},
			});
		},
	};
	return self;
})();

app.receivedEvent('load index.js');
app.initialize();