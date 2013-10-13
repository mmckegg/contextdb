var hook = require('level-post')

var checkFilter = require('json-filter')
var hashObject = require('./hash_object')

var Through = require('through')


module.exports = function(db, matchers){
  var self = db.sublevel('match-map')
  var matcher = db.sublevel('matched')

  db.matchMap = self

  // normalize matchers
  if (!Array.isArray(matchers) && matchers){
    matchers = Object.keys(matchers).map(function(ref){
      var matcher = matchers[ref]
      matcher.ref = ref
      return matcher
    })
  }

  // extract params
  var matcherLookup = {}
  var matcherParams = {}
  var matcherHashes = {}

  matchers.forEach(function(matcher){
    matcherLookup[matcher.ref] = matcher
    matcherParams[matcher.ref] = paramify(matcher.match)
    matcherHashes[matcher.ref] = hashObject(matcher.match, 'djb2')
  })

  self.index = function(changes, cb){


    var batch = []

    forEach(changes, function(change, next){
      matcher.get('o~' + change.key, function(err, oldKeys){

        oldKeys = oldKeys || []
        var newKeys = []

        matchers.forEach(function(matcher){
          var paramifiedMatch = matcherParams[matcher.ref]
          if (checkMatch(change.value, paramifiedMatch.ensure)){
            var paramHash = paramHashForObject(change.value, paramifiedMatch.params)
            var k = matcherHashes[matcher.ref] + '~' + paramHash + '~'
            if (change.value._deleted && !change.value._tombstone){
              k += 'd~' + alphaKey(change.value.deleted_at || Date.now(), 8) + '~'
            } else {
              k += 'c~'
            }
            k += change.key

            batch.push({key: k, value: change.value, type: 'put'})
            newKeys.push(k)
          }
        })

        oldKeys.forEach(function (k) {
          if(!~newKeys.indexOf(k)) batch.push({key: k, type: 'del'})
        })

        batch.push({
          key: 'o~' + change.key,
          value: newKeys,
          type: 'put',
          prefix: matcher
        })

        next()
      })

    }, function(){
      self.batch(batch, cb)
    })

  }

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

  self.forceIndex = function (cb){
    var count = 0

    function checkDone(){
      count -= 1
      if (count == 0){
        self.emit('indexed')
        cb&&cb()
      }
    }

    self.emit('reindex')

    db.createReadStream().on('data', function(data){
      count += 1
      self.index([data], checkDone)
    })

    return self
  }

  self.lookupMatcher = function (ref){
    return matcherLookup[ref]
  }

  self.createMatchStream = function(matcherRef, opts){
    if (typeof matcherRef !== 'string') throw new Error('must specify matcherRef')
    if (!matcherHashes[matcherRef]) throw new Error('cannot find specified matcher')

    opts = opts || {}
    opts.start = matcherHashes[matcherRef] + '~'
    opts.start += paramHashForOptions(opts, matcherParams[matcherRef].params) + '~'
    
    if (opts.deletedSince){
      opts.start += 'd~' + alphaKey(opts.deletedSince, 8) + '~'
      opts.end = opts.start + 'd~~'
    } else {
      opts.start += 'c~'
      opts.end = opts.start + '~'
    }

    if (opts.tail || opts.live){

      var stream = Through(null, function(){
        stream.emit('sync')
      })

      if (!opts.live) {
        self.createReadStream(opts).pipe(stream)
      }

      return stream.on('close', hook(self, opts, function(data){
        stream.queue(data)
      }))

    } else {
      return self.createReadStream(opts)
    }
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

function paramHashForOptions(options, params){
  var objectToHash = Object.keys(params).reduce(function(result, key){
    
    var value = params[key]

    if (options.params && value.$param){

      result[key] = options.params[value.$param]
    } else if (options.queryHandler && value.$query){
      result[key] = options.queryHandler(value.$query)
    }

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
      params[key] = value
    } else {
      ensure[key] = value
    }
  })

  return {
    params: params,
    ensure: ensure
  }
}

function forEach(array, fn, cb){
  var i = -1
  function next(err){
    if (err) return cb&&cb(err)
    i += 1
    if (i<array.length){
      fn(array[i], next, i)
    } else {
      cb&&cb(null)
    }
  }
  next()
}


function isParam(object){
  return object instanceof Object && (object.$query || object.$param)
}