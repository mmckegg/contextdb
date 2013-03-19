var JsonContext = require('json-context')
var SubLevel  = require('level-sublevel')
var MatchMap = require('./match_map')
var TimeoutMap = require('./timeout-map')
var EventEmitter = require("events").EventEmitter

var checkFilter = require('json-filter')
var async = require('async')


module.exports = function(levelDB, options){

  var rootOptions = options || {}

  var deleted = TimeoutMap(3000)

  var dataFilters = rootOptions.dataFilters

  rootOptions.primaryKey = rootOptions.primaryKey || 'id'
  if (!rootOptions.hasOwnProperty('incrementingKey')){
    rootOptions.incrementingKey = '_seq'
  }
  if (rootOptions.timestamps !== false){
    rootOptions.timestamps = true
  }

  var db = SubLevel(levelDB)
  var metaDB = db.sublevel('meta')
  var matchDb = MatchMap(db, rootOptions.matchers)

  var self = new EventEmitter()
  self.db = db

  matchDb.on('reindex', function(){
    self.emit('reindex')
  })

  // incrementing values
  var currentIncementValue = 0
  if (rootOptions.incrementingKey){
    metaDB.get('increment!' + rootOptions.incrementingKey, function(err, val){
      currentIncementValue = parseInt(val, 10) || 0
    })
  }
  function incrementKey(){
    currentIncementValue += 1
    metaDB.put('increment!' + rootOptions.incrementingKey, currentIncementValue)
    return currentIncementValue
  }

  function getObjectKey(object){
    if (!checkValid(object[rootOptions.primaryKey])){
      throw new Error("id can't contain '!' or '~")
    }
    if (rootOptions.incrementingKey){
      var ref = parseInt(object[rootOptions.incrementingKey])
      return padNumber(ref, 10) + '!' + object[rootOptions.primaryKey]
    } else {
      return padNumber(0, 10) + '!' + object[rootOptions.primaryKey]
    }
  }

  function checkValid(key){
    return !~key.indexOf('~') && !~key.indexOf('!') && !~key.indexOf('\xFF') && !~key.indexOf('\0')
  }

  self.applyChange = function(object, changeInfo, cb){
    self.applyChanges([object], changeInfo, cb)
    return object
  }

  // batch version
  self.applyChanges = function(objects, changeInfo, cb){

    if (typeof changeInfo === 'function'){
      cb = changeInfo
      changeInfo = {}
    }

    changeInfo = changeInfo || {}
    if (changeInfo.source !== self){

      try{

        var changes = objects.map(function(object){
          if (rootOptions.incrementingKey){
            if (!object[rootOptions.incrementingKey]){
              object[rootOptions.incrementingKey] = incrementKey()
            }
          }

          if (rootOptions.timestamps){
            object.updated_at = Date.now()
            object.created_at = object.created_at || Date.now()
            if (object._deleted){
              object.deleted_at = Date.now()
            }
          }

          var key = getObjectKey(object)
          if (object._deleted){
            deleted.set(key, object)
          }

          return {type: 'put', key: key, value: object}
        })

        db.batch(changes, cb)

      } catch (ex){
        cb&&cb(ex)
      }

    }
  }

  self.generate = function(options, callback){

    var data = options.data || {}
    var matcherRefs = options.matcherRefs || []

    try {
      var matchers = matcherRefs.map(function(ref){
        var matcher = matchDb.lookupMatcher(ref)
        if (!matcher){
          throw new Error('No matcher called ' + ref)
        }
        return matcher
      })
    } catch (ex){
      return callback(ex)
    }

    var context = JsonContext({matchers: matchers, dataFilters: dataFilters, data: data})
    var contextListeners = {}

    var streams = []

    context.destroy = function(){
      streams.forEach(function(stream){
        stream.destroy()
      })
      contextListeners = null
      context.emit('end')
      context.removeAllListeners()
    }

    context.getChanges = function(cb){
      var result = []
      async.eachSeries(context.matchers, function(matcher, next){
        matchDb.createMatchStream(matcher.ref, context, {tail: false}).on('data', function(data){
          result.push(data.value)
        }).on('end', next).on('error', next)
      }, function(err){
        if (err) return cb&&cb(err)
        cb&&cb(null, result)
      })
    }

    context.emitChangesSince = function(timestamp){

      if (rootOptions.timestamps){

        context.matchers.forEach(function(matcher){

          matchDb.createMatchStream(matcher.ref, context, {tail: false}).on('data', function(data){
            if (!data.updated_at || data.updated_at > timestamp){
              context.emit('change', data.value, {
                matcher: matcher, 
                source: self,
                verfiedChange: true,
                time: data.updated_at || Date.now()
              })
            }
          })

          matchDb.createMatchStream(matcher.ref, context, {tail: false, deletedSince: timestamp}).on('data', function(data){
            context.emit('change', data.value, {
              source: self, 
              action: 'remove', 
              verifiedChange: true,
              matcher: matcher,
              time: data.deleted_at || Date.now()
            })
          })
        })
      }
    }

    async.eachSeries(matchers, function(matcher, next){
      streams.push(matchDb.createMatchStream(matcher.ref, context).on('data', function(data){
        var object = data.value
        if (!object){
          var split = data.key.split('~')
          object = deleted.get(split[split.length-1])
        }

        if (object){
          var time = object._deleted ? object.deleted_at : object.updated_at
          context.pushChange(object, {matcher: matcher, source: self, verifiedChange: true, time: time})
        }
              
      }).once('sync', function(){
        next()
      }))

    }, function(err){ if(err)return callback&&callback(err)
      process.nextTick(function(){
        context.on('change', self.applyChange)
        context.emit('sync')
        callback&&callback(null, context)
      })
    })

    return context
  }

  self.getByMatcher = function(matcherRef, params, cb){
    // should replace with QueryContext
    var context = JsonContext({data: params, dataFilters: dataFilters})
    var result = []

    matchDb.createMatchStream(matcherRef, context, {tail: false}).on('data', function(data){
      result.push(data.value)
    }).on('end', function(){
      cb(null, result)
    }).on('error', cb)
  }

  self.forceIndex = matchDb.forceIndex

  return self

}

function padNumber(number, pad) {
  var N = Math.pow(10, pad);
  return number < N ? ("" + (N + number)).slice(1) : "" + number
}

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