"use strict";

const debug = require('debug')('dpe:client');
var Signal = require('./signal');

class Client {
    constructor(_cid, _api) {
        this._cid = _cid;
        this._api = _api;

        this._wait = new Map();

        this._api.onResponse((_signal) => {
            _signal = new Signal(_signal);
            if (this._wait.has(_signal._from)) {
                clearTimeout(this._wait.get(_signal._from)._timer);
                this._wait.get(_signal._from)._cb(_signal);
                this._wait.delete(_signal._from);
            }
        });
    }
    request(_signal, _cb) {
        debug('request');
        this._wait.set(_signal._sid, {
            _at: Date.now(),
            _cb: _cb,
            _timer: this.getTimer(_signal._ttl ? _signal._ttl : 10*60*60*1000, _signal._sid)
        });
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
}

module.exports = Client;