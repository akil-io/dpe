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
            prefix: ''
        };
        debug('start service with ', _options);
        this.confPath = path.join(os.homedir(), '.dpe', 'config.json');
        _options.init ? this.init(_options) : this.load(_options);
        this.enable = false;
        this.initSignal = _signal;
    }

    connect(_url, _port, _data, _ready) {
        var socket = require('socket.io-client')(`${_url}:${_port}`, {
            transports: ['websocket'],
            query: qs.stringify(_data)
        });
        socket.on('connect', _.once(function () {
            debug(`connected to ${_url}:${_port}`);
            _ready(null, {
                request: function (msg) { socket.emit('client.request', msg) },
                response: function (msg) { socket.emit('client.response', msg) },
                onRequest: function (_cb) { socket.on('server.request', _cb) },
                onResponse: function (_cb) { socket.on('server.response', _cb) },
                close: function () { socket.end(); }
            });
        }));
        socket.on('connect_error', _.once(function (err) {
            debug(`Can not connect to ${_url}:${_port}`);
            _ready(err);
        }));
    }

    init(_options) {
        this._config = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../config/default.json'), 'utf8'));

        this.set('usage.firstTime', Date.now());

        this.set('net.servers', {});
        this.set('local.key', hash.update(uuid.v4()).digest('hex'));

        this.set('pid', path.join(os.homedir(), '.dpe', 'tmp', _options.prefix
            + 'service.pid'));
        this.set('repl.socket', path.join(os.homedir(), '.dpe', 'tmp', _options.prefix
         + 'repl.socket'));
        this.set('log.out', path.join(os.homedir(), '.dpe', 'log', _options.prefix
            + 'service.log'));
        this.set('log.err', path.join(os.homedir(), '.dpe', 'log', _options.prefix
            + 'error.log'));
        this.set('module.path', path.join(os.homedir(), '.dpe', 'modules'));
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
            this.set('pid', path.join(os.homedir(), '.dpe', 'tmp', _options.prefix
                + 'service.pid'));
            this.set('repl.socket', path.join(os.homedir(), '.dpe', 'tmp', _options.prefix
                + 'repl.socket'));
            this.set('log.out', path.join(os.homedir(), '.dpe', 'log', _options.prefix
                + 'service.log'));
            this.set('log.err', path.join(os.homedir(), '.dpe', 'log', _options.prefix
                + 'error.log'));
        }
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
            fs.writeFileSync(this.get('pid'), process.pid, 'utf8');

            //start core
            this._core = new Core(this);

            //start repl
            this._tcpServer = net.createServer((socket) => {
                this._repl = repl.start({
                    prompt: 'DPE> ',
                    input: socket,
                    output: socket
                });
                this._repl.on('exit', () => {
                    socket.end();
                });
                this._repl.context.service = this;
                this._repl.context.core = this._core;
            });

            this._tcpServer.listen(this.get('repl.socket'), () => {
                Service.log(`Service started with pid:${process.pid} in ${this.get('pid')} and repl socket ${this.get('repl.socket')}`);
                this._core.init(this.initSignal);
            });

            var handler = function(req, res) {
                res.end();
            };
            var app = require('http').createServer(handler);
            this.io = require('socket.io')(app, {
                serveClient: false,
                transports: ['websocket']
            });

            app.listen(this.get("cli.port"));
            this.io.on('connection', (socket) => {
                debug('connected: ', socket.id);
                this._core.onClientConnected(socket.id, {
                    request: function (msg) { socket.emit('server.request', msg) },
                    response: function (msg) { socket.emit('server.response', msg) },
                    onRequest: function (_cb) { socket.on('client.request', _cb) },
                    onResponse: function (_cb) { socket.on('client.response', _cb) },
                    close: function () { socket.end(); }
                }, {
                    type: "client",
                    ip: socket.handshake.address,
                    time: socket.handshake.time
                }, socket.handshake.query);

                socket.on('disconnect', () => {
                    this._core.onClientDisconnected(socket.id);
                    debug('disconnected: ' + socket.id);
                });
            });


            process.on('beforeExit', this.stop.bind(this));
            process.on('exit', this.stop.bind(this));
            process.on('disconnect', this.stop.bind(this));
            process.on('uncaughtException', this.stop.bind(this));

            process.on('SIGINT', this.stop.bind(this));
            process.on('SIGTERM', this.stop.bind(this));
            process.on('SIGHUP', this.stop.bind(this));
            //process.on('SIGKILL', this.stop.bind(this));

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
            fs.unlinkSync(this.get('pid'));
            fs.unlinkSync(this.get('repl.socket'));

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