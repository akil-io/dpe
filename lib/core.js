"use strict";

const debug = require('debug')('dpe:core'),
    async   = require('async'),
    path    = require('path'),
    util    = require('util'),
    uuid    = require('node-uuid'),
    fs      = require('fs'),
    _       = require('lodash');

var Signal = require('./signal');
var Client = require('./client');
var API = require('./api');
var Process = require('./process');

var EventEmitter2 = require('eventemitter2').EventEmitter2;

class Core {
    constructor(_service) {
        this.service = _service;
        //noinspection JSUnresolvedVariable
        this.queue = async.priorityQueue(this.handle.bind(this), 1);
        this.queue.drain = this.onDrain.bind(this);

        this.context = {};
        this.instance = new Map();
        this.client = new Map();
        this.process = new Map();

        this._keep = _.values(this.service.get('net.servers'));

        this.baseAPI = require('./module')(this, API);
    }

    init(_packages) {
        debug('core init with: ', _packages);

        _packages.map((packageName) => {
            if (!this.service.get('deps.' + packageName)) {
                debug('skip: ' + packageName);
            } else {
                var pack = require(this.service.get('deps.' + packageName).require);
                debug('package: ' + packageName);

                Object.keys(pack).map((moduleName) => {
                    var module = require(path.resolve(path.dirname(this.service.get('deps.' + packageName).require), pack[moduleName].require));
                    debug('\tmodule: ' + moduleName);

                    Object.keys(module).map((methodName) => {
                        this.instance.set(`${moduleName}.${methodName}`, new API(
                            `${moduleName}.${methodName}`,
                            {
                                access: "module"
                            },
                            module[methodName]
                        ));
                        debug('\t\tmethod: ' + methodName);
                    });
                });
            }
        });
        debug("core loaded");

        this.keepConnection();

        setInterval(this.keepConnection.bind(this), 60000);
    }

    keepConnection() {
        if (this._keep.length) {
            debug('keep check');
            this._keep.map((server) => {
                var _cid = server.protocol + "//" + server.hostname + ":" + server.port;
                if (!this.client.has(_cid)) {
                    this.baseAPI.connect(this, {
                        url: server.protocol + "//" + server.hostname,
                        port: server.port
                    }, debug);
                }
            });
        }
    }

    onDrain() {
        debug('queue is empty');
    }

    onClientConnected(_cid, _api, _meta, _data) {
        debug('add client');
        if (_data.uid) {
            _meta.uid = _data.uid;
        }
        if (_data.uid == "local") {
            _meta.type = "cli";
            if (_data.key == this.service.get('local.key')) {
                _meta.type = "local-cli";
            }
        }

        this.client.set(_cid, new Client(_cid, _api, _meta));
        this.client.get(_cid).onRequest((_signal) => {
            debug('catch request');
            this.send(new Signal(Object.assign(_signal, {
                _cid: _cid
            })));
        });

        this.client.get(_cid).onClose(() => {
            this.onClientDisconnected(_cid);
        });

        this.client.get(_cid).onError((err) => {
            debug('client error: ', _cid, err);
            this.onClientDisconnected(_cid);
        });

        if (["cli", "local-cli"].indexOf(_meta.type) == -1) {
            this.client.get(_cid).request(new Signal({
                _cid: "self",
                "instance.list": {
                    export: true
                }
            }), (_signal) => {
                var exportList = _signal.get('instance.list');
                if (exportList && exportList['$result']) exportList = exportList['$result'];
                debug("REMOTE INSTANCES:", exportList);
                exportList.map((item) => {
                    if (!this.instance.has(item.name)) {
                        debug('export: ' + item.name);
                        this.instance.set(item.name, new API(item.name, {
                                access: "module",
                                from: _cid
                            }, this.getRemoteCallAPI(item.name)
                        ));
                    } else {
                        this.instance.get(item.name).from.push(_cid);
                    }
                });
            });
        }
    }

