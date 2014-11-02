PouchDB Dump CLI
=======

Dump a PouchDB or CouchDB database to a file, or to multiple files. Then you can load it into another PouchDB or CouchDB database.

When you do so, it will be as if you had replicated from one database to the other, but without all the standard HTTP chattiness of the CouchDB protocol.

In other words, this is a very fast way to do initial replication. And it's also safe to do multiple times, since the "load" operation is idempotent.

To load the dump file, use [pouchdb-load](https://github.com/nolanlawson/pouchdb-load).

To dump from within your Node.js app instead of as a CLI, use [pouchdb-replication-stream](https://github.com/nolanlawson/pouchdb-replication-stream).

Usage
--------

To install:

```bash
$ npm install -g pouchdb-dump-cli
```

To dump a CouchDB:

```bash
$ pouchdb-dump http://localhost:5984/mydb > dump.txt
```

To dump a LevelDB-based PouchDB:

```bash
$ pouchdb-dump /path/to/my/db > dump.txt
```

Full usage and examples:

```
Examples:
  pouchdb-dump http://localhost:5984/mydb > dump.txt                             Dump from the "mydb" CouchDB to dump.txt
  pouchdb-dump /path/to/mydb > dump.txt                                          Dump from the "mydb" LevelDB-based PouchDB to dump.txt
  pouchdb-dump /path/to/mydb -o dump.txt                                         Dump to the specified file instead of stdout
  pouchdb-dump /path/to/mydb -o dump.txt -s 100                                  Dump every 100 documents to dump_00.txt, dump_01.txt, dump_02.txt, etc.
  pouchdb-dump http://example.com/mydb -u myUsername -p myPassword > dump.txt    Specify a CouchDB username and password if it's protected


Options:
  -h, --help         this help message                                    
  -o, --output-file  output file (else will dump to stdout)               
  -u, --username     username for the CouchDB database (if it's protected)
  -p, --password     password for the CouchDB database (if it's protected)
  -s, --split        split into multiple files, for every n docs 
```

