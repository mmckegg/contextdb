JSON Context - LevelDB
===

This module creates instances of **jsonContext** from a leveldb database using [levelup](https://github.com/rvagg/node-levelup). [Contexts](https://github.com/mmckegg/json-context) are automatically generated from matchers, and provides ability to watch matchers for realtime notifications.

## API

### require('level-json-context')(db, options)

Pass in an instance of a [levelup database](https://github.com/rvagg/node-levelup) and specify matchers. Ensure the database has `encoding: 'json'`. Returns an instance of *contextDB*

Options:
  **matchers**: Route changes into the correct places, and provide building blocks for page contexts. In addition to the [matcher options on JSON Context](https://github.com/mmckegg/json-context#matchers), you need to specify `matcher.ref` as well. Use `ref` to refer to this matcher later when building contexts. Placeholders can be specified anywhere in the matcher filter by using `{$param: 'queryToGetData'}
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
      filter: {
        match: {
          parent_id: {$param: 'parent_id'},
          type: 'comment'
        },
        create: {
          user_id: {$param: 'user_id'}
        }
      }
    },
    { ref: 'current_user',
      item: 'user',
      filter: {
        match: {
          type: 'user',
          id: 'user_123'
        }
      }
    }
  ],
  primaryKey: 'id'
})
```

### contextDB.pushChange(object, changeInfo)

Push objects into the database. This will also notify all relevant matcher listers. 

Specify `changeInfo.matcherRef` to the matcher to handle permissions and `changeInfo.params` for any params to be sent to the matcher. This can be used for user permissions.

```js
var newObject = {
  id: 1,
  parent_id: 'client',
  name: "Control Page",
  type: 'workpaper'
}

contextDB.pushChange(newObject, {
  matcherRef: 'items_for_parent', params: {user_id: 'user_123', parent_id: 1}, source: 'user'
})
```


### contextDB.generate(params, matcherRefs, callback(err, datasource))

Returns an instance of [JSON Context](https://github.com/mmckegg/json-context) prepopulated with the relevent data as chosen by matchers and params.

`matcherRefs` is order sensitive as params can refer to the result of another matcher.

```js
var params = {parent_id: 1, user_id: 'user_123'}
var matcherRefs = ['current_user', 'items_for_parent']

contextDB.generate(params, matcherRefs, function(err, datasource){
  // using realtime-templates
  renderer.render('page', datasource, function(err, html){
    res.writeHead(200, {'Content-Type': 'text/html'});
    res.end(html)
  })
})
```

### contextDB.listen(matcherRef, contextParams, listener(object, changeInfo))

Choose a matcher, pass in the context params needed to make it happen, and a listener function to recieve change events. Returns **listenerId**.

`changeInfo` will have `matcher`, `listenerId`, `source` (database), `key`

```js
var shoe = require('shoe')

shoe(function (stream) {
  
  var listenerId = contextDB.listen('items_for_parent', {
    parent_id: parent_id, user_id: user_id
  }, function(object, changeInfo){
    stream.write(JSON.stringify(object))
    stream.write('\n')
  })

  stream.on('end', function () {
    contextDB.unlisten('items_for_parent', listenerId)
  });

}).install(server, '/items_for_parent')
```

### contextDB.unlisten(matcherRef, listenerId)

Pass in the matcherRef and listenerId as returned from `contextDB.listen`
