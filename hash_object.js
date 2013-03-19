var crypto = require('crypto')

module.exports = function(object, algo){
  var string = canonicalJSON(object)
  if (algo === 'djb2'){
    return djb2(string).toString(36)
  } else {
    return crypto.createHash(algo || 'sha1').update(string).digest('base64')
  }
}

function djb2(str) {
  var hash = 5381
  for (i = 0; i < str.length; i++) {
    char = str.charCodeAt(i)
    hash = ((hash << 5) + hash) + char
  }
  return hash
}

function canonicalJSON(object){
  if (object == null){
    return 'null'
  }
  
  var object = object.valueOf()
  
  if (object instanceof Array){
    var result = "["
    
    object.forEach(function(value, i){
      if (i > 0) result += ','
      result += canonicalJSON(value)
    })
    
    return result + ']'
  } else if (object instanceof Object){
    var result = "{"
    
    Object.keys(object).sort().forEach(function(key, i){
      var value = object[key]
      if (i > 0) result += ','
      result += JSON.stringify(key) + ':' + canonicalJSON(value)
    })
    
    return result + '}'
  } else {
    return JSON.stringify(object)
  }
}