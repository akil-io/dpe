"use strict";

const debug = require('debug')('dpe:signal'),
    async   = require('async'),
    uuid    = require('node-uuid'),
    _       = require('lodash');

class Signal {
    constructor(_cid, _pid = null, _raw = {}) {
        this._sid = uuid.v4();
        this._cid = _cid;
        this._pid = _pid;

        this._args = {};
        this._state = {};

        if (_raw instanceof Error) {
            this._args = {
                _error: _raw.message
            };
        } else {
            this._names = Object.keys(_raw).filter((key) => !/^(?:_|@)/ig.test(key));
            this._names.map((key) => this._args[key] = _raw[key]);
        }
    }

    length() {
        return this._names.length;
    }

    get(_name) {
        return this._args[_name];
    }

    set(_name, _value) {
        if (arguments.length == 1 && arguments[0] instanceof Error) {
            return this._state = arguments[0];
        }
        if (_value instanceof Error) {
            return this._state[_name] = {
                error: _value.message
            }
        }
        if (_value instanceof Signal) {
            return this._state[_name] = _value._state;
        }
        if (_.isPlainObject(_value)) {
            return this._state[_name] = _value;
        }
        return this._state[_name] = {
            result: _value
        };
    }

    each(_iterator, _done) {
        async.mapSeries(this._names, (name, next) => {
            _iterator(name, this._args[name], (err, result) => {
                debug('update item - ' + name);
                if (err || result) {
                    this.set(name, err ? err : result);
                }
                next();
            });
        }, _done);
    }

    copy() {
        return new Signal(this._cid, this._pid, {});
    }

    getResult() {
        return new Signal(this._cid, this._pid, this._state);
    }

    asJSON() {
        return Object.assign({
            _sid: this._sid,
            _cid: this._cid,
            _pid: this._pid,
            _from: this._from
        }, this._args);
    }
}

module.exports = Signal;