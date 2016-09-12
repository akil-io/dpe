"use strict";

var debug   = require('debug')('dpe:base');

const os = require('os'),
    path = require('path'),
    fs   = require('fs'),
    _    = require('lodash');

var pm2 = require('pm2');

const async = require('async');

const crypto = require('crypto');
var url = require('url');

var API = require('../api');
var Client = require('../client');
var Signal = require('../signal');

class PM_API {
    static start(env, args, done) {
        pm2.connect(function(err) {
            if (err) {
                console.error(err);
                return done(err, false);
            }

            pm2.start(path.join(env.confDir, 'pm2.json'), function (err) {
                if (err) {
                    console.log(err);
                }
                pm2.disconnect();

                done(err, err ? false : true);
            });
        });
    }

    static list(env, args, done) {
        pm2.connect(function(err) {
            if (err) {
                console.error(err);
                return done(err, false);
            }

            pm2.list(function (err, processes) {
                if (err) {
                    console.log(err);
                }
                pm2.disconnect();

                done(err, processes);
            });
        });
    }

    static stop(env, args, done) {
        pm2.connect(function(err) {
            if (err) {
                console.error(err);
                return done(err, false);
            }

            pm2.stop("all", function (err) {
                if (err) {
                    console.log(err);
                }
                pm2.disconnect();

                done(err, err ? false : true);
            });
        });
    }

    static delete(env, args, done) {
        pm2.connect(function(err) {
            if (err) {
                console.error(err);
                return done(err, false);
            }

            pm2.delete("all", function (err) {
                if (err) {
                    console.log(err);
                }
                pm2.disconnect();

                done(err, err ? false : true);
            });
        });
    }

    static restart(env, args, done) {
        pm2.connect(function(err) {
            if (err) {
                console.error(err);
                return done(err, false);
            }

            pm2.restart("all", function (err) {
                if (err) {
                    console.log(err);
                }
                pm2.disconnect();

                done(err, err ? false : true);
            });
        });
    }
}

module.exports = function (core, API) {
    core.instance.set(
        'pm.start',
        new API('pm.start', {access:"core"},  PM_API.start)
    );
    core.instance.set(
        'pm.stop',
        new API('pm.stop', {access:"core"},  PM_API.stop)
    );
    core.instance.set(
        'pm.list',
        new API('pm.list', {access:"core"},  PM_API.list)
    );
    core.instance.set(
        'pm.delete',
        new API('pm.delete', {access:"core"},  PM_API.delete)
    );
    core.instance.set(
        'pm.restart',
        new API('pm.restart', {access:"core"},  PM_API.restart)
    );

    return PM_API;
};
