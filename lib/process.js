"use strict";

const debug = require('debug')('dpe:process'),
    async   = require('async'),
    uuid    = require('node-uuid'),
    _       = require('lodash');

class Process {
    constructor(_api) {
        this._pid = uuid.v4();
        this._plan = null;
        this._api = _api;
        this.context = {};
    }

    init(_signal, _callback) {
        debug('process - init');
        this._plan = {
            '@target': [],
            '@observer': null,
            '@trigger': [],
            '@initial': []
        };

        var initItem = (name) => {
            if (!this._plan[name]) {
                this._plan[name] = {
                    'before': [],
                    'after': [],
                    'wrap': null
                };
            }
        };

        _signal.each((name, args, next) => {
            if (args['@observer']) {
                this._plan['@observer'] = name;
            }

            if (!this._plan['@observer']) {
                initItem(name);
                var isTrigger = false;

                if (args['@before']) {
                    initItem(args['@before']);
                    this._plan[args['@before']]['before'].push(name);
                    isTrigger = true;
                }
                if (args['@after']) {
                    initItem(args['@after']);
                    this._plan[args['@after']]['after'].push(name);
                    isTrigger = true;
                }
                if (args['@wrap']) {
                    initItem(args['@wrap']);
                    this._plan[args['@wrap']]['wrap'] = name;
                    isTrigger = true;
                }

                if (isTrigger) {
                    this._plan['@trigger'].push(name);
                }
            }

            if (args['@target']) {
                this._plan['@target'].push(name);
            }

            next();
        }, () => {
            this._plan['@initial'] = _.difference(_signal._names, this._plan['@trigger'], [this._plan['@observer']]);
            console.log('PLAN:', this._plan);
            if (!this._plan['@observer'] && this._plan['@target'].length == 0) {
                _signal.set(new Error('E_PROCESS_NO_TARGET'));
                return _callback();
            }
            if (this._plan['@observer'] && this._plan['@trigger'].length > 0) {
                _signal.set(new Error('E_PROCESS_BAD_PLAN'));
                return _callback();
            }

            this.handle(_signal, _callback);
        });
    }

    handle(_signal, _callback) {
        _signal._pid = this._pid;
        debug('process - handle');
        if (!this._plan) {
            return this.init(_signal, _callback);
        }

        if (this._plan['@observer']) {
            debug('process - observer plan');
            _signal.set(new Error('E_PROCESS_OBSERVER_NOT_IMPLEMENTED'));
            return _callback();
        } else {
            debug('process - trigger plan');
            async.mapSeries(this._plan['@initial'], (name, next) => {
                debug('process - handle: ' + name);
                this.api(name, _signal, next);
            }, _callback);
        }
    }

    api(name, args, done) {
        debug('process - api: ' + name);
        async.series([
            (callback) => {
                if (this._plan[name]['before'].length) {
                    debug('item: ' + name + ' - before ', this._plan[name]['before']);
                    async.mapSeries(this._plan[name]['before'], (beforeName, next) => {
                        this.api(beforeName, args, next);
                    }, callback)
                } else callback();
            },
            (callback) => {
                this._api(name, args, callback);
            },
            (callback) => {
                if (this._plan[name]['after'].length) {
                    debug('item: ' + name + ' - after ', this._plan[name]['after']);
                    async.mapSeries(this._plan[name]['after'], (afterName, next) => {
                        this.api(afterName, args, next);
                    }, callback)
                } else callback();
            }
        ], done);
    }
}

module.exports = Process;