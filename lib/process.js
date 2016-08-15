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
        this._gen = {};
        this.context = {};
        this._args = {};
        this._state = {};
        this._ready = [];
        this._history = [];
        this.enabled = false;
    }

    asJSON() {
        return {
            pid: this._pid,
            ready: this._ready,
            history: this._history.length
        };
    }

    isComplete() {
        return (this._ready.length == this._plan['@target'].length);
    }

    getResult(_signal) {
        _signal = _signal.copy(_signal._state);
        this._ready.map((name) => _signal.set(name, this._state[name]));
        return _signal.getResult();
    }

    init(_signal, _callback) {
        debug('process - init');
        this._plan = {
            '@target': [],
            '@observer': null,
            '@trigger': [],
            '@initial': [],
            '@generator': []
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

                if (args['@generator']) {
                    this._plan['@generator'].push(name);
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
            debug('check plan');
            this._plan['@initial'] = _.difference(_signal._names, this._plan['@trigger'], [this._plan['@observer']]);
            debug('PLAN:', this._plan);

            if (!this._plan['@observer'] && !this._plan['@target'].length) {
                _signal.set(new Error('E_PROCESS_NO_TARGET'));
                debug('no target error');
                return _callback();
            }
            if (this._plan['@observer'] && this._plan['@trigger'].length > 0) {
                _signal.set(new Error('E_PROCESS_BAD_PLAN'));
                debug('bad plan error');
                return _callback();
            }
            if (this._plan['@generator'].length > 1) {
                _signal.set(new Error('E_NOT_SUPPORTED'));
                debug('more then one generator error');
                return _callback();
            }

            var genName = null;
            if (this._plan['@generator'].length) {
                genName = this._plan['@generator'][0];
                this._gen[genName] = this._api(genName)(this, _signal.get(genName), (err, result) => {
                    this._state[genName] = err ? err : result;
                });
                this.enabled = true;
            }

            async.whilst(() => {
                return this.enabled;
            }, (next) => {
                debug('generator: next');
                var item = this._gen[genName].next();
                if (item.done) {
                    debug('generator: done');
                    this.enabled = false;
                }
            }, () => {
                if (this._plan['@target'].indexOf(genName) != -1) {
                    this._ready.push(genName);
                }
            });

            this.handle(_signal, _callback);
        });
    }

    handle(_signal, _callback) {
        debug('process - handle');
        if (!this._plan) {
            return this.init(_signal, _callback);
        }

        this._history.push(_signal._sid);

        if (this._plan['@observer']) {
            debug('process - observer plan');
            _signal.set(new Error('E_PROCESS_OBSERVER_NOT_IMPLEMENTED'));
            return _callback();
        } else {
            debug('process - trigger plan');
            _signal.each((name, args, next) => {
                if (!this._args[name]) this._args[name] = {};
                this._args[name] = Object.assign(this._args[name], args);

                if (this._gen[name]) return next(new Error('E_SKIP_SERVICE'));

                if (this._plan['@initial'].indexOf(name) != -1) {
                    debug('process - call: ' + name);
                    this.api(name, _signal, next);
                } else {
                    debug('process - skip: ' + name);
                    next(new Error('E_SKIP'));
                }
            }, _callback);
        }
    }

    update(name, err, result) {
        if (this._plan['@target'].indexOf(name) != -1) {
            this._state[name] = err ? err : result;
            if (!err) {
                this._ready.push(name);
            }
        }
    }

    api(name, args, done) {
        debug('process - api: ' + name);
        var mainResult = null;
        var mainError = null;

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
                this._api(name, args, (err, result) => {
                    this.context[`$${name}`] = err ? err : result;
                    if (this._plan['@target'].indexOf(name) != -1) {
                        this._state[name] = err ? err : result;
                        if (!err) {
                            this._ready.push(name);
                        }
                    }
                    mainResult = err ? null : result;
                    mainError = err ? err : null;
                    callback();
                });
            },
            (callback) => {
                if (this._plan[name]['after'].length) {
                    debug('item: ' + name + ' - after ', this._plan[name]['after']);
                    async.mapSeries(this._plan[name]['after'], (afterName, next) => {
                        this.api(afterName, args, next);
                    }, callback)
                } else callback();
            }
        ], () => {
            done(mainError, mainResult);
        });
    }
}

module.exports = Process;
