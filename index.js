var through = require('through2')
var distance = require('ray-to-lines')
var collision = require('line-to-lines')
var inside = require('point-in-polygon')
var math = require('mathjs')
var from = require('from2')
var now = require('performance-now')
var glob = require('glob')
var protoBuf = require('protocol-buffers')
var fs = require('fs')
var jsonfile = require('jsonfile')
var viz = require('./visualization')

function convertMap (maze) {
  var map = {}
  map['area'] = []
  maze.area.forEach(function (el) {
    var line = []
    for (var i = 0; i < el.x.length; i++) {
      line.push([el.x[i], el.y[i]])
    }
    map['area'].push(line)
  })
  map['borders'] = []
  maze.borders.forEach(function (el) {
    var line = []
    for (var i = 0; i < el.x.length; i++) {
      line.push([el.x[i], el.y[i]])
    }
    map['borders'].push(line)
  })
  map['triggers'] = []
  maze.triggers.forEach(function (el) {
    var line = []
    for (var i = 0; i < el.x.length; i++) {
      line.push([el.x[i], el.y[i]])
    }
    map['triggers'].push(line)
  })
  map['links'] = []
  maze.links.forEach(function (el) {
    map['links'].push([[el.x[0], el.y[0]], [el.x[1], el.y[1]]], [[el.x[2], el.y[2]], [el.x[3], el.y[3]]])
  })
  map['name'] = maze.name
  return map
}

