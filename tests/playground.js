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
      match: {
        parent_id: {$query: 'parent_id'},
        type: 'comment'
      },
      allow: {
        append: true,
        update: true
      }
    }
  ]
})


contextDB.applyChange({
  id: 1,
  parent_id: 'client',
  name: "Control Page",
  type: 'workpaper'
})


contextDB.db.once('queue:drain', function(){
  contextDB.generate({parent_id: 1}, ['items_for_parent'], function(err, context){
    
    context.on('change', function(object, changeInfo){
      if (changeInfo.source == 'database'){
        console.log('1: RECIEVED CHANGE')
      } else {
        console.log('1: LOCAL CHANGE')
      }
    })

    setTimeout(function(){
      var object = {
        id: 2,
        parent_id: 1,
        description: "I am a cool comment lol",
        type: 'comment'
      }
      context.pushChange(object, {source: 'user', onDeny: function(){
        console.log('CHANGE DENIED!')
      }})
    }, 100)



  })

  contextDB.generate({parent_id: 1}, ['items_for_parent'], function(err, context){
    
    context.on('change', function(object, changeInfo){
      if (changeInfo.source == 'database'){
        console.log('2: RECIEVED CHANGE')
      }
      console.log(changeInfo)
    })
    
  })
})

setTimeout(function(){
  contextDB.applyChange({
    id: 3,
    parent_id: 1,
    description: "I am another comment",
    type: 'comment'
  })
}, 1500)