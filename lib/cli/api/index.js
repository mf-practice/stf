/**
* Copyright © 2019 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

module.exports.command = 'api'

module.exports.describe = 'Start an API unit.'

module.exports.builder = function(yargs) {
  return yargs
    .env('STF_API')
    .strict()
    .option('connect-push', {
      alias: 'c'
    , describe: 'App-side ZeroMQ PULL endpoint to connect to.'
    , array: true
    , demand: true
    })
    .option('connect-sub', {
      alias: 'u'
    , describe: 'App-side ZeroMQ PUB endpoint to connect to.'
    , array: true
    , demand: true
    })
    .option('connect-push-dev', {
      alias: 'pd'
    , describe: 'Device-side ZeroMQ PULL endpoint to connect to.'
    , array: true
    , demand: true
    })
    .option('connect-sub-dev', {
      alias: 'sd'
    , describe: 'Device-side ZeroMQ PUB endpoint to connect to.'
    , array: true
    , demand: true
    })
    .option('port', {
      alias: 'p'
    , describe: 'The port to bind to.'
    , type: 'number'
    , default: process.env.PORT || 7106
    })
    .option('secret', {
      alias: 's'
    , describe: 'The secret to use for auth JSON Web Tokens. Anyone who ' +
        'knows this token can freely enter the system if they want, so keep ' +
        'it safe.'
    , type: 'string'
    , default: process.env.SECRET
    , demand: true
    })
    .option('ssid', {
      alias: 'i'
    , describe: 'The name of the session ID cookie.'
    , type: 'string'
    , default: process.env.SSID || 'ssid'
    })
    .option('storage-url', {
      describe: 'That url is used by api unit for accessing storage.',
      type: 'string',
      default: 'http://127.0.0.1:7100'
    })
    .option('storage-plugin-apk-path', {
      describe: 'That path is used by api unit for accessing apk plugin.',
      type: 'string',
      default: '/s/upload/apk'
    })
    .option('max-apk-size', {
      describe: 'Maximum file size to allow for uploads. Note that nginx ' +
        'may have a separate limit, meaning you should change both.',
      type: 'number',
      default: 1 * 1024 * 1024 * 1024
    })
    .epilog('Each option can be be overwritten with an environment variable ' +
      'by converting the option to uppercase, replacing dashes with ' +
      'underscores and prefixing it with `STF_API_` (e.g. ' +
      '`STF_API_PORT`).')
}

module.exports.handler = function(argv) {
  return require('../../units/api')({
    port: argv.port
  , ssid: argv.ssid
  , secret: argv.secret
  , endpoints: {
      push: argv.connectPush
    , sub: argv.connectSub
    , pushdev: argv.connectPushDev
    , subdev: argv.connectSubDev
    },
    storageUrl: argv.storageUrl,
    storagePluginApkPath: argv.storagePluginApkPath,
    maxApkSize: argv.maxApkSize
  })
}