module.exports = function () {
  var map = null
  var nextMap = null
  var maze = null
  var playerStart = [0, .5]
  var trials = {}
  var behavior = {
    positionForward: playerStart[1],
    positionLateral: playerStart[0],
    velocityForward: 0,
    velocityLateral: 0,
    response: false,
    reward: false,
    trial: 0,
    wallLeft: 0,
    wallRight: 0,
    wallForward: 0,
    link: false,
    collision: false,
    advance: false,
    deltaTime: 0,
    time: 0,
    date: Date.now(),
    hit: null
  }
  var trial = {
    maze: null,
    trial: 0,
    init: false,
    link: false,
    advance: false
  }
  var trialStream = from.obj(function () {})

  return {
    createBehaviorStream: function () {
      var angles = [0, 90, 180]
      var wallDistance = [0, 0, 0]
      var hitA = [[[[0, 0], [0, 0]], [[0, 0], [0, 0]]], [[[0, 0], [0, 0]], [[0, 0], [0, 0]]], [[[0, 0], [0, 0]], [[0, 0], [0, 0]]]]
      var curTime = now()
      var prevTime = curTime
      var startTime = null
      var scale = 1

      return through.obj(function (data, enc, callback) {
      if (startTime === null) {
          startTime = now()
        }

        curTime = now()
        behavior.date = Date.now()
        behavior.deltaTime = curTime - prevTime
        behavior.time = curTime - startTime
        prevTime = curTime

        behavior.response = data.response
        behavior.velocityLateral = data.velocityLateral
        behavior.velocityForward = data.velocityForward
        behavior.collision = false
        behavior.link = false

        var link = collision([[behavior.positionLateral, behavior.positionForward], [behavior.positionLateral + behavior.velocityLateral, behavior.positionForward + behavior.velocityForward]], map.links)        
        var delta = [behavior.velocityLateral, behavior.velocityForward]

        if (link.component !== false) {
          if (link.component%2===0) {
            behavior.positionLateral -= (map.links[link.component][0][0] - map.links[link.component+1][0][0])
            behavior.positionForward -= (map.links[link.component][0][1] - map.links[link.component+1][0][1])
            maze = nextMap[0]
            map = convertMap(maze)
            trial.trial++
            behavior.trial = trial.trial
            behavior.link = true
            trial.maze = maze
            trial.link = true
            trial.init = false
            trial.advance = false
            trialStream.push(trial)
          } else {
            // position[0] -= (map.links[link.component][0][0] - map.links[link.component-1][0][0])
            // position[1] -= (map.links[link.component][0][1] - map.links[link.component-1][0][1])
            // trialNumber--
            scale = (link.distance-.1)/math.norm([behavior.velocityLateral, behavior.velocityForward])
            behavior.positionLateral += behavior.velocityLateral*scale
            behavior.positionForward += behavior.velocityForward*scale
            delta[0] = 0
            delta[1] = 0
            behavior.collision = true
          }
        }

        // do collision detection on boundary
        var hit = collision([[behavior.positionLateral, behavior.positionForward], [behavior.positionLateral + delta[0], behavior.positionForward + delta[1]]], map.borders)
        if (hit.id !== false) {
          scale = (hit.distance-.1)/math.norm(delta)
          behavior.positionLateral += delta[0]*scale
          behavior.positionForward += delta[1]*scale
          behavior.collision = true
        } else {
          behavior.positionLateral += delta[0]
          behavior.positionForward += delta[1]
        }


        angles.forEach(function (ang, i) {
          var start = [behavior.positionLateral, behavior.positionForward]
          var hitI = distance(start, ang, map.borders)
          var link = distance(start, ang, map.links)
          wallDistance[i] = 0
          if (hitI.distance > link.distance) {
            wallDistance[i] += link.distance
            hitA[i][0] = [[start[0], start[1]], [link.intersection[0], link.intersection[1]]]
            if (link.component%2===0) {
              start = [link.intersection[0] - (map.links[link.component][0][0] - map.links[link.component+1][0][0]), link.intersection[1] - (map.links[link.component][0][1] - map.links[link.component+1][0][1])]
            } else {
              start = [link.intersection[0] - (map.links[link.component][0][0] - map.links[link.component-1][0][0]), link.intersection[1] - (map.links[link.component][0][1] - map.links[link.component-1][0][1])]
            }
            hitI = distance(start, ang, map.borders)
          } else {
            hitA[i][0] = [[start[0], start[1]], [start[0], start[1]]]
          }
            wallDistance[i] += hitI.distance
            hitA[i][1] = [[start[0], start[1]], [hitI.intersection[0], hitI.intersection[1]]]
        })

        behavior.hit = hitA
        behavior.wallLeft = wallDistance[2]
        behavior.wallRight = wallDistance[0]
        behavior.wallForward = wallDistance[1]

        behavior.reward = false
        map.triggers.forEach(function (poly) {
          if (inside([behavior.positionLateral, behavior.positionForward], poly)) behavior.reward = true
        })

        behavior.advance = trial.advance
        trial.advance = false

        callback(null, behavior)
      })
    },
    setNextTrial: function(key) {
      nextMap = [trials[key]]
    },
    advanceTrial: function() {
      maze = nextMap[0]
      map = convertMap(maze)
      trial.trial++
      trial.maze = maze
      trial.link = false
      trial.init = false
      trial.advance = true
      trialStream.push(trial)
      behavior.positionForward = playerStart[1]
      behavior.positionLateral = playerStart[0]
      behavior.trial = trial.trial
    },
    startTrial: function(key) {
      maze = trials[key]
      map = convertMap(maze)
      nextMap = [maze]
      startTime = null
      trial.trial = 0
      trial.maze = maze
      trial.link = false
      trial.init = true
      trial.advance = false
      trialStream.push(trial)
      behavior.positionForward = playerStart[1]
      behavior.positionLateral = playerStart[0]
      behavior.trial = trial.trial
    },
    getTrials: function () {
      var files = glob.sync(__dirname + '/trials/*.maze', [])
      files.forEach(function (el) {
        obj = jsonfile.readFileSync(el)[0]
        trials[obj.name] = obj
      })
      return Object.keys(trials)
    },
    getEncoders: function () {
      return {
        behavior: protoBuf(fs.readFileSync(__dirname + '/proto/behavior.proto')),
        trial: protoBuf(fs.readFileSync(__dirname + '/proto/trial.proto'))
      }
    },
    trialStream: trialStream,
    visualization: viz
  }
}
