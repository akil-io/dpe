"use strict";

const debug = require('debug')('dpe:api');
var _ = require('lodash');

class API {
    constructor(_name, _meta, _func) {
        debug('define api ' + _name);
        this.name = _name;
        this.access = _meta.access ? _meta.access : "component";
        this.from = [];
        if (_meta.from) this.from.push(_meta.from);
        this.export = (this.access != "core") && !this.from.length;

        this._func = _func;
    }
    select(clientList, tags) {
        debug('select client for remote call');
        if (!tags) tags= [];
        var supported = [];
        this.from.map((item) => {
            if (tags.length) {
                debug('check tags ', item, clientList.get(item)._tags, tags, _.intersection(tags, clientList.get(item)._tags));
                if (_.intersection(tags, clientList.get(item)._tags).length == tags.length) {
                    debug('support ', item);
                    supported.push(item);
                }
            } else {
                debug('no tags, add ', item);
                supported.push(item);
            }
        });
        var selected = _.sample(supported);
        debug('use ', selected);
        return selected;
    }
    invoke(_context, _env, _args, _done) {
        debug('invoke api ' + this.name);
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