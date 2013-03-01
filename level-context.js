var jsonContext = require('json-context')
var levelMap = require('level-map')

var checkFilter = require('json-change-filter').check

var TimeoutMap = require('./timeout-map')

var async = require('async')

var EventEmitter = require("events").EventEmitter

module.exports = function(db, options){

  options = options || {}

  var deleted = TimeoutMap(3000)

  var dataFilters = options.dataFilters

  options.primaryKey = options.primaryKey || 'id'
  if (!options.hasOwnProperty('incrementingKey')){
    options.incrementingKey = '_seq'
  }
  if (options.timestamps !== false){
    options.timestamps = true
  }

  levelMap(db)
  db.queue.delay = 100

  var contextDB = new EventEmitter()
  contextDB.db = db

  var matcherLookup = {}
  var matcherParamLookup = {}
  var views = {}

  // incrementing values
  var currentIncementValue = 0
  if (options.incrementingKey){
    db.get('\xFFincrement~' + options.incrementingKey, function(err, val){
      currentIncementValue = parseInt(val, 10) || 0
    })
  }
  function incrementKey(){
    currentIncementValue += 1
    db.put('\xFFincrement~' + options.incrementingKey, currentIncementValue)
    return currentIncementValue
  }

  function getObjectKey(object){
    if (options.incrementingKey){
      var ref = parseInt(object[options.incrementingKey])
      return padNumber(ref, 10) + ':' + object[options.primaryKey]
    } else {
      return padNumber(0, 10) + ':' + object[options.primaryKey]
    }
  }

  options.matchers.forEach(function(matcher){
    var paramifiedMatch = paramify(matcher.match)
    var map = getMapFromMatcher(matcher.ref, paramifiedMatch)
    db.map.add(map)
    matcherParamLookup[matcher.ref] = paramifiedMatch.params
    matcherLookup[matcher.ref] = matcher
    views[matcher.ref] = map
  })


  contextDB.applyChange = function(object, changeInfo){
    changeInfo = changeInfo || {}
    if (changeInfo.source != 'database' && changeInfo.source != 'server'){

      if (options.incrementingKey){
        if (!object[options.incrementingKey]){
          object[options.incrementingKey] = incrementKey()
        }
      }

      if (options.timestamps){
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

      db.put(key, object)
      return object
    }
  }

  contextDB.generate = function(options, callback){

    var params = options.params || {}
    var matcherRefs = options.matcherRefs || []

    try {
      var matchers = matcherRefs.map(function(ref){ 
        if (!matcherLookup[ref]){
          throw new Error('No matcher called ' + ref)
        }
        return matcherLookup[ref]
      })
    } catch (ex){
      return callback(ex)
    }

    var context = jsonContext(params, {matchers: matchers, dataFilters: dataFilters})
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

    context.emitChangesSince = function(timestamp){
      if (options.timestamps){
        context.matchers.forEach(function(matcher){
          if (matcher.collection){

            matcherStream(matcher.ref, context).on('data', function(data){
              if (!data.updated_at || data.updated_at > timestamp){
                context.emit('change', data.value, {
                  matcher: matcher, 
                  source: 'database', 
                  seq: data.updated_at || Date.now()
                })
              }
            }).once('sync', closeThis)

            deletedStream(matcher.ref, context, timestamp).on('data', function(data){
              context.emit('change', data.value, {
                source: 'database', 
                action: 'remove', 
                matcher: matcher,
                seq: data.deleted_at || Date.now()
              })
            }).once('sync', closeThis)

          }
        })
      }
    }

    async.eachSeries(matchers, function(matcher, next){
      streams.push(matcherStream(matcher.ref, context).on('data', function(data){
        var key = data.key[data.key.length-1]
        var object = data.value || deleted.get(key)

        if (object){
          context.pushChange(object, {matcher: matcher, source: 'database'})
        }
        
      }).once('sync', function(){
        next()
      }))

    }, function(err){ if(err)return callback&&callback(err)
      context.on('change', contextDB.applyChange)
      callback(null, context)
    })
  }

  function matcherStream(matcherRef, context, options){
    var params = getParamsFrom(matcherParamLookup[matcherRef], context)
    return db.map.view(mergeClone(options, {name: matcherRef, start: params.concat('')}))
  }

  function deletedStream(matcherRef, context, since, options){
    var params = getParamsFrom(matcherParamLookup[matcherRef], context).concat('DEL')
    var startParams = params.concat(alphaKey(since), '')
    var endParams = params.concat('~', '~')
    return db.map.view(mergeClone(options, {name: matcherRef, start: startParams, end: endParams}))
  }

  return contextDB

}

function isParam(object){
  return object instanceof Object && object.$query
}

function getParamsFrom(params, context){
  return params.map(function(param){
    return context.get(param.query)
  })
}

function paramify(match){
  var params = []
  var ensure = {}

  Object.keys(match).sort().forEach(function(key){
    var value = match[key]
    if (isParam(value)){
      params.push({key: key, query: value.$query})
    } else {
      ensure[key] = value
    }
  })

  return {
    params: params,
    ensure: ensure
  }
}

function getMapFromMatcher(name, paramifiedMatch){
  return {
    name: name,
    map: function(key, value, emit){
      if (Object.keys(paramifiedMatch.ensure).length === 0 || checkFilter(value, paramifiedMatch.ensure, {match: 'filter'})){
        var newKey = paramifiedMatch.params.map(function(param){
          return value[param.key]
        })
        if (value._deleted){
          newKey.push('DEL')
          newKey.push(alphaKey(value.deleted_at || Date.now(), 8))
        }
        emit(newKey, value)
      }
    }
  }
}

function closeThis(){
  this.destroy()
}

function padNumber(number, pad) {
  var N = Math.pow(10, pad);
  return number < N ? ("" + (N + number)).slice(1) : "" + number
}

function alphaKey(number, pad) {
  var N = Math.pow(36, pad);
  return number < N ? ((N + number).toString(36)).slice(1) : "" + number.toString(36)
}
function parseAlphaKey(string){
  return parseInt(string, 36)
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