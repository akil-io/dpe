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
    }

    init(_signal) {
        _signal = new Signal(null, null, _signal);
        debug('init');

        _signal.each((module, args, done) => {
            var lib = require(args.require);
            debug('module: ' + module);

            async.map(Object.keys(lib), (method, next) => {
                this.instance.set(`${module}.${method}`, new API(
                    `${module}.${method}`,
                    lib[method]
                ));
                debug('\tmethod: ' + method);
                next();
            }, done);
        }, (err) => {
            if (err) {
                return this.service.stop(new Error('E_CORE_NOT_LOADED'));
            }
            if (!this.instance.has('signal.route')) {
                return this.service.stop(new Error('E_CORE_NO_ROUTER'));
            }
            debug("core loaded");
        });
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
        if (_signal.length() > 1) {
            if (_signal._pid) {
                //update process
                this.process.get(_signal._pid).handle(_signal, () => {
                    debug('handle - end', _signal._sid);
                    this.client.get(_signal._cid).send(_signal.getResult());
                    _callback();
                });
            } else {
                //new process
                var p = new Process(this.api.bind(this));
                this.process.set(p._pid, p);
                p.handle(_signal, () => {
                    debug('handle - end', _signal._sid);
                    this.client.get(_signal._cid).send(_signal.getResult());
                    _callback();
                });
            }
        } else {
            //utility
            _signal.each(this.api.bind(this), () => {
                debug('handle - end', _signal._sid);
                this.client.get(_signal._cid).send(_signal.getResult());
                _callback();
            });
        }
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