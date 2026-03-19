"use strict";
const require$$3$1 = require("electron");
const path$1 = require("node:path");
const fs = require("fs/promises");
const require$$1$1 = require("child_process");
const require$$1 = require("util");
const require$$0$1 = require("path");
const require$$0 = require("tty");
const require$$3 = require("fs");
const net = require("net");
function getDefaultExportFromCjs(x) {
  return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, "default") ? x["default"] : x;
}
var src = { exports: {} };
var browser = { exports: {} };
var debug$1 = { exports: {} };
var ms;
var hasRequiredMs;
function requireMs() {
  if (hasRequiredMs) return ms;
  hasRequiredMs = 1;
  var s = 1e3;
  var m = s * 60;
  var h = m * 60;
  var d = h * 24;
  var y = d * 365.25;
  ms = function(val, options) {
    options = options || {};
    var type = typeof val;
    if (type === "string" && val.length > 0) {
      return parse(val);
    } else if (type === "number" && isNaN(val) === false) {
      return options.long ? fmtLong(val) : fmtShort(val);
    }
    throw new Error(
      "val is not a non-empty string or a valid number. val=" + JSON.stringify(val)
    );
  };
  function parse(str) {
    str = String(str);
    if (str.length > 100) {
      return;
    }
    var match = /^((?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|years?|yrs?|y)?$/i.exec(
      str
    );
    if (!match) {
      return;
    }
    var n = parseFloat(match[1]);
    var type = (match[2] || "ms").toLowerCase();
    switch (type) {
      case "years":
      case "year":
      case "yrs":
      case "yr":
      case "y":
        return n * y;
      case "days":
      case "day":
      case "d":
        return n * d;
      case "hours":
      case "hour":
      case "hrs":
      case "hr":
      case "h":
        return n * h;
      case "minutes":
      case "minute":
      case "mins":
      case "min":
      case "m":
        return n * m;
      case "seconds":
      case "second":
      case "secs":
      case "sec":
      case "s":
        return n * s;
      case "milliseconds":
      case "millisecond":
      case "msecs":
      case "msec":
      case "ms":
        return n;
      default:
        return void 0;
    }
  }
  function fmtShort(ms2) {
    if (ms2 >= d) {
      return Math.round(ms2 / d) + "d";
    }
    if (ms2 >= h) {
      return Math.round(ms2 / h) + "h";
    }
    if (ms2 >= m) {
      return Math.round(ms2 / m) + "m";
    }
    if (ms2 >= s) {
      return Math.round(ms2 / s) + "s";
    }
    return ms2 + "ms";
  }
  function fmtLong(ms2) {
    return plural(ms2, d, "day") || plural(ms2, h, "hour") || plural(ms2, m, "minute") || plural(ms2, s, "second") || ms2 + " ms";
  }
  function plural(ms2, n, name) {
    if (ms2 < n) {
      return;
    }
    if (ms2 < n * 1.5) {
      return Math.floor(ms2 / n) + " " + name;
    }
    return Math.ceil(ms2 / n) + " " + name + "s";
  }
  return ms;
}
var hasRequiredDebug;
function requireDebug() {
  if (hasRequiredDebug) return debug$1.exports;
  hasRequiredDebug = 1;
  (function(module, exports$1) {
    exports$1 = module.exports = createDebug.debug = createDebug["default"] = createDebug;
    exports$1.coerce = coerce;
    exports$1.disable = disable;
    exports$1.enable = enable;
    exports$1.enabled = enabled;
    exports$1.humanize = requireMs();
    exports$1.names = [];
    exports$1.skips = [];
    exports$1.formatters = {};
    var prevTime;
    function selectColor(namespace) {
      var hash = 0, i;
      for (i in namespace) {
        hash = (hash << 5) - hash + namespace.charCodeAt(i);
        hash |= 0;
      }
      return exports$1.colors[Math.abs(hash) % exports$1.colors.length];
    }
    function createDebug(namespace) {
      function debug2() {
        if (!debug2.enabled) return;
        var self = debug2;
        var curr = +/* @__PURE__ */ new Date();
        var ms2 = curr - (prevTime || curr);
        self.diff = ms2;
        self.prev = prevTime;
        self.curr = curr;
        prevTime = curr;
        var args = new Array(arguments.length);
        for (var i = 0; i < args.length; i++) {
          args[i] = arguments[i];
        }
        args[0] = exports$1.coerce(args[0]);
        if ("string" !== typeof args[0]) {
          args.unshift("%O");
        }
        var index = 0;
        args[0] = args[0].replace(/%([a-zA-Z%])/g, function(match, format) {
          if (match === "%%") return match;
          index++;
          var formatter = exports$1.formatters[format];
          if ("function" === typeof formatter) {
            var val = args[index];
            match = formatter.call(self, val);
            args.splice(index, 1);
            index--;
          }
          return match;
        });
        exports$1.formatArgs.call(self, args);
        var logFn = debug2.log || exports$1.log || console.log.bind(console);
        logFn.apply(self, args);
      }
      debug2.namespace = namespace;
      debug2.enabled = exports$1.enabled(namespace);
      debug2.useColors = exports$1.useColors();
      debug2.color = selectColor(namespace);
      if ("function" === typeof exports$1.init) {
        exports$1.init(debug2);
      }
      return debug2;
    }
    function enable(namespaces) {
      exports$1.save(namespaces);
      exports$1.names = [];
      exports$1.skips = [];
      var split = (typeof namespaces === "string" ? namespaces : "").split(/[\s,]+/);
      var len = split.length;
      for (var i = 0; i < len; i++) {
        if (!split[i]) continue;
        namespaces = split[i].replace(/\*/g, ".*?");
        if (namespaces[0] === "-") {
          exports$1.skips.push(new RegExp("^" + namespaces.substr(1) + "$"));
        } else {
          exports$1.names.push(new RegExp("^" + namespaces + "$"));
        }
      }
    }
    function disable() {
      exports$1.enable("");
    }
    function enabled(name) {
      var i, len;
      for (i = 0, len = exports$1.skips.length; i < len; i++) {
        if (exports$1.skips[i].test(name)) {
          return false;
        }
      }
      for (i = 0, len = exports$1.names.length; i < len; i++) {
        if (exports$1.names[i].test(name)) {
          return true;
        }
      }
      return false;
    }
    function coerce(val) {
      if (val instanceof Error) return val.stack || val.message;
      return val;
    }
  })(debug$1, debug$1.exports);
  return debug$1.exports;
}
var hasRequiredBrowser;
function requireBrowser() {
  if (hasRequiredBrowser) return browser.exports;
  hasRequiredBrowser = 1;
  (function(module, exports$1) {
    exports$1 = module.exports = requireDebug();
    exports$1.log = log;
    exports$1.formatArgs = formatArgs;
    exports$1.save = save;
    exports$1.load = load;
    exports$1.useColors = useColors;
    exports$1.storage = "undefined" != typeof chrome && "undefined" != typeof chrome.storage ? chrome.storage.local : localstorage();
    exports$1.colors = [
      "lightseagreen",
      "forestgreen",
      "goldenrod",
      "dodgerblue",
      "darkorchid",
      "crimson"
    ];
    function useColors() {
      if (typeof window !== "undefined" && window.process && window.process.type === "renderer") {
        return true;
      }
      return typeof document !== "undefined" && document.documentElement && document.documentElement.style && document.documentElement.style.WebkitAppearance || // is firebug? http://stackoverflow.com/a/398120/376773
      typeof window !== "undefined" && window.console && (window.console.firebug || window.console.exception && window.console.table) || // is firefox >= v31?
      // https://developer.mozilla.org/en-US/docs/Tools/Web_Console#Styling_messages
      typeof navigator !== "undefined" && navigator.userAgent && navigator.userAgent.toLowerCase().match(/firefox\/(\d+)/) && parseInt(RegExp.$1, 10) >= 31 || // double check webkit in userAgent just in case we are in a worker
      typeof navigator !== "undefined" && navigator.userAgent && navigator.userAgent.toLowerCase().match(/applewebkit\/(\d+)/);
    }
    exports$1.formatters.j = function(v) {
      try {
        return JSON.stringify(v);
      } catch (err) {
        return "[UnexpectedJSONParseError]: " + err.message;
      }
    };
    function formatArgs(args) {
      var useColors2 = this.useColors;
      args[0] = (useColors2 ? "%c" : "") + this.namespace + (useColors2 ? " %c" : " ") + args[0] + (useColors2 ? "%c " : " ") + "+" + exports$1.humanize(this.diff);
      if (!useColors2) return;
      var c = "color: " + this.color;
      args.splice(1, 0, c, "color: inherit");
      var index = 0;
      var lastC = 0;
      args[0].replace(/%[a-zA-Z%]/g, function(match) {
        if ("%%" === match) return;
        index++;
        if ("%c" === match) {
          lastC = index;
        }
      });
      args.splice(lastC, 0, c);
    }
    function log() {
      return "object" === typeof console && console.log && Function.prototype.apply.call(console.log, console, arguments);
    }
    function save(namespaces) {
      try {
        if (null == namespaces) {
          exports$1.storage.removeItem("debug");
        } else {
          exports$1.storage.debug = namespaces;
        }
      } catch (e) {
      }
    }
    function load() {
      var r;
      try {
        r = exports$1.storage.debug;
      } catch (e) {
      }
      if (!r && typeof process !== "undefined" && "env" in process) {
        r = process.env.DEBUG;
      }
      return r;
    }
    exports$1.enable(load());
    function localstorage() {
      try {
        return window.localStorage;
      } catch (e) {
      }
    }
  })(browser, browser.exports);
  return browser.exports;
}
var node = { exports: {} };
var hasRequiredNode;
function requireNode() {
  if (hasRequiredNode) return node.exports;
  hasRequiredNode = 1;
  (function(module, exports$1) {
    var tty = require$$0;
    var util = require$$1;
    exports$1 = module.exports = requireDebug();
    exports$1.init = init;
    exports$1.log = log;
    exports$1.formatArgs = formatArgs;
    exports$1.save = save;
    exports$1.load = load;
    exports$1.useColors = useColors;
    exports$1.colors = [6, 2, 3, 4, 5, 1];
    exports$1.inspectOpts = Object.keys(process.env).filter(function(key) {
      return /^debug_/i.test(key);
    }).reduce(function(obj, key) {
      var prop = key.substring(6).toLowerCase().replace(/_([a-z])/g, function(_, k) {
        return k.toUpperCase();
      });
      var val = process.env[key];
      if (/^(yes|on|true|enabled)$/i.test(val)) val = true;
      else if (/^(no|off|false|disabled)$/i.test(val)) val = false;
      else if (val === "null") val = null;
      else val = Number(val);
      obj[prop] = val;
      return obj;
    }, {});
    var fd = parseInt(process.env.DEBUG_FD, 10) || 2;
    if (1 !== fd && 2 !== fd) {
      util.deprecate(function() {
      }, "except for stderr(2) and stdout(1), any other usage of DEBUG_FD is deprecated. Override debug.log if you want to use a different log function (https://git.io/debug_fd)")();
    }
    var stream = 1 === fd ? process.stdout : 2 === fd ? process.stderr : createWritableStdioStream(fd);
    function useColors() {
      return "colors" in exports$1.inspectOpts ? Boolean(exports$1.inspectOpts.colors) : tty.isatty(fd);
    }
    exports$1.formatters.o = function(v) {
      this.inspectOpts.colors = this.useColors;
      return util.inspect(v, this.inspectOpts).split("\n").map(function(str) {
        return str.trim();
      }).join(" ");
    };
    exports$1.formatters.O = function(v) {
      this.inspectOpts.colors = this.useColors;
      return util.inspect(v, this.inspectOpts);
    };
    function formatArgs(args) {
      var name = this.namespace;
      var useColors2 = this.useColors;
      if (useColors2) {
        var c = this.color;
        var prefix = "  \x1B[3" + c + ";1m" + name + " \x1B[0m";
        args[0] = prefix + args[0].split("\n").join("\n" + prefix);
        args.push("\x1B[3" + c + "m+" + exports$1.humanize(this.diff) + "\x1B[0m");
      } else {
        args[0] = (/* @__PURE__ */ new Date()).toUTCString() + " " + name + " " + args[0];
      }
    }
    function log() {
      return stream.write(util.format.apply(util, arguments) + "\n");
    }
    function save(namespaces) {
      if (null == namespaces) {
        delete process.env.DEBUG;
      } else {
        process.env.DEBUG = namespaces;
      }
    }
    function load() {
      return process.env.DEBUG;
    }
    function createWritableStdioStream(fd2) {
      var stream2;
      var tty_wrap = process.binding("tty_wrap");
      switch (tty_wrap.guessHandleType(fd2)) {
        case "TTY":
          stream2 = new tty.WriteStream(fd2);
          stream2._type = "tty";
          if (stream2._handle && stream2._handle.unref) {
            stream2._handle.unref();
          }
          break;
        case "FILE":
          var fs2 = require$$3;
          stream2 = new fs2.SyncWriteStream(fd2, { autoClose: false });
          stream2._type = "fs";
          break;
        case "PIPE":
        case "TCP":
          var net$1 = net;
          stream2 = new net$1.Socket({
            fd: fd2,
            readable: false,
            writable: true
          });
          stream2.readable = false;
          stream2.read = null;
          stream2._type = "pipe";
          if (stream2._handle && stream2._handle.unref) {
            stream2._handle.unref();
          }
          break;
        default:
          throw new Error("Implement me. Unknown stream file type!");
      }
      stream2.fd = fd2;
      stream2._isStdio = true;
      return stream2;
    }
    function init(debug2) {
      debug2.inspectOpts = {};
      var keys = Object.keys(exports$1.inspectOpts);
      for (var i = 0; i < keys.length; i++) {
        debug2.inspectOpts[keys[i]] = exports$1.inspectOpts[keys[i]];
      }
    }
    exports$1.enable(load());
  })(node, node.exports);
  return node.exports;
}
if (typeof process !== "undefined" && process.type === "renderer") {
  src.exports = requireBrowser();
} else {
  src.exports = requireNode();
}
var srcExports = src.exports;
var path = require$$0$1;
var spawn = require$$1$1.spawn;
var debug = srcExports("electron-squirrel-startup");
var app = require$$3$1.app;
var run = function(args, done) {
  var updateExe = path.resolve(path.dirname(process.execPath), "..", "Update.exe");
  debug("Spawning `%s` with args `%s`", updateExe, args);
  spawn(updateExe, args, {
    detached: true
  }).on("close", done);
};
var check = function() {
  if (process.platform === "win32") {
    var cmd = process.argv[1];
    debug("processing squirrel command `%s`", cmd);
    var target = path.basename(process.execPath);
    if (cmd === "--squirrel-install" || cmd === "--squirrel-updated") {
      run(["--createShortcut=" + target], app.quit);
      return true;
    }
    if (cmd === "--squirrel-uninstall") {
      run(["--removeShortcut=" + target], app.quit);
      return true;
    }
    if (cmd === "--squirrel-obsolete") {
      app.quit();
      return true;
    }
  }
  return false;
};
var electronSquirrelStartup = check();
const started = /* @__PURE__ */ getDefaultExportFromCjs(electronSquirrelStartup);
const execAsync = require$$1.promisify(require$$1$1.exec);
const runningProcesses = /* @__PURE__ */ new Map();
const shellToProcessPid = /* @__PURE__ */ new Map();
const blockIdToProcessPid = /* @__PURE__ */ new Map();
let serverSocket = null;
let serverSocketConnected = false;
let matlabSocketServer = null;
let cppSocketServer = null;
const matlabClients = /* @__PURE__ */ new Map();
const cppClients = /* @__PURE__ */ new Map();
let instanceId = null;
let serverPort = null;
let matlabPort = null;
let cppPort = null;
let blockIdCounter = 1e3;
const generateInstanceId = () => `${Date.now()}_${Math.floor(Math.random() * 1e4)}`;
const findAvailablePort = (basePort) => {
  return new Promise((resolve, reject) => {
    const testServer = net.createServer();
    testServer.once("error", (err) => {
      if (err.code === "EADDRINUSE") resolve(findAvailablePort(basePort + 1));
      else reject(err);
    });
    testServer.once("listening", () => {
      const port = testServer.address().port;
      testServer.close(() => resolve(port));
    });
    testServer.listen(basePort);
  });
};
if (started) require$$3$1.app.quit();
let mainWindow;
const sendToServer = (messageObj) => {
  if (!serverSocket || !serverSocketConnected) return;
  try {
    serverSocket.write(JSON.stringify(messageObj) + "\n");
  } catch (err) {
    console.error("[PID Registry] Failed to send to pipe server:", err.message);
  }
};
const registerPidWithServer = (realPid, blockName) => {
  console.log(`[PID Registry] ✓ Registering PID ${realPid} (${blockName})`);
  sendToServer({ type: "REGISTER_PID", pid: realPid, name: blockName });
};
const unregisterPidWithServer = (realPid, blockName) => {
  console.log(`[PID Registry] Unregistering PID ${realPid} (${blockName})`);
  sendToServer({ type: "UNREGISTER_PID", pid: realPid, name: blockName });
};
const onBlockInit = (blockId, blockName, processPid, language) => {
  if (!processPid || processPid <= 0) return;
  console.log(`[PID Registry] ${language} block "${blockName}" (ID:${blockId}) self-reported PID: ${processPid}`);
  blockIdToProcessPid.set(String(blockId), processPid);
  for (const [shellPid, entry] of runningProcesses.entries()) {
    if (entry.name === blockName && !entry.realProcessPid) {
      entry.realProcessPid = processPid;
      entry.language = language;
      shellToProcessPid.set(shellPid, processPid);
      console.log(`[PID Registry] Linked shell PID ${shellPid} -> ${language} PID ${processPid} (${blockName})`);
      break;
    }
  }
  registerPidWithServer(processPid, blockName);
};
const onBlockStopped = (blockId, blockName) => {
  const processPid = blockIdToProcessPid.get(String(blockId));
  if (processPid) {
    unregisterPidWithServer(processPid, blockName);
    blockIdToProcessPid.delete(String(blockId));
  }
};
const createWindow = async () => {
  console.log("\n╔════════════════════════════════════════╗");
  console.log("║   ELECTRON MAIN PROCESS STARTING      ║");
  console.log("╚════════════════════════════════════════╝\n");
  instanceId = generateInstanceId();
  serverPort = await findAvailablePort(9e3);
  matlabPort = await findAvailablePort(9001);
  cppPort = await findAvailablePort(9002);
  console.log("========================================");
  console.log("INSTANCE CONFIGURATION");
  console.log("========================================");
  console.log(`Instance ID:  ${instanceId}`);
  console.log(`Server Port:  ${serverPort}`);
  console.log(`MATLAB Port:  ${matlabPort}`);
  console.log(`C++ Port:     ${cppPort}`);
  console.log("========================================\n");
  const primaryDisplay = require$$3$1.screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  const windowWidth = Math.min(1400, Math.floor(width * 0.9));
  const windowHeight = Math.min(900, Math.floor(height * 0.9));
  console.log("Creating browser window...");
  mainWindow = new require$$3$1.BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: primaryDisplay.bounds.x + Math.floor((width - windowWidth) / 2),
    y: primaryDisplay.bounds.y + Math.floor((height - windowHeight) / 2),
    webPreferences: {
      preload: path$1.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  {
    mainWindow.loadURL("http://localhost:5173");
    console.log("✓ Loaded development URL");
  }
  mainWindow.webContents.openDevTools();
  console.log("✓ DevTools opened\n");
  mainWindow.on("close", async (e) => {
    console.log("\n[CLEANUP] Window closing...");
    e.preventDefault();
    await cleanupAllProcesses();
    if (serverSocket) {
      serverSocket.destroy();
      serverSocket = null;
    }
    stopLanguageSocketServers();
    mainWindow.destroy();
    console.log("[CLEANUP] Complete\n");
  });
  console.log("╔════════════════════════════════════════╗");
  console.log("║   STARTING SOCKET SERVERS NOW         ║");
  console.log("╚════════════════════════════════════════╝\n");
  startLanguageSocketServers();
  console.log("╔════════════════════════════════════════╗");
  console.log("║   SOCKET SERVERS INITIALIZATION DONE  ║");
  console.log("╚════════════════════════════════════════╝\n");
};
const killProcessTree = (pid) => {
  return new Promise((resolve) => {
    if (process.platform === "win32") {
      require$$1$1.exec(`taskkill /pid ${pid} /T /F`, () => resolve());
    } else {
      try {
        process.kill(-pid, "SIGTERM");
      } catch (_) {
      }
      resolve();
    }
  });
};
const cleanupAllProcesses = async () => {
  console.log("[CLEANUP] Cleaning up all processes...");
  for (const [pid, info] of runningProcesses.entries()) {
    try {
      await killProcessTree(pid);
      try {
        info.process.kill("SIGKILL");
      } catch (_) {
      }
    } catch (err) {
      console.error(`[CLEANUP] Error killing process ${pid}:`, err);
    }
  }
  runningProcesses.clear();
  shellToProcessPid.clear();
  blockIdToProcessPid.clear();
  console.log("[CLEANUP] All processes cleaned up");
};
const connectToServer = (port, retries = 30) => {
  return new Promise((resolve, reject) => {
    let attemptCount = 0;
    const attemptConnection = () => {
      attemptCount++;
      console.log(`[SERVER CONNECT] Connecting to pipe server on port ${port} (attempt ${attemptCount}/${retries})...`);
      const client = new net.Socket();
      client.setTimeout(1e3);
      client.connect(port, "127.0.0.1", () => {
        console.log(`[SERVER CONNECT] ✓ Connected to C++ server on port ${port}`);
        serverSocketConnected = true;
        mainWindow.webContents.send("server-socket-status", { connected: true, port });
        client.setTimeout(0);
        resolve(client);
      });
      client.on("data", (data) => {
        const messages = data.toString().split("\n").filter((msg) => msg.trim());
        messages.forEach((msg) => {
          try {
            mainWindow.webContents.send("server-message", JSON.parse(msg));
          } catch (err) {
            console.error("[SERVER CONNECT] Failed to parse server message:", msg, err);
          }
        });
      });
      client.on("error", (error) => {
        if (error.code === "ECONNRESET") return;
        if (error.code === "ECONNREFUSED" && attemptCount < retries) {
          setTimeout(attemptConnection, 500);
        } else if (serverSocketConnected) {
          mainWindow.webContents.send("server-socket-status", { connected: false, error: error.message });
        } else {
          reject(error);
        }
      });
      client.on("close", () => {
        serverSocketConnected = false;
        serverSocket = null;
        mainWindow.webContents.send("server-socket-status", { connected: false });
      });
      client.on("timeout", () => {
        client.destroy();
        if (attemptCount < retries) setTimeout(attemptConnection, 500);
        else reject(new Error("Connection timeout"));
      });
    };
    attemptConnection();
  });
};
const startLanguageSocketServers = () => {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  INITIALIZING LANGUAGE SOCKET SERVERS");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  console.log(`[MATLAB SERVER] Creating server for port ${matlabPort}...`);
  try {
    matlabSocketServer = net.createServer((client) => {
      const clientId = `${client.remoteAddress}:${client.remotePort}`;
      console.log(`[MATLAB SERVER] ✓ Client connected: ${clientId}`);
      matlabClients.set(clientId, { socket: client, buffer: "" });
      client.on("data", (data) => {
        const info = matlabClients.get(clientId);
        if (!info) return;
        info.buffer += data.toString();
        const lines = info.buffer.split("\n");
        info.buffer = lines.pop();
        lines.forEach((line) => {
          if (!line.trim()) return;
          try {
            const parsed = JSON.parse(line);
            console.log(`[MATLAB SERVER] Received message from ${clientId}:`, parsed.type, `(block: ${parsed.blockName})`);
            if (parsed.type === "BLOCK_INIT" && parsed.pid && parsed.pid > 0) {
              onBlockInit(parsed.blockId, parsed.blockName, parsed.pid, "MATLAB");
            }
            if (parsed.type === "BLOCK_STOPPED" || parsed.type === "BLOCK_ERROR") {
              onBlockStopped(parsed.blockId, parsed.blockName);
            }
            mainWindow.webContents.send("block-message", { ...parsed, language: "MATLAB" });
          } catch (err) {
            console.error(`[MATLAB SERVER] Parse error from ${clientId}:`, err, "Data:", line);
          }
        });
      });
      client.on("close", () => {
        console.log(`[MATLAB SERVER] Client disconnected: ${clientId}`);
        matlabClients.delete(clientId);
      });
      client.on("error", (err) => {
        console.error(`[MATLAB SERVER] Client error ${clientId}:`, err.message);
        matlabClients.delete(clientId);
      });
    });
    matlabSocketServer.on("error", (err) => {
      console.error(`[MATLAB SERVER] ✗ SERVER ERROR:`, err.message);
      if (err.code === "EADDRINUSE") {
        console.error(`[MATLAB SERVER] ✗ Port ${matlabPort} is already in use!`);
      }
    });
    matlabSocketServer.listen(matlabPort, "127.0.0.1", () => {
      console.log(`[MATLAB SERVER] ✓✓✓ LISTENING ON 127.0.0.1:${matlabPort} ✓✓✓`);
      console.log(`[MATLAB SERVER] Ready to accept MATLAB block connections
`);
    });
  } catch (err) {
    console.error(`[MATLAB SERVER] ✗ Failed to create server:`, err);
  }
  console.log(`[C++ SERVER] Creating server for port ${cppPort}...`);
  try {
    cppSocketServer = net.createServer((client) => {
      const clientId = `${client.remoteAddress}:${client.remotePort}`;
      console.log(`[C++ SERVER] ✓ Client connected: ${clientId}`);
      cppClients.set(clientId, { socket: client, buffer: "" });
      client.on("data", (data) => {
        const info = cppClients.get(clientId);
        if (!info) return;
        info.buffer += data.toString();
        const lines = info.buffer.split("\n");
        info.buffer = lines.pop();
        lines.forEach((line) => {
          if (!line.trim()) return;
          try {
            const parsed = JSON.parse(line);
            console.log(`[C++ SERVER] Received message from ${clientId}:`, parsed.type, `(block: ${parsed.blockName})`);
            if (parsed.type === "BLOCK_INIT" && parsed.pid && parsed.pid > 0) {
              onBlockInit(parsed.blockId, parsed.blockName, parsed.pid, "C++");
            }
            if (parsed.type === "BLOCK_STOPPED" || parsed.type === "BLOCK_ERROR") {
              onBlockStopped(parsed.blockId, parsed.blockName);
            }
            mainWindow.webContents.send("block-message", { ...parsed, language: "C++" });
          } catch (err) {
            console.error(`[C++ SERVER] Parse error from ${clientId}:`, err, "Data:", line);
          }
        });
      });
      client.on("close", () => {
        console.log(`[C++ SERVER] Client disconnected: ${clientId}`);
        cppClients.delete(clientId);
      });
      client.on("error", (err) => {
        console.error(`[C++ SERVER] Client error ${clientId}:`, err.message);
        cppClients.delete(clientId);
      });
    });
    cppSocketServer.on("error", (err) => {
      console.error(`[C++ SERVER] ✗ SERVER ERROR:`, err.message);
      if (err.code === "EADDRINUSE") {
        console.error(`[C++ SERVER] ✗ Port ${cppPort} is already in use!`);
      }
    });
    cppSocketServer.listen(cppPort, "127.0.0.1", () => {
      console.log(`[C++ SERVER] ✓✓✓ LISTENING ON 127.0.0.1:${cppPort} ✓✓✓`);
      console.log(`[C++ SERVER] Ready to accept C++ block connections
`);
    });
  } catch (err) {
    console.error(`[C++ SERVER] ✗ Failed to create server:`, err);
  }
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  SOCKET SERVER INITIALIZATION COMPLETE");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
};
const stopLanguageSocketServers = () => {
  console.log("[SHUTDOWN] Stopping language socket servers...");
  if (matlabSocketServer) {
    matlabClients.forEach((info) => {
      try {
        info.socket.destroy();
      } catch (_) {
      }
    });
    matlabClients.clear();
    matlabSocketServer.close();
    matlabSocketServer = null;
    console.log("[SHUTDOWN] MATLAB Socket Server stopped");
  }
  if (cppSocketServer) {
    cppClients.forEach((info) => {
      try {
        info.socket.destroy();
      } catch (_) {
      }
    });
    cppClients.clear();
    cppSocketServer.close();
    cppSocketServer = null;
    console.log("[SHUTDOWN] C++ Socket Server stopped");
  }
};
require$$3$1.ipcMain.handle("get-instance-config", async () => {
  console.log("[IPC] get-instance-config called");
  return { instanceId, serverPort, matlabPort, cppPort };
});
require$$3$1.ipcMain.handle("get-app-path", async () => {
  const cwd = process.cwd();
  console.log("[IPC] get-app-path called:", cwd);
  return cwd;
});
require$$3$1.ipcMain.handle("get-next-block-id", async () => {
  const id = blockIdCounter++;
  console.log(`[IPC] get-next-block-id called: returning ${id}`);
  return id;
});
require$$3$1.ipcMain.handle("read-file", async (event, filepath) => {
  try {
    return await fs.readFile(filepath, "utf-8");
  } catch (err) {
    throw new Error(`Failed to read file: ${err.message}`);
  }
});
require$$3$1.ipcMain.handle("write-file", async (event, filepath, content) => {
  try {
    await fs.writeFile(filepath, content, "utf-8");
    return { success: true };
  } catch (err) {
    throw new Error(`Failed to write file: ${err.message}`);
  }
});
require$$3$1.ipcMain.handle("select-file", async (event, filters) => {
  const result = await require$$3$1.dialog.showOpenDialog(mainWindow, {
    properties: ["openFile", "multiSelections"],
    filters: filters || [{ name: "All Files", extensions: ["*"] }]
  });
  return result.filePaths;
});
require$$3$1.ipcMain.handle("save-file-dialog", async (event, defaultPath, filters) => {
  const result = await require$$3$1.dialog.showSaveDialog(mainWindow, {
    defaultPath,
    filters: filters || [{ name: "All Files", extensions: ["*"] }]
  });
  return result.filePath;
});
require$$3$1.ipcMain.handle("select-directory", async () => {
  const result = await require$$3$1.dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"] });
  return result.filePaths[0];
});
require$$3$1.ipcMain.handle("ensure-dir", async (event, dirpath) => {
  try {
    await fs.mkdir(dirpath, { recursive: true });
    return { success: true };
  } catch (err) {
    throw new Error(`Failed to create directory: ${err.message}`);
  }
});
require$$3$1.ipcMain.handle("exec-command", async (event, command, cwd) => {
  console.log(`[IPC] exec-command: ${command.substring(0, 100)}...`);
  try {
    const { stdout, stderr } = await execAsync(command, { cwd: cwd || process.cwd(), shell: true, windowsHide: true });
    return { success: true, stdout, stderr };
  } catch (err) {
    return { success: false, error: err.message, stdout: err.stdout, stderr: err.stderr };
  }
});
require$$3$1.ipcMain.handle("start-server-with-socket", async (event, command, cwd, processName) => {
  console.log(`[IPC] start-server-with-socket: ${processName}`);
  try {
    const child = require$$1$1.spawn(command, [], {
      cwd: cwd || process.cwd(),
      shell: true,
      detached: false,
      windowsHide: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const pid = child.pid;
    if (!pid) throw new Error("Failed to get process PID");
    runningProcesses.set(pid, { process: child, name: processName || "unnamed", command, startTime: /* @__PURE__ */ new Date(), isServer: true });
    child.stdout.on("data", (data) => console.log(`[${processName}] STDOUT:`, data.toString()));
    child.stderr.on("data", (data) => console.log(`[${processName}] STDERR:`, data.toString()));
    child.on("exit", (code, signal) => {
      runningProcesses.delete(pid);
      mainWindow.webContents.send("process-output", { pid, type: "exit", name: processName, code, signal });
    });
    child.on("error", () => runningProcesses.delete(pid));
    setTimeout(async () => {
      try {
        serverSocket = await connectToServer(serverPort, 30);
      } catch (err) {
        mainWindow.webContents.send("server-socket-status", { connected: false, error: "Failed to connect to server" });
      }
    }, 500);
    return { success: true, pid };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
require$$3$1.ipcMain.handle("start-process", async (event, command, cwd, processName) => {
  console.log(`[IPC] start-process: ${processName}`);
  console.log(`[IPC]   Command: ${command.substring(0, 200)}...`);
  try {
    const child = require$$1$1.spawn(command, [], {
      cwd: cwd || process.cwd(),
      shell: true,
      detached: false,
      windowsHide: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const shellPid = child.pid;
    if (!shellPid) throw new Error("Failed to get process PID");
    runningProcesses.set(shellPid, {
      process: child,
      name: processName || "unnamed",
      command,
      startTime: /* @__PURE__ */ new Date(),
      realProcessPid: null
    });
    console.log(`[PROCESS] Started ${processName} (Shell PID: ${shellPid})`);
    console.log(`[PROCESS]   Waiting for block to self-report via BLOCK_INIT...`);
    mainWindow.webContents.send("process-output", {
      pid: shellPid,
      type: "started",
      name: processName,
      data: `Process started: ${processName || command}`
    });
    child.stdout.on("data", (data) => {
      const output = data.toString();
      console.log(`[${shellPid}/${processName}] STDOUT:`, output);
      mainWindow.webContents.send("process-output", { pid: shellPid, type: "stdout", name: processName, data: output });
    });
    child.stderr.on("data", (data) => {
      const output = data.toString();
      console.log(`[${shellPid}/${processName}] STDERR:`, output);
      mainWindow.webContents.send("process-output", { pid: shellPid, type: "stderr", name: processName, data: output });
    });
    child.on("exit", (code, signal) => {
      var _a;
      console.log(`[PROCESS] ${processName} (Shell PID: ${shellPid}) exited with code ${code}`);
      const realPid = (_a = runningProcesses.get(shellPid)) == null ? void 0 : _a.realProcessPid;
      if (realPid) {
        unregisterPidWithServer(realPid, processName || "unnamed");
      }
      shellToProcessPid.delete(shellPid);
      runningProcesses.delete(shellPid);
      mainWindow.webContents.send("process-output", { pid: shellPid, type: "exit", name: processName, code, signal });
    });
    child.on("error", (err) => {
      var _a;
      console.error(`[PROCESS] ${processName} (Shell PID: ${shellPid}) error:`, err);
      const realPid = (_a = runningProcesses.get(shellPid)) == null ? void 0 : _a.realProcessPid;
      if (realPid) unregisterPidWithServer(realPid, processName || "unnamed");
      shellToProcessPid.delete(shellPid);
      runningProcesses.delete(shellPid);
      mainWindow.webContents.send("process-output", { pid: shellPid, type: "error", name: processName, data: err.message });
    });
    return { success: true, pid: shellPid };
  } catch (err) {
    console.error(`[PROCESS] Failed to start ${processName}:`, err);
    return { success: false, error: err.message };
  }
});
require$$3$1.ipcMain.handle("kill-process", async (event, pid) => {
  try {
    const processInfo = runningProcesses.get(pid);
    if (!processInfo) return { success: false, error: "Process not found" };
    const realPid = processInfo.realProcessPid || shellToProcessPid.get(pid);
    if (realPid) unregisterPidWithServer(realPid, processInfo.name);
    shellToProcessPid.delete(pid);
    for (const [bId, mPid] of blockIdToProcessPid.entries()) {
      if (mPid === realPid) {
        blockIdToProcessPid.delete(bId);
        break;
      }
    }
    await killProcessTree(pid);
    try {
      processInfo.process.kill("SIGTERM");
    } catch (_) {
    }
    setTimeout(() => {
      try {
        processInfo.process.kill("SIGKILL");
      } catch (_) {
      }
    }, 1e3);
    runningProcesses.delete(pid);
    mainWindow.webContents.send("process-output", { pid, type: "killed", name: processInfo.name, data: "Process terminated" });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
require$$3$1.ipcMain.handle("get-running-processes", async () => {
  const processes = Array.from(runningProcesses.entries()).map(([pid, info]) => ({
    pid,
    realProcessPid: info.realProcessPid || null,
    name: info.name,
    command: info.command,
    startTime: info.startTime,
    language: info.language || "unknown"
  }));
  return { success: true, processes };
});
require$$3$1.ipcMain.handle("kill-all-processes", async () => {
  for (const [shellPid, info] of runningProcesses.entries()) {
    if (!info.isServer && info.realProcessPid) {
      unregisterPidWithServer(info.realProcessPid, info.name);
    }
  }
  shellToProcessPid.clear();
  blockIdToProcessPid.clear();
  await cleanupAllProcesses();
  return { success: true, killedCount: runningProcesses.size };
});
require$$3$1.ipcMain.handle("send-to-server", async (event, message) => {
  if (!serverSocket || !serverSocketConnected) return { success: false, error: "Server not connected" };
  try {
    serverSocket.write(JSON.stringify(message) + "\n");
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
require$$3$1.app.whenReady().then(() => {
  console.log("[APP] Electron app is ready");
  createWindow();
  require$$3$1.app.on("activate", () => {
    if (require$$3$1.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
require$$3$1.app.on("window-all-closed", async () => {
  console.log("[APP] All windows closed");
  await cleanupAllProcesses();
  if (serverSocket) {
    serverSocket.destroy();
    serverSocket = null;
  }
  stopLanguageSocketServers();
  if (process.platform !== "darwin") require$$3$1.app.quit();
});
require$$3$1.app.on("before-quit", async () => {
  console.log("[APP] App quitting...");
  await cleanupAllProcesses();
  if (serverSocket) {
    serverSocket.destroy();
    serverSocket = null;
  }
  stopLanguageSocketServers();
});
process.on("SIGINT", async () => {
  console.log("[APP] SIGINT received");
  await cleanupAllProcesses();
  if (serverSocket) {
    serverSocket.destroy();
    serverSocket = null;
  }
  process.exit(0);
});
process.on("SIGTERM", async () => {
  console.log("[APP] SIGTERM received");
  await cleanupAllProcesses();
  if (serverSocket) {
    serverSocket.destroy();
    serverSocket = null;
  }
  process.exit(0);
});
