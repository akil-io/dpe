"use strict";

const debug = require('debug')('dpe:core'),
    async   = require('async'),
    path    = require('path'),
    util    = require('util'),
    uuid    = require('node-uuid'),
    os      = require('os'),
    fs      = require('fs'),
    _       = require('lodash');

class Signal {
    constructor(_components, _from = null, _silence = true) {
        this._sid = uuid.v4();
        this._from = _from;
    }

    extract(_component) {

    }

    static createFrom(_raw) {

    }
}

module.exports = Signal;