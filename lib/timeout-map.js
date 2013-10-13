module.exports = function TimeoutMap(timeout){
  var items = {}
  var timeouts = {}

  var result = {
    get: function(key){
      return items[key]
    },
    set: function(key, value){
      items[key] = value
      clearTimeout(timeouts[key])
      timeouts[key] = setTimeout(function(){
        timeouts[key] = null
        items[key] = null
      }, timeout)
    }
  }

  return result
}