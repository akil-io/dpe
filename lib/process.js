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
        this._lastTask = null;
        this.enabled = false;
    }

    asJSON() {
      return {
            lastTask: this._lastTask,
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
            '@iterator': []
        };

        var initItem = (name) => {
            if (!this._plan[name]) {
                this._plan[name] = {
                    'before': [],
                    'after': [],
                    'wrap': null,
                    'iterate': null
                };
            }
        };

        _signal.each((name, args, next) => {
            this._args[name] = args;

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

                if (args['@iterate']) {
                    initItem(args['@iterate']);
                    this._plan[args['@iterate']]['iterate'] = name;
                    this._plan['@iterator'].push(name);
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
            debug('check plan');
            this._plan['@initial'] = _.difference(_signal._names, this._plan['@trigger'], [this._plan['@observer']], this._plan['@iterator']);
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

            this.handle(_signal, _callback);
        });
    }

    handle(_signal, _callback) {
        debug('process - handle');
        if (!this._plan) {
            return this.init(_signal, _callback);
        }

        debug(this);

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

        if (this._plan[name]['iterate']) {
            debug('found iterator, run in background');
            this.processIterator(name, args);
            return done(null, {
                "$step": 0
            });
        } else {
          this._lastTask = name
        }

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

    processIterator(name, signal) {
        debug('start iterator: ' + name);
        var lastItem = null;
        var lastError = null;
        var stepCount = 0;
        var iteratorName = this._plan[name]['iterate'];

        var apiInfo = this._api(name);
        var concurency = (!apiInfo.export && apiInfo.from.length) ? apiInfo.from.length : 1;

        //main api queue
        var queue = async.queue((function(task, next) {
            debug('iterator handle task', task);
            var taskArgs = Object.assign(this._args[name], task);
            this._state[iteratorName] = {
                "$step": stepCount
            };
            this._api(name, taskArgs, (err, result) => {
                debug('execute api on step');
                stepCount++;
                if (_.isPlainObject(result)) {
                    debug('assign result object', err, result);
                    if (!_.isPlainObject(this._state[name])) {
                        this._state[name] = {};
                    }
                    this._args[name] = taskArgs;
                    this._state[name] = err ? err : Object.assign(this._state[name], result);
                } else {
                    debug('assign result', err, result);
                    this._state[name] = err ? err : result;
                }
                next();
            });
        }).bind(this), concurency);

        debug('start queue with concurency: ', concurency);

        //iterate api
        var fillQueue = (function () {
            async.times(concurency, () => {
                debug('fill round step');
                this._api(iteratorName, this._args[this._plan[name]['iterate']], (err, result) => {
                    lastItem = result;
                    lastError = err;
                    debug('got item', lastItem);
                    if (lastItem) {
                        queue.push(lastItem);
                    } else {
                        debug('iterator complete');
                        if (this._plan['@target'].indexOf(name) != -1) {
                            this._ready.push(name);
                            this._ready = _.uniq(this._ready);
                        }
                    }
                });
            }, () => {
                debug('fill round complete');
            });
        }).bind(this);

        queue.drain = fillQueue;

        //start iterate queue
        queue.drain();
    }
}

module.exports = Process;
