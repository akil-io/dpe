"use strict";

const debug = require('debug')('dpe:service'),
    async   = require('async'),
    path    = require('path'),
    util    = require('util'),
    http    = require('http'),
    os      = require('os'),
    fs      = require('fs'),
    _       = require('lodash');

const qs = require('querystring');
const url = require('url');
const crypto = require('crypto');
const hash = crypto.createHash('sha256');
const uuid = require('node-uuid');

const net = require('net');
const repl = require('repl');

var Core = require('./core');

class Service {
    constructor(_options, _signal) {
        if (!_options) _options = {
            init: false,
            prefix: '',
            tags: [],
            coreModule: 'base',
            keepConnections: true,
            autoDiscover: true
        };
        debug('start service with ', _options);
        this.confDir = _options.config ? _options.config : path.join(os.homedir(), '.dpe');
        this.confPath = path.join(this.confDir, 'config.json');

        this.coreModule = _options.coreModule ? _options.coreModule : 'base';
        this.keepConnections = (_options.keepConnections != undefined) ? _options.keepConnections : true;
        this.autoDiscover = (_options.autoDiscover != undefined) ? _options.autoDiscover : true;

        _options.init ? this.init(_options) : this.load(_options);
        this.enable = false;
        this.initSignal = _signal;
        this.sockets = new Map();
    }

    connect(_url, _data, _ready) {
        _url = url.parse(_url);
        var md5 = crypto.createHash('md5');
        var urlHash = md5.update(_url.href).digest('hex');
        var authConfig = this.get('net.auth.' + urlHash);
        var authKey = null;

        if (_data.auth) authKey = _data.auth;
        else if (authConfig) authKey = authConfig.key;

        debug('CONNECT-TO: ' + _url.href, authKey);

        if (!this.sockets.get(_url.href)) {
            debug(`create new socket for ${_url.href}`);
            var options = {
                transports: ['websocket'],
                query: qs.stringify(_data),
                skipReconnect: true
            };
            if (authKey) {
                options.extraHeaders = {
                    'Authorization': 'Basic ' + authKey
                };
            }
            this.sockets.set(_url.href, require('socket.io-client')(_url.href, options));
        }
        const socket = this.sockets.get(_url.href);

        socket.on('error', _.once(function (err) {
          debug(`error: an not connect to ${_url.href}`, err);
          _ready(err);
        }));

        socket.on('connect_error', _.once(function (err) {
          debug(`connect error: can not connect to ${_url.href}`, err);
          _ready(err);
        }));

        socket.on('connect', _.once(() => {
            debug(`connected to ${_url.href}`);
            _ready(null, socket.id, {
                request: (msg) => { socket.emit('client.request', msg) },
                response: (msg) => { socket.emit('client.response', msg) },
                onRequest: (_cb) => { socket.on('server.request', _cb) },
                onResponse: (_cb) => { socket.on('server.response', _cb) },
                onClose: (_cb) => { socket.on('disconnect', _cb) },
                onError: (_cb) => { socket.on('error', _cb) },
                close: () => {
                    socket.disconnect();
                    this.sockets.delete(_url.href);
                }
               });
        }));
    }

    init(_options) {
        this._config = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../config/default.json'), 'utf8'));

        this.set('usage.firstTime', Date.now());

        this.set('net.servers', {});
        this.set('local.key', hash.update(uuid.v4()).digest('hex'));

        this.set('pid', path.join(this.confDir, 'tmp', _options.prefix
            + 'service.pid'));
        this.set('log.out', path.join(this.confDir, 'log', _options.prefix
            + 'service.log'));
        this.set('log.err', path.join(this.confDir, 'log', _options.prefix
            + 'error.log'));
        this.set('module.path', path.join(this.confDir, 'modules'));
        if (_options.port) {
            this.set("cli.port", _options.port);
        }
    }

    load(_options) {
        this._config = JSON.parse(fs.readFileSync(this.confPath, 'utf8'));
        if (_options.port) {
            this.set("cli.port", _options.port);
        }
        if (_options.prefix) {
            this.set('pid', path.join(this.confDir, 'tmp', _options.prefix
                + 'service.pid'));
            this.set('repl.socket', path.join(this.confDir, 'tmp', _options.prefix
                + 'repl.socket'));
            this.set('log.out', path.join(this.confDir, 'log', _options.prefix
                + 'service.log'));
            this.set('log.err', path.join(this.confDir, 'log', _options.prefix
                + 'error.log'));
        }
        this.set('tags', _options.tags);
    }

    save() {
        fs.writeFileSync(this.confPath, JSON.stringify(this._config, null, '  '));
    }

    get(path) {
        return _.get(this._config, path);
    }

    set(path, value) {
        debug('set ' + path + ": " + value);
        return _.set(this._config, path, value);
    }

    unset(path) {
        return _.unset(this._config, path);
    }

    start() {
        if (!this.enable) {
            this.enable = true;
            //fs.writeFileSync(this.get('pid'), process.pid, 'utf8');

            var handler = function(req, res) {
                res.end();
            };
            var app = require('http').createServer(handler);
            this.io = require('socket.io')(app, {
                serveClient: false,
                transports: ['websocket']
            });

            app.listen(this.get("cli.port"), () => {
                debug('Listen on ' + app.address().port);
                this.set('cli.port', app.address().port);

                //start core
                this._core = new Core(this);
                this._core.init(this.initSignal);
            });

            this.io.on('connection', (socket) => {
                debug('connected: ', socket.id);
                this._core.onClientConnected(socket.id, {
                    request: function (msg) { socket.emit('server.request', msg) },
                    response: function (msg) { socket.emit('server.response', msg) },
                    onRequest: function (_cb) { socket.on('client.request', _cb) },
                    onResponse: function (_cb) { socket.on('client.response', _cb) },
                    onClose: function (_cb) { socket.on('disconnect', _cb) },
                    onError: function (_cb) { socket.on('error', _cb) },
                    close: function () { socket.disconnect(); }
                }, {
                    type: "client",
                    host: socket.handshake.address,
                    time: socket.handshake.time,
                    zone: -1
                }, socket.handshake.query);

                socket.on('disconnect', () => {
                    //this._core.onClientDisconnected(socket.id);
                    debug('disconnected: ' + socket.id);
                });
            });


            process.on('beforeExit', this.stop.bind(this));
            process.on('uncaughtException', this.stop.bind(this));
            //process.on('SIGINT', this.stop.bind(this));

            /*process.on('exit', this.stop.bind(this));
            process.on('disconnect', this.stop.bind(this));

            process.on('SIGTERM', this.stop.bind(this));
            process.on('SIGHUP', this.stop.bind(this));
            //process.on('SIGKILL', this.stop.bind(this));*/

            process.on('warning', (warning) => {
                Service.error(warning);
            });
        }
    }

    stop(err) {
        if (this.enable) {
            this.enable = false;
            if (err) {
                Service.error(err);
            }

            Service.log(`Service stopped.`);
            process.exit();
        }
    }

    getPid() {
        try {
            var content = fs.readFileSync(this.get('pid'), 'utf8');
            return parseInt(content);
        } catch (err) {
            return null;
        }
    }

    static log(msg, data) {
        console.log([
            (new Date()).toUTCString(),
            msg,
            data ? util.inspect(data) : '-'
        ].join(' '));
    }

    static error(err, context) {
        console.log([
            (new Date()).toUTCString(),
            err.name,
            err.message,
            util.inspect(err.stack),
            context ? util.inspect(context) : '-'
        ].join(' '));
    }
}

module.exports = Service;
