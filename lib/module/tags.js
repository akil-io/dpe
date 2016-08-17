"use strict";

//@TODO: check tags auto

var os = require('os');

var checkTag = [];

checkTag.push(function (core) {
    return (os.cpus().length > 4) ? "cpu" : null;
});

checkTag.push(function (core) {
    return ((os.totalmem() / 1024 / 1024 / 1204) > 4) ? "memory" : null;
});

module.exports = function (core) {
    var tags = [];
    //start

    //end
    return tags;
};