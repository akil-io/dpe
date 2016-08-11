"use strict";

const debug = require('debug')('dpe:signal'),
    async   = require('async'),
    uuid    = require('node-uuid'),
    _       = require('lodash');

class Signal {
    constructor(_raw = {}) {
        this._sid = uuid.v4();
        this._at = Date.now();
        this._ttl = null;
        this._target = _raw._target ? _raw._target : null;
        this._type = _raw._type ? _raw._type : 'in';
        this._cid = _raw._cid ? _raw._cid : null;
        this._pid = _raw._pid ? _raw._pid : null;
        this._from = _raw._from ? _raw._from : null;
        this._rid = _raw._rid ? _raw._rid : null;

        this._args = {};
        this._state = {};
        this._names = [];

        this.setState(_raw);
    }

    setState(_raw) {
        if (_raw) {
            if (_raw instanceof Error) {
                this._args = {
                    $error: _raw.message
                };
                this._state = _raw;
            } else {
                this._names = Object.keys(_raw).filter((key) => !/^(?:_|@)/ig.test(key));
                this._names.map((key) => this._args[key] = _raw[key]);
            }
        }
        return this;
    }

    length() {
        return this._names.length;
    }

    get(_name) {
        return this._args[_name];
    }

    set(_name, _value) {
        if (arguments.length == 1 && arguments[0] instanceof Error) {
            debug('set signal error');
            return this._state = arguments[0];
        }
        if (_value instanceof Error) {
            return this._state[_name] = {
                $error: _value.message
            }
        }
        if (_value instanceof Signal) {
            return this._state[_name] = _value._state;
        }
        if (_.isPlainObject(_value)) {
            return this._state[_name] = _value;
        }
        debug('set signal item: ' + _name);
        return this._state[_name] = {
            $result: _value
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

    getMeta(_update = {}) {
        return Object.assign({
            _sid: this._sid,
            _at: this._at,
            _ttl: this._ttl,
            _target: this._target,
            _type: this._type,
            _cid: this._cid,
            _pid: this._pid,
            _from: this._from,
            _rid: this._rid
        }, _update);
    }

    copy(_state = null) {
        return (new Signal(this.getMeta({
            _type: 'copy',
            _from: this._from ? this._from : this._sid
        }))).setState(_state);
    }

    getResult() {
        var s = this.copy(this._state);
        s._type = 'out';
        return s;
    }

    asJSON() {
        return Object.assign(this.getMeta(), this._args);
    }
}

module.exports = Signal;