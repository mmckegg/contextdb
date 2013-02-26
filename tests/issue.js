var map = require('level-map')
var levelup = require('levelup')

var path = '/tmp/level-map-test'
levelup(path, {createIfMissing: true}, function (err, db) {

  map(db)

  db.map.add(function test (key, value, emit) {
    emit(['somekey'], value)
  })

  db.put('a', 1)

  db.once('queue:drain', function () {

    db.map.view({name: 'test', tail: false})
      .on('data', function (data) {
        console.log('view', data.key, ''+data.value)
      }).on('end', function(){
        console.log("ENDED!")
      })
  })
})