"use strict";

const debug = require('debug')('dpe:core'),
    async   = require('async'),
    path    = require('path'),
    util    = require('util'),
    uuid    = require('node-uuid'),
    os      = require('os'),
    fs      = require('fs'),
    _       = require('lodash');

var Signal = require('./signal');
var Client = require('./client');
var API = require('./api');
var Process = require('./process');

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

        this.instance.set('process.state', new API('process.state', Core.getProcessState));
        this.instance.set('process.list', new API('process.state', Core.listProcess));
        this.instance.set('process.kill', new API('process.state', Core.killProcess));
    }

    static getProcessState(env, args, done) {
        if (env.process.has(args.pid)) {
            done(null, env.process.get(args.pid));
        } else {
            done(new Error('E_NOT_FOUND'));
        }
    }

    static killProcess(env, args, done) {
        if (env.process.has(args.pid)) {
            done(null, env.process.delete(args.pid));
        } else {
            done(new Error('E_NOT_FOUND'));
        }
    }

    static listProcess(env, args, done) {
        var list = [];
        env.process.forEach((val, key) => list.push(key));
        done(null, list);
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
                            module[methodName]
                        ));
                        debug('\t\tmethod: ' + methodName);
                    });
                });
            }
        });
        debug("core loaded");
    }

    onDrain() {
        debug('queue is empty');
    }

    onClientConnected(_cid, _echo) {
        this.client.set(_cid, new Client(_cid, _echo));
    }

    onClientDisconnected(_cid) {
        this.client.delete(_cid);
    }

    handle(_signal, _callback) {
        debug("handle - start: ", _signal._sid);
        if (!_signal._pid && _signal.length() > 1) {
            //new process
            debug('process - start');
            var p = new Process(this.api.bind(this));
            this.process.set(p._pid, p);
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
            this.client.get(_signal._cid).send(this.process.get(_signal._pid).getResult(_signal));
            this.process.delete(_signal._pid);
            debug('process - complete');
        } else {
            debug('signal - complete');
            this.client.get(_signal._cid).send(_signal.getResult());
        }
        _callback();
    }

    send(_cid, _signal) {
        debug("enqueue: ", _cid, _signal);
        this.queue.push(this.client.get(_cid).createSignal(_signal), 0);
    }
    api(name, _args, done) {
        debug('api call: ' + name);
        if (!this.instance.has(name)) {
            return done(new Error('E_API_NOT_FOUND'));
        }

        var api = this.instance.get(name);
        var args = (_args instanceof Signal) ? _args.get(name) : _args;
        var context = (_args instanceof Signal) ? this.process.get(_args._pid).context : this.context;

        switch (api.constructor.name) {
            case 'API':
                return api.invoke(context, this, args, done);
            default:
                return done(new Error('E_UNKNOWN'));
        }
    }
}

module.exports = Core;