"use strict";

const debug = require('debug')('dpe:service'),
    async   = require('async'),
    path    = require('path'),
    util    = require('util'),
    http    = require('http'),
    os      = require('os'),
    fs      = require('fs'),
    _       = require('lodash');

const net = require('net');
const repl = require('repl');

var Core = require('./core');

class Service {
    constructor(_options, _signal) {
        if (!_options) _options = {
            init: false
        };
        this.confPath = path.join(os.homedir(), '.dpe', 'config.json');
        _options.init ? this.init(_options) : this.load(_options);
        this.enable = false;
        this.initSignal = _signal;
    }

    init(_options) {
        this._config = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../config/default.json'), 'utf8'));

        this.set('usage.firstTime', Date.now());
        this.set('pid', path.join(os.homedir(), '.dpe', 'tmp', 'service.pid'));
        this.set('repl.socket', path.join(os.homedir(), '.dpe', 'tmp', 'repl.socket'));
        this.set('cli.port', 49001);
        this.set('log.out', path.join(os.homedir(), '.dpe', 'log', 'dpe-service.log'));
        this.set('log.err', path.join(os.homedir(), '.dpe', 'log', 'dpe-error.log'));
        this.set('module.path', path.join(os.homedir(), '.dpe', 'modules'));
    }

    load() {
        this._config =  JSON.parse(fs.readFileSync(this.confPath, 'utf8'));
    }

    save() {
        fs.writeFileSync(this.confPath, JSON.stringify(this._config, null, '  '));
    }

    get(path) {
        return _.get(this._config, path);
    }
    set(path, value) {
        process.nextTick(() => {
            this.save();
        });
        return _.set(this._config, path, value);
    }

    start() {
        if (!this.enable) {
            this.enable = true;
            fs.writeFileSync(this.get('pid'), process.pid, 'utf8');

            //start core
            var _core = new Core(this);

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
                this._repl.context.core = _core;
            });

            this._tcpServer.listen(this.get('repl.socket'), () => {
                Service.log(`Service started with pid:${process.pid} in ${this.get('pid')} and repl socket ${this.get('repl.socket')}`);
                _core.init(this.initSignal);
            });

            var handler = function(req, res) {
                res.end();
            };
            var app = require('http').createServer(handler);
            var io = require('socket.io')(app, {
                serveClient: false,
                transports: ['websocket']
            });

            app.listen(this.get("cli.port"));
            io.on('connection', (socket) => {
                debug('connected: ' + socket.id);
                _core.onClientConnected(socket.id, (msg) => {
                    socket.emit('echo', msg);
                });

                socket.on('signal.create', (argv) => {
                    if (argv.file) {
                        fs.readFile(argv.file, 'utf8', (err, content) => {
                           _core.send(socket.id, JSON.parse(content));
                        });
                    } else {
                        _core.send(socket.id, argv);
                    }
                });

                socket.on('disconnect', () => {
                    _core.onClientDisconnected(socket.id);
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