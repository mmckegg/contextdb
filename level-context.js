var jsonContext = require('json-context')
var mapReduce = require('map-reduce')

var checkFilter = require('json-change-filter').check

var async = require('async')
var Bucket = require('range-bucket')

var EventEmitter = require("events").EventEmitter

module.exports = function(db, options){

  options = options || {}

  options.primaryKey = options.primaryKey || 'id'

  mapReduce(db)
  db.queue.delay = 100

  var contextDB = new EventEmitter()
  contextDB.db = db

  contextDB.applyChange = function(object, changeInfo){
    changeInfo = changeInfo || {}
    if (changeInfo.source != 'database'){
      var key = objectBucket(object[options.primaryKey])
      if (changeInfo.action === 'remove'){
        db.del(key)
      } else {
        db.put(key, object)
      }
    }
  }

  var matcherLookup = {}
  var matcherParamLookup = {}

  var views = {}

  var objectBucket = function(key){
    return 'objects:' + key
  }

  options.matchers.forEach(function(matcher){
    var paramifiedMatch = paramify(matcher.match)
    var map = getMapFromMatcher(matcher.ref, paramifiedMatch)
    db.mapReduce.add(map)
    matcherParamLookup[matcher.ref] = paramifiedMatch.params
    matcherLookup[matcher.ref] = matcher
    views[matcher.ref] = map
  })

  db.on('batch', function(items){
    items.forEach(function(item){
      if (item.type === 'put' && isMapKey(item.key)){

        //TODO: need to handle permissions: filter.create, .update, .change etc.
        var target = listeners[getMatcherKey(item.key)]
        if (target){
          var mapKey = parseMapKey(item.key)
          target.forEach(function(listener, i){
            listener(item.value, {
              listenerId: i,
              matcher: listener.matcher,
              key: mapKey.key,
              source: 'database'
            })
          })
        }
      }
    })
  })

  contextDB.generate = function(options, callback){

    var params = options.params || {}
    var matcherRefs = options.matcherRefs || []

    var matchers = matcherRefs.map(function(ref){ 
      return matcherLookup[ref]
    })
    var context = jsonContext(params, {matchers: matchers})
    var contextListeners = {}

    context.destroy = function(){
      Object.keys(contextListeners).forEach(function(key){
        contextDB.unlisten(key, contextListeners[key].id)
      })
      contextListeners = null
      context.emit('end')
      context.removeAllListeners()
    }

    async.eachSeries(matchers, function(matcher, done){
      var params = getParamsFrom(matcherParamLookup[matcher.ref], context)
      getAndPushItems(db, matcher, params, context, done)
      contextListeners[matcher.ref] = contextDB.listen(matcher.ref, context, function(object, changeInfo){
        context.pushChange(object, changeInfo)
      })
    }, function(err){ if(err)return callback&&callback(err)
      context.on('change', contextDB.applyChange)
      callback(null, context)
    })
  }

  var listeners = []
  contextDB.listen = function(matcherRef, context, listener){
    var view = views[matcherRef]
    if (view && listener){
      var params = getParamsFrom(matcherParamLookup[matcherRef], context)
      listener.matcher = matcherLookup[matcherRef]
      var key = getMatcherKeyFromView(view, params)
      listeners[key] = listeners[key] || []
      listener.id = listeners[key].push(listener) - 1
      return listener
    }
  }

  contextDB.unlisten = function(matcherRef, id){
    var items = listeners[matcherRef]
    if (items){
      delete items[id]
      return true
    }
  }

  return contextDB

}

function getLastKey(db, bucket){

}

function isMapKey(key){
  return (typeof key == 'string' && key.slice(0, 6) === '\xFFmapr~')
}

function getMatcherKey(key){
  var splitPoint = key.lastIndexOf('\0')
  return key.slice(6, splitPoint)
}

function parseMapKey(key){
  var groups = key.split('\0')
  return {
    view: groups[0].split('~')[1],
    params: groups[1].split('~'),
    key: groups[2]
  }
}

function getMatcherKeyFromView(view, params){
  var key = view.bucket([].concat(params).concat(''))
  return key.slice(6,-1)
}

function isParam(object){
  return object instanceof Object && object.$query
}

function getAndPushItems(db, matcher, params, context, callback){
  db.map.view({name: matcher.ref, start: params.concat(''), tail: false}).on('data', function(data){
    context.pushChange(data.value, {matcher: matcher, source: 'database'})
  }).on('end', callback)
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
        emit(newKey, value)
      }
    }
  }
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