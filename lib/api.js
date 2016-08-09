"use strict";

class API {
    constructor(_name, _func) {
        this.name = _name;
        this._func = _func;
    }

    invoke(_context, _env, _args, _done) {
        this._func.call(_context, _env, _args, _done);
    }
}

module.exports = API;