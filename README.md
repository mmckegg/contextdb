JSON Context - LevelDB
===

This module creates instances of **jsonContext** from a leveldb database using [levelup](https://github.com/rvagg/node-levelup). [Contexts](https://github.com/mmckegg/json-context) are automatically generated from matchers, and provides ability to watch matchers for realtime notifications.

## API

### require('level-json-context')(db, options)

Pass in an instance of a [levelup database](https://github.com/rvagg/node-levelup) and specify matchers. Ensure the database has `encoding: 'json'`. Returns an instance of *contextDB*

Options:
  **matchers**: Route changes into the correct places, and provide building blocks for page contexts. In addition to the [matcher options on JSON Context](https://github.com/mmckegg/json-context#matchers), you need to specify `matcher.ref` as well. Use `ref` to refer to this matcher later when building contexts. Placeholders can be specified anywhere in the matcher filter by using `{$param: 'queryToGetData'}`
  **primaryKey**: Choose the object key to use as the primary index. Defaults to `'id'`. 


```js
var db = leveldb(__dirname + '/test-db', {
  encoding: 'json'
})

var contextDB = levelContext(db, {
  matchers: [
    { ref: 'items_for_parent',
      item: 'items[id={.id}]',
      collection: 'items',
      match: {
        parent_id: {$param: 'parent_id'},
        type: 'comment'
      },
      allow: {
        change: true
      }
    },
    { ref: 'current_user',
      item: 'user',
      match: {
        type: 'user',
        id: 'user_123'
      }
    }
  ],
  primaryKey: 'id'
})
```

### contextDB.applyChange(object)

Push objects into the database. This will also notify all relevant matcher listers. 

All changes will be accepted so this should only be triggered by trusted sources.

```js
var newObject = {
  id: 1,
  parent_id: 'site',
  name: "Home",
  type: 'page'
}

contextDB.applyChange(newObject)
```


### contextDB.generate(params, matcherRefs, callback(err, datasource))

Returns a **datasource** (instance of [JSON Context](https://github.com/mmckegg/json-context)) prepopulated with the relevent data as chosen by matchers and params.

It will recieve live events from the database for all specified matchers until `datasource.destroy()` is called.

`matcherRefs` is order sensitive as params can refer to the result of another matcher.


## Example

```js
var params = {parent_id: 1, user_id: 'user_123', token: 'some_unique_random_string'}
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
shoe(function (stream) {
  var datasource = null

  stream.once('data', function(data){
    var token = data.toString().trim()
    datasource = userDatasources[token]
    if (datasource){
      stream.pipe(split()).on('data', function(data){
        datasource.pushChange(JSON.parse(data), {source: 'user'})
      })
      datasource.on('change', function(object, changeInfo){
        if (changeInfo.source === 'database'){
          stream.write(safeStringify(object) + '\n')
        }
      })
    } else {
      stream.close()
    }
  })

  stream.on('end', function () {
    if (datasource){
      datasource.destroy()
      userDatasources[datasource.data.token] = null
    }
  });

}).install(server, '/contexts')
```

And on the client:

```js
var stream = shoe('/contexts');
stream.pipe(split()).on('data', function(line){
  // push the changed objects coming down the wire directly into the context
  datasource.pushChange(JSON.parse(line), {source: 'server'})
})
stream.write(datasource.data.token + '\n')

datasource.on('change', function(object, changeInfo){
  if (changeInfo.source === 'user'){
    stream.write(jsonContext.safeStringify(object) + '\n')
  }
})
```