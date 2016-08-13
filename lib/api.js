"use strict";

var _ = require('lodash');

class API {
    constructor(_name, _meta, _func) {
        this.name = _name;
        this.access = _meta.access ? _meta.access : "component";
        this.from = [];
        if (_meta.from) this.from.push(_meta.from);
        this.export = (this.access != "core") && !this.from.length;

        this._func = _func;
    }
    select(_client) {
        return _.sample(this.from);
    }
    invoke(_context, _env, _args, _done) {
        this._func.call(_context, _env, _args, _done);
    }
    asJSON() {
        return {
            name: this.name,
            access: this.access,
            from: this.from,
            export: this.export
        };
    }
}

module.exports = API;