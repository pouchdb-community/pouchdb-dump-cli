#!/usr/bin/env node
'use strict';


var yargs = require('yargs')
  .boolean('h')
  .alias('h', 'help')
  .describe('h', 'this help message')
  .alias('o', 'output-file')
  .describe('o', 'output file (else will dump to stdout)')
  .alias('u', 'username')
  .describe('u', 'username for the CouchDB database (if it\'s protected)')
  .alias('p', 'password')
  .describe('p', 'password for the CouchDB database (if it\'s protected)')
  .example('$0 http://localhost:5984/mydb > dump.txt',
    'Dump from the "mydb" CouchDB to dump.txt')
  .example('$0 /path/to/mydb > dump.txt',
    'Dump from the "mydb" LevelDB-based PouchDB to dump.txt')
  .example('$0 /path/to/mydb -o dump.txt',
    'Dump to the specified file instead of stdout')
  .example('$0 http://example.com/mydb -u myUsername -p myPassword > dump.txt',
    'Specify a CouchDB username and password if it\'s protected');

var argv = yargs.argv;

if (argv.h) {
  yargs.showHelp();
  return process.exit(0);
}

var dbName = argv._[0];
if (!dbName) {
  console.error('You need to supply a database URL or filepath. -h for help');
  return process.exit(1);
}

var Promise = require('lie');
var PouchDB = require('pouchdb');
var replicationStream = require('pouchdb-replication-stream');

PouchDB.plugin(replicationStream.plugin);
Object.keys(replicationStream.adapters).forEach(function (adapterName) {
  var adapter = replicationStream.adapters[adapterName];
  PouchDB.adapter(adapterName, adapter);
});

var outfile = argv.o;
var password = argv.p;
var username = argv.u;

if ((!!password) !== (!!username)) {
  console.error('You must either supply both a username and password, or neither');
  return process.exit(1);
} else if (password) {
  var URL = require('url');
  var parsedURL = URL.parse(dbName);
  if (!parsedURL.protocol) {
    console.error('Usernames/passwords are only for remote databases');
    console.error('Is ' + dbName + ' a remote database?');
    return process.exit(1);
  }
  dbName = parsedURL.protocol + '//' + encodeURIComponent(username) +
    ':' + encodeURIComponent(password) + '@' + parsedURL.host +
    parsedURL.path;
}

// check that it exists
return new Promise(function (resolve, reject) {
  if (/^https?:\/\//.test(dbName)) {
    var protocol = /^https/.test(dbName) ? require('https') : require('http');
    protocol.get(dbName, function (res) {
      if (res.statusCode && res.statusCode / 100 === 2) {
        resolve();
      } else {
        res.pipe(process.stderr);
        reject(new Error(dbName + ': ' + res.statusCode));
      }
    }).on('error', reject).end();
    resolve();
  } else {
    require('fs').exists(dbName, function (exists) {
      if (!exists) {
        reject(new Error(dbName + ' not found. does the file/directory exist?'));
      } else {
        resolve();
      }
    });
  }
}).then(function () {
  return new PouchDB(dbName);
}).then(function (db) {
  var outstream = outfile ? require('fs').createWriteStream(outfile) : process.stdout;
  return db.dump(outstream, {batch_size: 1});
}).then(function () {
  process.exit(0);
}).catch(function (err) {
  console.error('unexpected error');
  console.error(err);
  process.exit(1);
});