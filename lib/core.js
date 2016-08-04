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
                    module.init.call(this.context, this.getEnv(), null, next);
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
        this.api('signal.route', _signal, () => {
            debug('api.return', _signal._sid);
            _callback();
        });
    }
    send(_signal, silence, callback) {
        if (!silence) silence = false;
        if (!_signal._sid) {
            _signal._sid = uuid.v4();
        }
        debug('enqueue: ', _signal);
        this.queue.push(_signal, 0, () => {
            if (silence) {
                debug('complete: ', _signal._sid);
            } else {
                this.send({
                    _pid: _signal._pid,
                    _from: _signal._from,
                    "signal.echo": {
                        sid: _signal._sid,
                        stage: 'core.handle'
                    }
                }, true);
            }
        });
        if (callback) callback(null, _signal._sid);
    }

    getEnv() {
        return {
            api: this.api.bind(this),
            send: this.send.bind(this),
            has: this.instance.has.bind(this.instance)
        };
    }

    api(path, args, callback) {
        if (this.instance.has(path)) {
            this.instance.get(path)(this.getEnv(), args, callback);
        } else {
            this.service.stop(new Error('E_API_NOT_FOUND'));
        }
    }

    register(path, func) {
        this.instance.set(path, func);
    }
}

module.exports = Core;