var test = require('tap').test
var LevelDB = require('levelup')
var ContextDB = require('../')
var JsonContext = require('json-context')
var rimraf = require('rimraf')

var testPath = __dirname + '/test-db'
rimraf(testPath, function(){

  var db = LevelDB(testPath, {
    encoding: 'json'
  })

  var contextDB = ContextDB(db, {
    matchers: [
      { ref: 'items', 
        collection: 'items', 
        item: 'items[id={.id}]', match: {
          type: 'item',
          site_id: {$query: 'site_id'}
        }
      },
      { ref: 'site', 
        item: 'site', 
        match: {
          type: 'site',
          id: {$query: 'site_id'}
        }
      }
    ]
  })

  test('Apply direct changes', function(t){
    t.plan(4)

    var site1 = { id: 'apply-site-1', type: 'site', name: "Cool Site 1" }
    var item1 = {
      id: 'apply-item-1',
      type: 'item',
      site_id: site1.id,
      description: "Item 1"
    }

    var site2 = { id: 'apply-site-2', type: 'site', name: "Cool Site 2" }
    var item2 = {
      id: 'apply-item-2',
      type: 'item',
      site_id: site2.id,
      description: "Item 2"
    }

    contextDB.applyChanges([site1, site2], function(){
      contextDB.generate({
        data: {site_id: site1.id},
        matcherRefs: ['site', 'items']
      }, function(err, datasource){

        if (err) throw err

        t.deepEqual(datasource.data.site, site1, "check return site 1 matches applied")
        datasource.on('change', function(object, changeInfo){
          t.deepEqual(datasource.data.items[0], item1, "check item 1 emitted after context created")
        })
        contextDB.applyChange(item1)
      })

      contextDB.generate({
        data: {site_id: site2.id},
        matcherRefs: ['site', 'items']
      }, function(err, datasource){
        t.deepEqual(datasource.data.site, site2, "check return site 2 matches applied")
        datasource.on('change', function(object, changeInfo){
          t.deepEqual(datasource.data.items[0], item2, "check item 2 emitted after context created")
        })
        contextDB.applyChange(item2)
      })
    })

  })

  test("changes from one datasource applies to others", function(t){
    t.plan(2)

    var site = { id: 'site-1', type: 'site', name: "Cool Site 1" }
    var item1 = {
      id: 'item-1',
      type: 'item',
      site_id: site.id,
      description: "Item 1"
    }
    var item2 = {
      id: 'item-2',
      type: 'item',
      site_id: site.id,
      description: "Item 2"
    }

    contextDB.applyChanges([site, item1, item2], function(){

      contextDB.generate({
        data: {site_id: site.id},
        matcherRefs: ['site', 'items']
      }, function(err, datasource1){

        contextDB.generate({
          data: {site_id: site.id},
          matcherRefs: ['site', 'items']
        }, function(err, datasource2){


          var changedItem1 = mergeClone(item1, {name: 'Changed by datasource 1'})
          var changedItem2 = mergeClone(item2, {name: 'Changed by datasource 2'})

          datasource1.on('change', function(object, changeInfo){
            if (changeInfo.source === contextDB && object.id === changedItem2.id){
              t.deepEqual(
                datasource1.data.items[1], 
                mergeClone(changedItem2, {updated_at: object.updated_at}),
                "check item 2 emitted from datasource 1"
              )
            }
          })

          datasource2.on('change', function(object, changeInfo){
            if (changeInfo.source === contextDB && object.id === changedItem1.id){
              t.deepEqual(
                datasource2.data.items[0], 
                mergeClone(changedItem1, {updated_at: object.updated_at}),
                "check item 1 emitted from datasource 2"
              )
            }
          })

          datasource1.pushChange(changedItem1, {verifiedChange: true})
          datasource2.pushChange(changedItem2, {verifiedChange: true})
        })
      })

    })
  })

  test("Changes since", function(t){

    t.plan(2)

    var site = { id: 'since-site-1', type: 'site', name: "Cool Site 1" }
    var item1 = {
      id: 'since-item-1',
      type: 'item',
      site_id: site.id,
      description: "Item 1"
    }
    var item2 = {
      id: 'since-item-2',
      type: 'item',
      site_id: site.id,
      description: "Item 2"
    }

    contextDB.applyChanges([site, item1, item2], function(){

      contextDB.generate({
        data: {site_id: site.id},
        matcherRefs: ['site', 'items'],
      }, function(err, datasource){
        
        var offlineDatasource = JsonContext(JSON.parse(datasource.toJSON()))

        var timestamp = Date.now()

        var changedItem1 = mergeClone(item1, {description: "changed to be better"})
        var deletedItem2 = mergeClone(item2, {_deleted: true})
        var newItem3 = {
          id: 'since-item-3',
          type: 'item',
          site_id: site.id,
          description: "New Item 3"
        }

        contextDB.applyChanges([changedItem1, deletedItem2, newItem3], function(){
          t.deepEqual(offlineDatasource.data, {
            site: site,
            site_id: site.id,
            items: [item1, item2]
          }, "Before request changes, should be the same as original state")

          // probably should test requesting via stream elsewhere
          var offlineStream = offlineDatasource.changeStream({verifiedChange: true})
          var onlineStream = datasource.changeStream()

          onlineStream.pipe(offlineStream).pipe(onlineStream)
          offlineStream.requestChangesSince(timestamp)

          setTimeout(function(){
            t.deepEqual(offlineDatasource.data, {
              site: site,
              site_id: site.id,
              items: [changedItem1, newItem3]
            }, "check changes from past made")
          }, 50)
        })

      })

    })

  })

  test("delete change", function(t){
    t.plan(3)

    var site = { id: 'apply-site-1', type: 'site', name: "Cool Site 1" }
    var item1 = {
      id: 'apply-item-1',
      type: 'item',
      site_id: site.id,
      description: "Item 1"
    }
    var item2 = {
      id: 'apply-item-2',
      type: 'item',
      site_id: site.id,
      description: "Item 2"
    }

    contextDB.applyChanges([site, item1, item2], function(){
      contextDB.generate({
        data: {site_id: site.id},
        matcherRefs: ['site', 'items']
      }, function(err, datasource){

        if (err) throw err

        t.deepEqual(datasource.data, {
          site: site,
          items: [item1, item2],
          site_id: site.id
        }, "check initial state")

        var deletedItem2 = mergeClone(item2, {_deleted: true})
        datasource.pushChange(deletedItem2, {verifiedChange: true})

        t.deepEqual(datasource.data, {
          site: site,
          items: [item1],
          site_id: site.id
        }, "check for immediate delete")

        contextDB.applyChange(item1)
      })

      setTimeout(function(){
        contextDB.generate({
          data: {site_id: site.id},
          matcherRefs: ['site', 'items']
        }, function(err, datasource){
          t.deepEqual(datasource.data, {
            site: site,
            items: [item1],
            site_id: site.id
          }, "check for still deleted on reload")
        })
      }, 20)

    })

  })

})

function mergeClone(){
  var result = {}
  for (var i=0;i<arguments.length;i++){
    var obj = arguments[i]
    if (obj){
      Object.keys(obj).forEach(function(key){
        result[key] = obj[key]
      })
    }
  }
  return result
}