    getRemoteCallAPI(_name) {
        return (function (env, args, callback) {
            var _cid = this.instance.get(_name).select(this.client);
            if (!_cid) {
                return callback(new Error('E_NO_INSTANCE'));
            }
            if (this.client.has(_cid)) {
                var rawSignal = {};
                rawSignal[_name] = args;
                this.client.get(_cid).request(new Signal(rawSignal), (_response) => {
                    debug("remote answer:", _response);
                    if (_response.get('$error')) {
                        return callback(new Error(_response.get('$error')));
                    }
                    if (_response.get(_name)) {
                        return callback(null, _response.get(_name));
                    }
                    return callback(new Error('E_FAILED'));
                });
            }
        }).bind(this);
    }

    onClientDisconnected(_cid) {
        debug('remove client');
        this.client.delete(_cid);
        this.instance.forEach((api, key) => {
            if (api.from == _cid) {
                debug('remove: ' + key);
                this.instance.delete(key);
            }
        });
    }

    handle(_signal, _callback) {
        debug("handle - start: ", _signal._sid);
        if (!_signal._pid && _signal.length() > 1) {
            //new process
            debug('process - start');
            var p = new Process(this.api.bind(this));
            this.process.set(p._pid, p);
            _signal._pid = p._pid;
            this.client.get(_signal._cid).response(_signal.getResult());
            return p.handle(_signal, () => {
                this.onHandled(_signal, _callback);
            });
        }
        if (_signal._pid) {
            //update process
            debug('process - update');
            return this.process.get(_signal._pid).handle(_signal, () => {
                this.onHandled(_signal, _callback);
            });
        }

        debug('no process');
        _signal.each(this.api.bind(this), () => {
            this.onHandled(_signal, _callback);
        });
    }

    onHandled(_signal, _callback) {
        if (_signal._pid && this.process.get(_signal._pid).isComplete()) {
            if (this.client.has(_signal._cid)) {
                debug('process - complete');
                this.client.get(_signal._cid).response(this.process.get(_signal._pid).getResult(_signal));
                this.process.delete(_signal._pid);
            } else {
                debug('process - await');
            }
        } else {
            debug('signal - complete');
            if (this.client.has(_signal._cid)) {
                this.client.get(_signal._cid).response(_signal.getResult());
            }
        }
        _callback();
    }

    send(_signal) {
        if (this.client.has(_signal._target)) {
            debug("resend: ", _signal);
            this.client.get(_signal._target).request(_signal, (_response) => {
                if (this.client.has(_signal._cid)) {
                    this.client.get(_signal._cid).response(_response);
                }
            });
        } else {
            if (_signal.length() == 1) {
                debug("execute: ", _signal);
                _signal.each(this.api.bind(this), () => {
                    this.onHandled(_signal, () => {});
                });
            } else {
                debug("enqueue: ", _signal);
                this.queue.push(_signal, 0);
            }
        }
    }
    api(name, _args, done) {
        if (arguments.length == 1) {
            debug('api get: ' + name);
            return this.instance.get(name);
        }
        debug('api call: ' + name);
        if (!this.instance.has(name)) {
            return done(new Error('E_API_NOT_FOUND'));
        }

        done = _.once(done);

        var api = this.instance.get(name);
        var args = (_args instanceof Signal) ? _args.get(name) : _args;

        var context = (_args instanceof Signal) ? this.process.get(_args._pid).context : this.context;
        var timer = null;

        switch (api.constructor.name) {
            case 'API':
                if (_args._ttl != 0) {
                    timer = setTimeout(() => {
                        done(new Error('E_TIMEOUT'));
                    }, _args._ttl ? _args._ttl : 60 * 1000);
                }
                return api.invoke(context, this, args, (err, result) => {
                    clearTimeout(timer);
                    done(err, result);
                });
            case 'Component':
                timer = setTimeout(() => {
                    done(new Error('E_TIMEOUT'));
                }, _args._ttl ? _args._ttl : 60*1000);
                return api.invoke(context, {
                    log: this.service.constructor.log,
                    error: this.service.constructor.error,
                    send: this.send.bind(this),
                    api: this.api.bind(this)
                }, args, (err, result) => {
                    clearTimeout(timer);
                    done(err, result);
                });
            default:
                return done(new Error('E_UNKNOWN'));
        }
    }
}

module.exports = Core;