"use strict";

var Signal = require('./signal');

class Client {
    constructor(_cid, _echo) {
        this._cid = _cid;
        this._echo = _echo;
    }
    send(_signal) {
        this._echo(_signal.asJSON());
    }
    createSignal(_rawSignal) {
        return new Signal(this._cid, null, _rawSignal);
    }
}

module.exports = Client;