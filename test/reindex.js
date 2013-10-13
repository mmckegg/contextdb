var test = require('tap').test
var LevelDB = require('level')
var ContextDB = require('../')
var JsonContext = require('json-context')
var rimraf = require('rimraf')

var testPath = __dirname + '/test-db'
rimraf(testPath, function(){

  test('database reindex when matchers change', function(t){

    t.plan(5)

    var site = {id: 'site-1', type: 'site', name: "test 1234"}

    var inaccessibleObject = {id: 'something', type: 'thing', name: "test 4567", site_id: site.id}


    var originalMatchers = [
      { ref: 'site', 
        item: 'site', 
        match: {
          type: 'site',
          id: {$query: 'site_id'}
        }
      }
    ]

    var db = LevelDB(testPath, {
      valueEncoding: 'json'
    }, function(){
      var contextDB = ContextDB(db, {
        matchers: originalMatchers
      })

      contextDB.applyChanges([site, inaccessibleObject], function(){
        contextDB.generate({
          data: {site_id: site.id},
          matcherRefs: ['site']
        }, function(err, datasource){
          t.deepEqual(datasource.data, {site_id: site.id, site: site}, "only first item matched")
          datasource.destroy()
          db.close(secondDatabase)
        })
      })

    })

    var changedMatchers = [
      { ref: 'changed-site', 
        item: 'changedSite', 
        match: {
          type: 'site',
          id: {$query: 'site_id'}
        }
      }, {
        ref: 'now-accessible',
        item: 'accessible',
        match: {
          type: 'thing',
          site_id: {$query: 'site_id'}
        }
      }
    ]

    function secondDatabase(){

      var db = LevelDB(testPath, {
        valueEncoding: 'json'
      }, function(){
        var contextDB = ContextDB(db, {
          matchers: changedMatchers
        })

        contextDB.on('reindex', function(){
          t.ok(true, 'reindex event emitted')
        })

        contextDB.once('indexed', function(){

          t.ok(true, 'index completed')

          contextDB.generate({
            data: {site_id: site.id},
            matcherRefs: ['changed-site', 'now-accessible']
          }, function(err, datasource){

            if (err) throw err

            t.deepEqual(datasource.data, {site_id: site.id, changedSite: site, accessible: inaccessibleObject}, "item was reindexed, and second item now matched")
            datasource.destroy()
            db.close(thirdDatabase)
          })
        })

      })
    }

    function thirdDatabase(){

      var db = LevelDB(testPath, {
        valueEncoding: 'json'
      })

      var contextDB = ContextDB(db, {
        matchers: changedMatchers
      })

      contextDB.on('reindex', function(){
        throw new Error('should not reindex')
      })

      setTimeout(function(){
        t.ok(true, 'reload database with same matchers didn\'t cause reindex')
      }, 40)
    }

  })



})