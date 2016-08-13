"use strict";

const os = require('os'),
    _    = require('lodash');

class BaseAPI {
    static getClientList(env, args, done) {
        var list = [];
        env.client.forEach((val, key) => list.push(val.asJSON()));
        done(null, _.filter(list, args));
    }

    static getInstanceList(env, args, done) {
        var list = [];
        env.instance.forEach((val, key) => list.push(val.asJSON()));
        done(null, _.filter(list, args));
    }

    static getProcessState(env, args, done) {
        if (env.process.has(args.pid)) {
            done(null, env.process.get(args.pid));

            if (env.process.get(args.pid).isComplete()) {
                env.process.delete(args.pid);
            }
        } else {
            done(new Error('E_NOT_FOUND'));
        }
    }

    static killProcess(env, args, done) {
        if (env.process.has(args.pid)) {
            done(null, env.process.delete(args.pid));
        } else {
            done(new Error('E_NOT_FOUND'));
        }
    }

    static listProcess(env, args, done) {
        var list = [];
        env.process.forEach((val, key) => list.push(val.asJSON()));
        done(null, _.filter(list, args));
    }

    static connect(env, args, done) {
        env.service.connect(args.url, args.port, {}, (_err, _api) => {
            if (_err) return done(_err);

            env.onClientConnected(
                `${args.url}:${args.port}`, _api, {
                    type: "server"
                }, {}
            );
            done(null, {
                cid: `${args.url}:${args.port}`,
                connected: true
            });
        });
    }
    static disconnect(env, args, done) {
        if (env.client.has(args.cid)) {
            env.client.get(args.cid).close();
            env.client.delete(args.cid);
            done(null, true);
        } else {
            done(new Error('E_NOT_FOUND'));
        }
    }

    static getInfo(env, args, done) {
        if (!args.type) {
            return done('E_REQUIRED');
        }
        var result = {
            dpe_version: require('../../package.json').version,
            node_version: process.version,
            pid: process.pid,
            hostname: os.hostname()
        };
        switch (args.type) {
            case "process":
                result.env = process.env;
                result.cwd = process.cwd();
                result.user = os.userInfo();
                break;
            case "usage":
                result.uptime = process.uptime();
                result.cpuUsage = process.cpuUsage();
                result.memoryUsage = process.memoryUsage();
                result.freemem = os.freemem();
                result.loadavg = os.loadavg();
                break;
            case "os":
                result.arch = os.arch();
                result.type = os.type();
                result.platform = os.platform();
                result.release = os.release();
                result.cpus = os.cpus();
                result.totalmem = os.totalmem();
                result.networkInterfaces = os.networkInterfaces();
                break;
            default:
                break;
        }
        done(null, result);
    }

    restart(env, args, done) {
        env.service.stop();
        done();
    }
}

module.exports = function (core, API) {
    core.instance.set(
        'core.restart',
        new API('core.restart', {access:"core"},  BaseAPI.restart)
    );
    core.instance.set(
        'process.state',
        new API('process.state', {access:"core"},  BaseAPI.getProcessState)
    );
    core.instance.set(
        'process.list',
        new API('process.list', {access:"core"}, BaseAPI.listProcess)
    );
    core.instance.set(
        'process.kill',
        new API('process.kill', {access:"core"},BaseAPI.killProcess)
    );
    core.instance.set(
        'dpe.connect',
        new API('dpe.connect', {access:"core"}, BaseAPI.connect)
    );
    core.instance.set(
        'dpe.disconnect',
        new API('dpe.connect', {access:"core"}, BaseAPI.disconnect)
    );
    core.instance.set(
        'instance.list',
        new API('instance.list', {access:"core"}, BaseAPI.getInstanceList)
    );
    core.instance.set(
        'client.list',
        new API('client.list', {access:"core"}, BaseAPI.getClientList)
    );
    core.instance.set(
        'core.info',
        new API('core.info', {access:"core"}, BaseAPI.getInfo)
    );

    return BaseAPI;
};