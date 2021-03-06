ContextDB - JSON Context for LevelDB
===

This module creates instances of [**JsonContext**](https://github.com/mmckegg/json-context) from a leveldb database using [levelup](https://github.com/rvagg/node-levelup). Datasources are automatically generated from matchers and watch for realtime changes.

## Installation

```shell
$ npm install contextdb
```

## API

### require('level-json-context')(db, options)

Pass in an instance of a [levelup database](https://github.com/rvagg/node-levelup) and specify matchers. Ensure the database has `valueEncoding: 'json'`. Returns an instance of *contextDB*

Options:

- **matchers**: Object containing named matchers. See [matcher options on JSON Context](https://github.com/mmckegg/json-context#matchers) for all options. Placeholders can be specified anywhere in the matcher filter by using `{$query: 'queryToGetData'}`
- **primaryKey**: Choose the object key to use as the primary index. Defaults to `'id'`. 
- **incrementingKey**: (defaults to '_seq') Add an incrementing ID to objects
- **timestamps**: (defaults to `true`) whether to automatically add timestamps to edited objects `created_at`, `updated_at`, `deleted_at`. Required if using `datasource.emitChangesSince`.

```js
var LevelDB = require('level')
var ContextDB = require('contextdb')

var db = LevelDB(__dirname + '/test-db', {
  valueEncoding: 'json'
})

var contextDB = ContextDB(db, {
  matchers: {
    'items_for_parent': { 
      item: 'items[id={.id}]',
      collection: 'items',
      match: {
        parentId: {$query: 'parentId'},
        type: 'comment'
      },
      allow: { change: true }
    },
    'current_user': {
      item: 'user',
      match: {
        type: 'user',
        id: 'user_123'
      }
    }
  },
  primaryKey: 'id'
})
```

### contextDB.applyChange(object, cb)

Push objects into the database. This will also notify all relevant datasources listening. 

All changes will be accepted so this should only be triggered by trusted sources.

```js
var newObject = {
  id: 1,
  parentId: 'site',
  name: "Home",
  type: 'page'
}

contextDB.applyChange(newObject)
```

### contextDB.applyChanges(arrayOfObjects, cb)

Batch version of `applyChange`.

### contextDB.forceIndex()

Forces the database to reindex all the matchers. Could take some time depending on how many items there are in the DB. **This is automatically run if you change the `match` portion of any matcher**.

### contextDB.generate(options, callback(err, datasource))

Returns a **datasource** (instance of [JSON Context](https://github.com/mmckegg/json-context)) prepopulated with the relevent data as chosen by matchers and starting data.

It will recieve live events from the database for all specified matchers until **`datasource.destroy()`** is called.

Changes pushed in using [`datasource.pushChange`](https://github.com/mmckegg/json-context#datasourcepushchangeobject-changeinfo) will be checked against matchers and if pass, applied to the database.

Options:

- **data**: The starting point for the datasource. Matchers should use $query to hook into the specified attributes.
- **matcherRefs**: An array of refs from the matchers specified when creating the contextDB. This option is order sensitive as matchers can refer to the result of another matcher.

### datasource.emitChangesSince(timestamp)

Will cause the datasource to emit all changes to any listeners that have occured since the given timestamp (including deletions)

## Example

```js
var params = {parentId: 1, userId: 'user_123', token: 'some_unique_random_string'}
var matcherRefs = ['current_user', 'items_for_parent']

var userDatasources = {}

contextDB.generate(params, matcherRefs, function(err, datasource){

  // save the context for connecting to later
  // in production we'd want to auto destroy if no connection recieved
  userDatasources[params.token] = datasource

  // using realtime-templates
  renderer.render('page', datasource, function(err, html){
    res.writeHead(200, {'Content-Type': 'text/html'});
    res.end(html)
  })
})
```
And handle the realtime connections:

```js
var Shoe = require('shoe')

Shoe(function (stream) {
  var datasource = null

  stream.once('data', function(data){
    var token = data.toString().trim()
    datasource = userDatasources[token]
    console.log('LOGGING IN:', token)
    if (datasource){
      stream.pipe(datasource.changeStream()).pipe(stream)
    } else {
      stream.close()
    }
  })

  stream.once('end', function () {
    if (datasource){
      console.log("CLOSING:", datasource.data.token)
      datasource.destroy()
      userDatasources[datasource.data.token] = null
    }
  })

}).install(server, '/contexts')
```

And on the client:

```js
var stream = Shoe('http://localhost:9999/contexts')
stream.write(datasource.data.token + '\n') //log in
stream.pipe(datasource.changeStream({verifiedChange: true})).pipe(stream)
```