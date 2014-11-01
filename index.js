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
  .alias('s', 'split')
  .describe('s', 'split into multiple files, for every n docs')
  .example('$0 http://localhost:5984/mydb > dump.txt',
    'Dump from the "mydb" CouchDB to dump.txt')
  .example('$0 /path/to/mydb > dump.txt',
    'Dump from the "mydb" LevelDB-based PouchDB to dump.txt')
  .example('$0 /path/to/mydb -o dump.txt',
    'Dump to the specified file instead of stdout')
  .example('$0 /path/to/mydb -o dump.txt -s 100',
    'Dump every 100 documents to dump_00.txt, dump_01.txt, dump_02.txt, etc.')
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
var through = require('through2').obj;
var fs = require('fs');

PouchDB.plugin(replicationStream.plugin);
Object.keys(replicationStream.adapters).forEach(function (adapterName) {
  var adapter = replicationStream.adapters[adapterName];
  PouchDB.adapter(adapterName, adapter);
});

var outfile = argv.o;
var split = argv.s;
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
if (split && !outfile) {
  console.error('If you supply a split, you must also supply an outfile');
  return process.exit(1);
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
  var dumpOpts = {batch_size: 1};
  if (!split) {
    var outstream = outfile ? fs.createWriteStream(outfile) : process.stdout;
    return db.dump(outstream, dumpOpts);
  }

  var numFiles = 0;
  var numDocs = 0;
  var out = [];
  var header;
  var first = true;

  var splitPromises = [];

  function createSplitFileName() {
    var numStr = numFiles.toString();
    while (numStr.length < 8) {
      numStr = '0' + numStr;
    }
    // if the filename is e.g. foo.txt, return
    // foo_00000000.txt
    // else just foo_00000000
    var match = outfile.match(/\.[^\.]+$/);
    if (match) {
      return outfile.replace(/\.[^\.]+$/, '_' + numStr + match[0]);
    } else {
      return outfile + '_' + numStr;
    }
  }
  function dumpToSplitFile() {
    var outstream = fs.createWriteStream(createSplitFileName());
    outstream.write(header);
    out.forEach(function (chunk) {
      outstream.write(chunk);
    });
    outstream.end();
    splitPromises.push(new Promise(function (resolve) {
      outstream.on('finish', resolve);
    }));
    out = [];
    numFiles++;
  }

  var splitStream = through(function (chunk, _, next) {
    if (first) {
      header = chunk;
    }
    var line = JSON.parse(chunk);

    if (line.docs) {
      numDocs++;
      if (numDocs > 1 && numDocs % split === 1) {
        dumpToSplitFile();
      }
    }
    if (!first) {
      out.push(chunk);
    }
    first = false;
    next();
  });
  return db.dump(splitStream, dumpOpts).then(function () {
    if (out.length) {
      dumpToSplitFile()
    }
    return Promise.all(splitPromises);
  });
}).then(function () {
  process.exit(0);
}).catch(function (err) {
  console.error('unexpected error');
  console.error(err);
  process.exit(1);
});