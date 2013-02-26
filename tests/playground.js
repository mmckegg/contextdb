var levelContext = require('../level-context')
var rimraf  = require('rimraf')

var leveldb = require('levelup')

var dir ='/tmp/level-json-context-test' 

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
        changes: true
      }
    }
  ]
})

contextDB.listen('items_for_parent', {parent_id: 1}, function(key, value){
  console.log('>>>', key, value)
})


contextDB.pushChange({
  id: 1,
  parent_id: 'client',
  name: "Control Page",
  type: 'workpaper'
}, {matcherRef: 'items_for_parent', params: {parent_id: 1}, source: 'user'})

contextDB.pushChange({
  id: 2,
  parent_id: 1,
  description: "I am a cool comment lol",
  type: 'comment'
}, {matcherRef: 'items_for_parent', source: 'user'})

contextDB.db.once('queue:drain', function(){
  contextDB.generate({parent_id: 1}, ['items_for_parent'], function(err, context){
    console.log('context:', context)
  })
})


setTimeout(function(){
  contextDB.pushChange({
    id: 3,
    parent_id: 1,
    description: "I am another comment",
    type: 'comment'
  }, {matcherRef: 'items_for_parent', params: {parent_id: 1}, source: 'user'})
}, 1500)