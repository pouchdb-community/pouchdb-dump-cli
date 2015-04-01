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
  .alias('c', 'cookie')
  .describe('c', 'cookie for the CouchDB database (if it\'s protected)')
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
var ProgressBar = require('progress');

PouchDB.plugin(replicationStream.plugin);
Object.keys(replicationStream.adapters).forEach(function (adapterName) {
  var adapter = replicationStream.adapters[adapterName];
  PouchDB.adapter(adapterName, adapter);
});

var outfile = argv.o;
var split = argv.s;
var password = argv.p;
var username = argv.u;
var cookie = argv.c;

var dbOpts = {};
if(cookie) {
  dbOpts.ajax = {
    headers: {
      Cookie: cookie
    }
  }
}

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
      } else if (res.statusCode && res.statusCode === 401 && cookie) {
        resolve(); // cookie auth not possible here
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
  return new PouchDB(dbName, dbOpts);
}).then(function (db) {
  var dumpOpts = {};
  if (!split) {
    var outstream = outfile ? fs.createWriteStream(outfile) : process.stdout;
    return db.dump(outstream, dumpOpts);
  }

  // estimate a good batch size. it doesn't affect the integrity of the output,
  // but it gives us a nice granularity on the progress bar, and also corrects
  // for cases where there are leaf conflicts and thus the output might not contain
  // exactly the "split" size
  if (split) {
    dumpOpts.batch_size = Math.max(1, Math.floor(split / 10));
  } else {
    dumpOpts.batch_size = 100; // decent default for good performance
  }
  
  var numFiles = 0;
  var numDocsInBatch = 0;
  var out = [];
  var header;
  var first = true;

  var splitPromises = [];
  var totalSeq;

  var bar;

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
    numDocsInBatch = 0;
    numFiles++;
  }

  var splitStream = through(function (chunk, _, next) {
    var line = JSON.parse(chunk);
    if (first) {
      header = chunk;
      console.log();
      totalSeq = line.db_info.update_seq;
      bar = new ProgressBar('Dumping [:bar] :percent :etam', {
        total: totalSeq,
        complete: '=',
        incomplete: ' ',
        width: 40
      });
    } else if (line.seq) {
      bar.update(line.seq / totalSeq);
    }

    if (line.docs) {
      numDocsInBatch += line.docs.length;
      if (numDocsInBatch >= split) {
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
      dumpToSplitFile();
    }
    return Promise.all(splitPromises).then(function () {
      console.log(); // clear the progress bar
    });
  });
}).then(function () {
  process.exit(0);
}).catch(function (err) {
  console.error('unexpected error');
  console.error(err);
  process.exit(1);
});
