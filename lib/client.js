"use strict";

const debug = require('debug')('dpe:client');
var Signal = require('./signal');
var _ = require('lodash');

class Client {
    constructor(_cid, _api, _meta) {
        this._cid = _cid;
        this._api = _api;
        this._type = _meta.type ? _meta.type : "unknown";
        this._time = _meta.time ? _meta.time : (new Date()).toString();
        this._ip = _meta.ip ? _meta.ip : null;
        this._uid = _meta.uid ? _meta.uid : null;

        this._wait = new Map();

        this._api.onResponse((_signal) => {
            debug('catch response', _signal);
            _signal = new Signal(_signal);
            if (this._wait.has(_signal._rid)) {
                clearTimeout(this._wait.get(_signal._rid)._timer);
                _signal._cid = this._wait.get(_signal._rid)._cid;
                debug('transfer to ', _signal._cid);
                this._wait.get(_signal._rid)._cb(_signal);
                this._wait.delete(_signal._rid);
            }
        });
    }

    asJSON() {
        return {
            cid: this._cid,
            uid: this._uid,
            ip: this._ip,
            time: this._time,
            type: this._type,
            wait: this._wait.size
        };
    }

    request(_signal, _cb) {
        debug('send request');
        _signal._rid = _signal._sid;
        if (_signal._target == this._cid) {
            _signal._target = null;
        }
        if (_.isFunction(_cb)) {
            debug('set wait handler for' + _signal._sid);
            this._wait.set(_signal._sid, {
                _at: Date.now(),
                _cb: _cb,
                _cid: _signal._cid,
                _timer: this.getTimer(_signal._ttl ? _signal._ttl : 10 * 60 * 60 * 1000, _signal._sid)
            });
        }
        this._api.request(_signal.asJSON());
    }
    close() {
        this._api.close();
    }
    getTimer(_ttl, _sid) {
        return setTimeout(() => {
            if (this._wait.has(_sid)) {
                this._wait.get(_sid)._cb(new Error('E_TIMED_OUT'));
                this._wait.delete(_sid);
            }
        }, _ttl);
    }
    response(_signal) {
        debug('send response', _signal._cid);
        this._api.response(_signal.asJSON());
    }
    onRequest(_cb) {
        debug('set onRequest');
        this._api.onRequest(_cb);
    }
    onResponse(_cb) {
        debug('set onResponse');
        this._api.onResponse(_cb);
    }
    onClose(_cb) {
        this._api.onClose(_cb);
    }
    onError(_cb) {
        this._api.onError(_cb);
    }
}

module.exports = Client;