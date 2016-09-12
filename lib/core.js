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

        this.baseAPI = require('./module/' + this.service.coreModule)(this, API);
        //this.tags = require('./module/tags')(this);
        this.tags = this.service.get('tags');

        this.tags.push('discover');
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

        if (this.service.keepConnections) {
            this.keepConnection();
            setInterval(this.keepConnection.bind(this), 60000);
        }
    }

    keepConnection() {
        if (this._keep.length) {
            debug('keep check');
            this._keep.map((server) => {
                var _cid = server.href;
                if (!this.client.has(_cid)) {
                    this.baseAPI.connect(this, {
                        url: server.href
                    }, (err, res) => {
                        debug("baseAPI.connect callback", err, res)
                    });
                }
            });
        }
    }

    onDrain() {
        debug('queue is empty');
    }

    onClientConnected(_sid, _api, _meta, _data) {
        _meta = Object.assign(_meta, _data);
        if (_data.uid == "local") {
            _meta.type = "cli";
            if (_data.key == this.service.get('local.key')) {
                _meta.type = "local-cli";
            }
        }
        if (_meta.tags && !_.isArray(_meta.tags)) {
            _meta.tags = _meta.tags.split(',');
        }
        _meta._sid = _sid;

        var _cid = Client.getID(_meta);

        if (this.client.get(_cid)) {
            debug('upgrade client: ' + _cid);
            this.client.get(_cid).upgrade(_api, _meta);
            return;
        }

        debug('add client: ' + _cid);
        var newClient = new Client(_cid, _api, _meta);
        this.client.set(_cid, newClient);
        this.client.get(_cid).onRequest((_signal) => {
            debug('catch request');
            this.send(new Signal(Object.assign(_signal, {
                _cid: _cid
            })));
        });

        this.client.get(_cid).onClose(() => {
            debug('client disconnected', _cid);
            this.onClientDisconnected(_cid);
        });

        this.client.get(_cid).onError((err) => {
            debug('client error: ', _cid, err);
            this.onClientDisconnected(_cid);
        });

        if (this.service.autoDiscover) {
            this.baseAPI.discover(this, {
                cid: _cid
            }, (err) => {
                if (!err) {
                    debug("client discover complete");
                } else {
                    debug("client discover failed", err);
                }
            });
        }
    }

    getRemoteCallAPI(_name) {
        return (function (env, args, callback) {
            var _cid = this.instance.get(_name).select(this.client, args['@tags']);
            if (!_cid) {
                return callback(new Error('E_NO_INSTANCE'));
            }
            if (this.client.has(_cid)) {
                var rawSignal = {};
                rawSignal[_name] = args;
                this.client.get(_cid).request(new Signal(rawSignal), (_response) => {
                    debug("REMOTE RESPONSE", _response);
                    if (_response instanceof Signal) {
                        if (_response.get('$error')) {
                            return callback(new Error(_response.get('$error')));
                        }
                        if (_response.get(_name)) {
                            return callback(null, _response.get(_name));
                        }
                    }
                    if (_response instanceof Error) {
                        return callback(_response);
                    }
                    return callback(new Error('E_FAILED'));
                });
            }
        }).bind(this);
    }

    onClientDisconnected(_cid) {
        debug('remove client: ' + _cid);
        this.client.get(_cid).close();
        this.client.delete(_cid);
        this.instance.forEach((api, key) => {
            api.from = _.without(api.from, _cid);
            if (api.from.length == 0 && !api.export && api.access != "core") {
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
            debug('signal - complete', _signal.getResult());
            if (this.client.has(_signal._cid)) {
                this.client.get(_signal._cid).response(_signal.getResult());
            } else {
                debug(`client ${_signal._cid} is not found`)
            }
        }
        _callback();
    }

    send(_signal) {
        if (_signal['_broadcast'] != undefined) {
            var targets = [];
            if (_.isArray(_signal['_broadcast'])) {
                this.client.forEach((v, k) => {
                    if (_.intersection(v._tags, _signal['_broadcast']).length == _signal['_broadcast'].length) {
                        targets.push(k);
                    }
                });
            }
            if (_signal['@broadcast'] == '*') {
                this.client.forEach((v, k) => {
                    if (v._type.indexOf("cli") == -1) {
                        targets.push(k);
                    }
                });
            }

            if (_.isString(_signal['_broadcast']) && _signal['_broadcast'] != '*') {
                this.client.forEach((v, k) => {
                    var r = new RegExp(_signal['_broadcast'], 'ig');
                    if (r.test(k)) targets.push(k);
                });
            }

            debug('BROADCAST SIGNAL TO:', targets);
            targets.map((cid) => {
                this.client.get(cid).request(_signal, (_response) => {
                    if (this.client.has(_signal._cid)) {
                        this.client.get(_signal._cid).response(_response);
                    }
                });
            });
            return;
        }
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

        if (args['@map_from']) {
            //@todo: map from for arguments change
        }

        switch (api.constructor.name) {
            case 'API':
                if (_args._ttl != 0) {
                    timer = setTimeout(() => {
                        done(new Error('E_TIMEOUT'));
                    }, _args._ttl ? _args._ttl : 60 * 1000);
                }
                return api.invoke(context, this, args, (err, result) => {
                    clearTimeout(timer);
                    debug('API CALL RESULT:', err, result);
                    //mapping
                    if (args['@map_to'] && _.isPlainObject(args['@map_to']) && result) {
                        debug('api call - map_to object-object found');
                        var newResult = {};
                        Object.keys(args['@map_to']).map((mapPath) => {
                            var curValue = _.get(result, mapPath);
                            if (curValue) {
                                debug('map path found in result', result, args['@map_to']);
                                _.set(newResult, mapPath, curValue);
                                return;
                            }
                            if (args['@map_to'][mapPath] == "$result") {
                                _.set(newResult, mapPath, result);
                            } else {
                                _.set(newResult, mapPath, _.get(result, args['@map_to'][mapPath]));
                            }
                        });
                        result = newResult;
                    }
                    if (args['@map_to'] && _.isString(args['@map_to']) && result) {
                        if (_.isPlainObject(result)) {
                            debug('api call - map_to string-object found');
                            result = _.get(result, args['@map_to']);
                        }
                    }


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
