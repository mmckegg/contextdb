var jsonContext = require('json-context')
var mapReduce = require('map-reduce')

var createChangeFilter = require('json-change-filter')
var checkFilter = createChangeFilter.check

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

  var changeFilter = createChangeFilter()

  changeFilter.on('change', function(object, changeInfo){
    if (changeInfo.action === 'update' || changeInfo.action === 'append'){
      db.put(changeInfo.key, object)
    } else if (changeInfo.action === 'remove'){
      db.del(changeInfo.key)
    }
  })

  contextDB.pushChange = function(object, changeInfo){
    var key = objectBucket(object[options.primaryKey])
    var originalMatcher = matcherLookup[changeInfo.matcherRef]

    var matcher = getMatcherWithParams(originalMatcher, changeInfo.params)

    if (key && matcher){
      db.get(key, function(err, original){
        changeFilter.pushChange(object, {
          original: original,
          matcher: matcher,
          key: key,
          source: changeInfo.source || 'user'
        })
      })
    }
  }


  var matcherLookup = {}
  var matcherParamLookup = {}

  var views = {}

  var objectBucket = function(key){
    return 'objects:' + key
  }

  options.matchers.forEach(function(matcher){
    var paramifiedMatch = paramify(matcher.filter.match)
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

  contextDB.generate = function(params, matcherRefs, callback){
    var matchers = matcherRefs.map(function(ref){ 
      return mergeClone(matcherLookup[ref])
    })
    var context = jsonContext(params, {matchers: matchers})

    async.eachSeries(matchers, function(matcher, done){
      matcher.filter = getReplacedFilters(matcher.filter, context)
      var params = getParamsFrom(matcherParamLookup[matcher.ref], context)
      getAndPushItems(db, matcher, params, context, done)
    }, function(err){ if(err)return callback&&callback(err)
      callback(null, context)
    })
  }

  var listeners = []
  contextDB.listen = function(matcherRef, contextParams, listener){
    var view = views[matcherRef]
    var params = matcherParamLookup[matcherRef]
    if (view && params && listener){
      params = params.map(function(param){
        return contextParams[param.param]
      })
      listener.matcher = getMatcherWithParams(matcherLookup[matcherRef], contextParams)
      var key = getMatcherKeyFromView(view, params)
      listeners[key] = listeners[key] || []
      return listeners[key].push(listener) - 1
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
  return (key.slice(0, 6) === '\xFFmapr~')
}

function getMatcherKey(key){
  var splitPoint = key.lastIndexOf('\0')
  return key.slice(6, splitPoint)
}

function getMatcherWithParams(matcher, params){
  params = params || {}
  return mergeClone(matcher, {filter: getFilterWithParams(matcher.filter, params)})
}

function getFilterWithParams(filter, params){
  var result = {}
  Object.keys(filter).forEach(function(key){
    var value = filter[key]
    if (isParam(value)){
      result[key] = params[value.$param]
    } else {
      if (filter[key] instanceof Object && !Array.isArray(value)){
        result[key] = getFilterWithParams(value, params)
      } else {
        result[key] = value
      }
    }
  })
  return result
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

function getReplacedFilters(filter, context){
  var result = {}
  Object.keys(filter).forEach(function(key){
    var value = filter[key]
    if (isParam(value)){
      result[key] = context.get(value.$param)
    } else {
      result[key] = value
    }
  })
  return result
}

function isParam(object){
  return object instanceof Object && object.$param
}

function getParamsFrom(params, context){
  return params.map(function(param){
    return context.get(param.param)
  })
}

function getAndPushItems(db, matcher, params, context, callback){
  db.map.view({name: matcher.ref, start: params.concat(''), tail: false}).on('data', function(data){
    context.pushChange(data.value, {matcher: matcher, source: 'database'})
  }).on('end', callback)
}

function paramify(match){
  var params = []
  var ensure = {}

  Object.keys(match).sort().forEach(function(key){
    var value = match[key]
    if (isParam(value)){
      params.push({key: key, param: value.$param})
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