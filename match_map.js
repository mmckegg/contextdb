var Trigger = require('level-trigger')
var checkFilter = require('json-filter')
var hashObject = require('./hash_object')

var LiveStream = require('level-live-stream')

module.exports = function(db, matchers){
  var self = db.sublevel('match-map')
  var matcher = db.sublevel('matched')

  db.matchMap = self

  // extract params
  var matcherLookup = {}
  var matcherParams = {}
  var matcherHashes = {}

  matchers.forEach(function(matcher){
    matcherLookup[matcher.ref] = matcher
    matcherParams[matcher.ref] = paramify(matcher.match)
    matcherHashes[matcher.ref] = hashObject(matcher.match, 'djb2')
  })

  // map trigger
  var matchTrigger = Trigger(db, 'match', function(id, done){    
    matcher.get('o~' + id, function(err, oldKeys){
      oldKeys = oldKeys || []
      var newKeys = []

      db.get(id, function(err, value){
        var batch = []

        matchers.forEach(function(matcher){
          var paramifiedMatch = matcherParams[matcher.ref]
          if (checkMatch(value, paramifiedMatch.ensure)){
            var paramHash = paramHashForObject(value, paramifiedMatch.params)
            var key = matcherHashes[matcher.ref] + '~' + paramHash + '~'
            if (value._deleted && !value._tombstone){
              key += 'd~' + alphaKey(value.deleted_at || Date.now(), 8) + '~'
            } else {
              key += 'c~'
            }
            key += id
            batch.push({key: key, value: value, type: 'put'})
            newKeys.push(key)
          }
        })

        oldKeys.forEach(function (k) {
          if(!~newKeys.indexOf(k)) batch.push({key: k, type: 'del'})
        })

        batch.push({
          key: 'o~' + id,
          value: newKeys,
          type: 'put',
          prefix: matcher
        })

        self.batch(batch, done)
      })
    })
  })

  // check for reindex
  matcher.get('matcher-hashes', function(err, value){
    var currentHashes = Object.keys(matcherHashes).map(function(key){
      return matcherHashes[key]
    }).sort()
  
    if (!value || value.join('~') !== currentHashes.join('~')){
      process.nextTick(function(){
        self.forceIndex()
        matcher.put('matcher-hashes', currentHashes)
      })
    }
  })

  self.forceIndex = function (){
    matchTrigger.start()
    self.emit('reindex')
    return self
  }

  self.lookupMatcher = function (ref){
    return matcherLookup[ref]
  }

  self.createMatchStream = function(matcherRef, context, opts){
    if (typeof matcherRef !== 'string') throw new Error('must specify matcherRef')
    opts = opts || {}
    opts.start = matcherHashes[matcherRef] + '~'
    if (context) {
      opts.start += paramHashForContext(context, matcherParams[matcherRef].params) + '~'
    }
    if (opts.deletedSince){
      opts.start += 'd~' + alphaKey(opts.deletedSince, 8) + '~'
      opts.end = opts.start + 'd~~'
    } else {
      opts.start += 'c~'
      opts.end = opts.start + '~'
    }
    return LiveStream(self, opts)
  }

  return self
}

function checkMatch(object, ensure){
  return !Object.keys(ensure).length || checkFilter(object, ensure, {match: 'filter'})
}

function paramHashForObject(object, params){
  var objectToHash = Object.keys(params).reduce(function(result, key){
    result[key] = object[key]
    return result
  }, {})
  return hashObject(objectToHash)
}

function paramHashForContext(context, params){
  var objectToHash = Object.keys(params).reduce(function(result, key){
    result[key] = context.get(params[key])
    return result
  }, {})
  return hashObject(objectToHash)
}

function alphaKey(number, pad) {
  var N = Math.pow(36, pad);
  return number < N ? ((N + number).toString(36)).slice(1) : "" + number.toString(36)
}
function parseAlphaKey(string){
  return parseInt(string, 36)
}


function paramify(match){
  var params = {}
  var ensure = {}

  Object.keys(match).forEach(function(key){
    var value = match[key]
    if (isParam(value)){
      params[key] = value.$query
    } else {
      ensure[key] = value
    }
  })

  return {
    params: params,
    ensure: ensure
  }
}


function isParam(object){
  return object instanceof Object && object.$query
}