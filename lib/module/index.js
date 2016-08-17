"use strict";

var debug   = require('debug')('dpe:base');

const os = require('os'),
    path = require('path'),
    fs   = require('fs'),
    _    = require('lodash');

const crypto = require('crypto');
var url = require('url');

var API = require('../api');
var Client = require('../client');

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
        if (!args.url) return done(new Error('E_REQUIRED'));

        var _url = url.parse(args.url);
        var _cid = Client.getID(_url);

        if (env.service.get(_cid)) return done(new Error('E_CONNECTED'));

        env.service.connect(args.url, {
            port: env.service.get('cli.port'),
            uid: 'worker',
            tags: env.tags.join(','),
            version: require('../../package.json').version
        }, _.once((_err, _sid, _api) => {
            if (_err) return done(_err);
            debug(`service ${_cid} connected to ${args._url}`);
            env.onClientConnected(
                _sid, _api, {
                    type: "server",
                    host: _url.hostname,
                    time: Date.now()
                }, {
                    port: _url.port
                }
            );
            done(null, {
                cid: `${args.url}`,
                connected: true
            });
        }));
    }

    static disconnect(env, args, done) {
        debug('try to disconnect', args.cid)
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
            hostname: os.hostname(),
            tags: env.tags
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

    static restart(env, args, done) {
        process.exit(1)
    }

    static getConfig(env, args, done) {
        if (!args.path) {
            return done(new Error('E_REQUIRED'));
        }
        done(null, env.service.get(args.path));
    }

    static setConfig(env, args, done) {
        if (!args.path) {
            return done(new Error('E_REQUIRED'));
        }
        if (!args.value) {
            return done(new Error('E_REQUIRED'));
        }
        if (_.isPlainObject(env.service.get(args.path))) {
            env.service.set(args.path, args.value);
            done(null, env.service.get(args.path));
        } else {
            done(new Error('E_UNSUPPORTED'));
        }
    }

    static installPackage(env, args, done) {
        if (!args.name) return done(new Error('E_REQUIRED'));

        var type = null;
        var name = args.name;
        var s = env.service;
        var options = {
            core: args.core,
            module: args.module,
            app: args.app,
            file: args.file,
            git: args.git,
            npm: args.npm
        };
        if (options.core) type = 'core';
        if (options.module) type = 'module';
        if (options.app) type = 'app';
        if (!type) {
            debug('Type required');
            return done(new Error('E_REQUIRED'));
        }
        var npmCmd = (require('os').platform() == 'win32') ? 'npm.cmd' : 'npm';
        debug(`Add: ${name} - ${type}`);

        if (options.file) {
            debug('from file: ' + path.resolve(options.file));
            s.set('deps.' + name, {
                type: type,
                file: path.resolve(options.file),
                require: path.resolve(options.file)
            });
            s.save();
            done(null, s.get('deps'));
        }
        if (options.git) {
            debug('from git: ' + options.git);
            const spawn = require('child_process').spawn;
            const child = spawn('git', ['clone', options.git, name], {
                detached: true,
                cwd: s.get('module.path'),
                stdio: 'inherit'
            });
            child.on('close', (code) => {
                if (code != 0) {
                    debug('Can not add module to dependencies');
                } else {
                    s.set('deps.' + name, {
                        type: type,
                        git: options.git,
                        require: path.join(s.get('module.path'), name, 'dpe.json')
                    });
                    s.save();
                    spawn(npmCmd, ['install'], {
                        detached: true,
                        cwd: path.join(s.get('module.path'), name),
                        stdio: 'inherit'
                    });
                    debug('Module add to your dependencies');
                    done(null, s.get('deps'));
                }
            });
        }
        if (options.npm) {
            debug('from npm: ' + options.npm);
            const spawn = require('child_process').spawn;
            const child = spawn(npmCmd, ['install', options.npm], {
                detached: true,
                cwd: s.get('module.path'),
                stdio: 'inherit'
            });
            child.on('close', (code) => {
                if (code != 0) {
                    debug('Can not add module to dependencies');
                } else {
                    s.set('deps.' + name, {
                        type: type,
                        npm: options.npm,
                        require: path.join(s.get('module.path'), 'node_modules', name, 'dpe.json')
                    });
                    s.save();
                    debug('Module add to your dependencies');
                    done(null, s.get('deps'));
                }
            });
        }
    }

    static listPackages(env, args, done) {
        var deps = env.service.get('deps');
        var list = [];
        Object.keys(deps).map((key) => {
            var type = null;
            if (deps[key]['file']) type = 'file';
            if (deps[key]['git']) type = 'git';
            if (deps[key]['npm']) type = 'npm';
            list.push({
                access: deps[key].type,
                name: key,
                type: type,
                source: deps[key][type]
            });
        });
        done(null, list);
    }

    static removePackage(env, args, done) {
        if (!args.name) return done(new Error('E_REQUIRED'));

        var name = args.name;
        var deps = env.service.get('deps');
        env.service.set('deps', _.omit(deps, name));
        debug('remove path: ' + path.join(env.service.get('module.path'), name));
        var child = require('child_process').spawn('rm', ['-rf', path.join(env.service.get('module.path'), name)], {
            stdio: 'inherit'
        });
        child.on('close', () => {
            env.service.save();
            done(null, env.service.get('deps'));
        });
    }

    static loadPackage(env, args, done) {
        if (!args.name) return done(new Error('E_REQUIRED'));

        var deps = env.service.get('deps');
        var packageName = args.name;

        if (!env.service.get('deps.' + packageName)) {
            debug('skip: ' + packageName);
            done(new Error('E_SKIP'));
        } else {
            var pack = require(env.service.get('deps.' + packageName).require);
            debug('package: ' + packageName);

            Object.keys(pack).map((moduleName) => {
                var module = require(path.resolve(path.dirname(env.service.get('deps.' + packageName).require), pack[moduleName].require));
                debug('\tadd module: ' + moduleName);

                Object.keys(module).map((methodName) => {
                    env.instance.set(`${moduleName}.${methodName}`, new API(
                        `${moduleName}.${methodName}`,
                        {
                            access: "module"
                        },
                        module[methodName]
                    ));
                    debug('\t\tadd method: ' + methodName);
                });
            });

            done(null, true);
        }
    }

    static unloadPackage(env, args, done) {
        if (!args.name) return done(new Error('E_REQUIRED'));

        var deps = env.service.get('deps');
        var packageName = args.name;

        if (!env.service.get('deps.' + packageName)) {
            debug('skip: ' + packageName);
            done(new Error('E_SKIP'));
        } else {
            var pack = require(env.service.get('deps.' + packageName).require);
            debug('package: ' + packageName);

            Object.keys(pack).map((moduleName) => {
                var module = require(path.resolve(path.dirname(env.service.get('deps.' + packageName).require), pack[moduleName].require));
                debug('\tremove module: ' + moduleName);

                Object.keys(module).map((methodName) => {
                    env.instance.delete(`${moduleName}.${methodName}`);
                    debug('\t\tremove method: ' + methodName);
                });
                delete require.cache[path.resolve(path.dirname(env.service.get('deps.' + packageName).require), pack[moduleName].require)];
            });
            done(null, true);
        }
    }

    static coreUpdate(env, args, done) {
        var npmCmd = (require('os').platform() == 'win32') ? 'npm.cmd' : 'npm';
        var child = require('child_process').spawn(npmCmd, ['i', '-g', 'dpe'], {
            stdio: 'inherit'
        });
        child.on('close', () => {
            process.exit();
        });
    }

    static netAdd(env, args, done) {
        if (!args.url) return done(new Error('E_REQUIRED'));

        var hash = crypto.createHash('md5');
        var urlHash = hash.update(args.url).digest('hex');
        var parts = url.parse(args.url);
        debug('set net: ' + 'net.servers.' + urlHash);
        env.service.set('net.servers.' + urlHash, parts);
        env.service.save();

        done(null, env.service.get('net.servers'));
    }

    static netList(env, args, done) {
        var list = [];
        Object.keys(env.service.get('net.servers')).map((item) => {
            list.push(env.service.get('net.servers.' + item).href);
        });

        done(null, list);
    }

    static netRemove(env, args, done) {
        if (!args.url) return done(new Error('E_REQUIRED'));

        var hash = crypto.createHash('md5');
        var urlHash = hash.update(args.url).digest('hex');
        debug('unset net: ' + 'net.servers.' + urlHash);
        env.service.unset('net.servers.' + urlHash);
        env.service.save();

        done(null, env.service.get('net.servers'));
    }
}

module.exports = function (core, API) {
    core.instance.set(
        'net.add',
        new API('net.add', {access:"core"},  BaseAPI.netAdd)
    );
    core.instance.set(
        'net.list',
        new API('net.list', {access:"core"},  BaseAPI.netList)
    );
    core.instance.set(
        'net.remove',
        new API('net.remove', {access:"core"},  BaseAPI.netRemove)
    );
    core.instance.set(
        'core.update',
        new API('core.update', {access:"core"},  BaseAPI.coreUpdate)
    );
    core.instance.set(
        'package.load',
        new API('package.load', {access:"core"},  BaseAPI.loadPackage)
    );
    core.instance.set(
        'package.unload',
        new API('package.unload', {access:"core"},  BaseAPI.unloadPackage)
    );
    core.instance.set(
        'package.install',
        new API('package.install', {access:"core"},  BaseAPI.installPackage)
    );
    core.instance.set(
        'package.list',
        new API('package.list', {access:"core"},  BaseAPI.listPackages)
    );
    core.instance.set(
        'package.remove',
        new API('package.remove', {access:"core"},  BaseAPI.removePackage)
    );
    core.instance.set(
        'core.get',
        new API('core.get', {access:"core"},  BaseAPI.getConfig)
    );
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
