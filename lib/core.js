"use strict";

const debug = require('debug')('dpe:core'),
    async   = require('async'),
    path    = require('path'),
    util    = require('util'),
    uuid    = require('node-uuid'),
    os      = require('os'),
    fs      = require('fs'),
    _       = require('lodash');

class Core {
    constructor(_service) {
        this.service = _service;
        //noinspection JSUnresolvedVariable
        this.queue = async.priorityQueue(this.handle.bind(this), 1);
        this.queue.drain = this.onDrain.bind(this);

        this.context = {};
        this.instance = new Map();
        this.client = new Map();
        //this.signal = new Map();
        //this.process = new Map();
    }

    has(key) {
        return this.instance.has(key);
    }

    noClient(id) {
        this.client.delete(id);
    }

    init(_signal) {
        async.mapSeries(Object.keys(_signal), (moduleName, next) => {
            debug('module: ' + moduleName);
            var module = require(_signal[moduleName].require);
            async.mapSeries(Object.keys(module), (method, next) => {
                if (method == "init") return next();
                debug('\tmethod: ' + method);
                this.register(`${moduleName}.${method}`, module[method].bind(this.context));
                next();
            }, () => {
                if (_.isFunction(module.init)) {
                    module.init.call(this.context, this, null, next);
                } else next();
            });
        }, (err) => {
            if (err) {
                return this.service.stop(err);
            }
        });
    }

    onDrain() {
        debug('core.queue - empty');
    }
    handle(_signal, _callback) {
        debug("handle: ", _signal._sid);
        this.api('signal.route', _signal, _callback);
    }
    send(_signal, _cid = null, _echo = null) {
        if (!_signal._sid) {
            _signal._sid = uuid.v4();
        }
        if (_cid) {
            _signal._cid = _cid;
            this.client.set(_cid, {
                echo: _echo,
                signal: new Set([_signal._sid])
            });
        }
        debug('enqueue: ', _signal);
        this.queue.push(_signal, 0, () => {
            debug('dequeue: ', _signal._sid);
        });
    }

    api(path, args, callback) {
        if (this.instance.has(path)) {
            this.instance.get(path).call(this.context, this, args, callback);
        } else {
            this.service.stop(new Error('E_API_NOT_FOUND'));
        }
    }

    register(path, func) {
        this.instance.set(path, func);
    }
}

module.exports = Core;