"use strict";

class API {
    constructor(_name, _meta, _func) {
        this.name = _name;
        this.access = _meta.access ? _meta.access : "component";
        this.from = _meta.from ? _meta.from : "self";
        this.export = (this.access != "core") && (this.from == "self");

        this._func = _func;
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