#!/usr/bin/env node
"use strict";

var debug   = require('debug')('dpe:cli');
var util = require('util');
var path = require('path');
var fs  = require('fs');

var program = require('commander');

const crypto = require('crypto');
const hash = crypto.createHash('md5');
var url = require('url');

program
    .version(require('../package.json').version)
    .option('-c, --config <config>', 'path to config directory');

program
    .command('add <url> <key>')
    .description('add server')
    .action(function(_url, _key) {
        var Service = require('../lib/service');
        try {
            var s = new Service({
                init: false,
                config: program.config
            });
        } catch (err) {
            console.log('For first time you need to run: sudo dpe service configure ..., read help for options.');
            process.exit(1);
        }
        var urlHash = hash.update(_url).digest('hex');
        var parts = url.parse(_url);
        s.set('net.auth.' + urlHash, {
            url: _url,
            key: _key
        });
        s.save();
    });

program
    .command('list')
    .description('list keys')
    .action(function() {
        var Service = require('../lib/service');
        try {
            var s = new Service({
                init: false,
                config: program.config
            });
        } catch (err) {
            console.log('For first time you need to run: sudo dpe service configure ..., read help for options.');
            process.exit(1);
        }
        var cfg = s.get('net.auth');
        Object.keys(cfg ? cfg : {}).map((item) => {
            console.log(s.get('net.auth.' + item).url + ' : ' + s.get('net.auth.' + item).key);
        });
    });

program
    .command('remove <url>')
    .description('add server')
    .action(function(_url) {
        var Service = require('../lib/service');
        try {
            var s = new Service({
                init: false,
                config: program.config
            });
        } catch (err) {
            console.log('For first time you need to run: sudo dpe service configure ..., read help for options.');
            process.exit(1);
        }
        var urlHash = hash.update(_url).digest('hex');
        s.unset('net.auth.' + urlHash);
        s.save();
    });

program.parse(process.argv);
