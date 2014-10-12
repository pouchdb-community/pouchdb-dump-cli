pouchdb-dump-cli
=======

Dump a PouchDB or CouchDB database to a file. Then you can load it into another PouchDB or CouchDB database.

When you do so, it will be as if you had replicated from one database to the other, but without all the standard HTTP chattiness of the CouchDB protocol.

In other words, this is a very fast way to do initial replication. And it's also safe to do multiple times, since the "load" operation is idempotent.

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

