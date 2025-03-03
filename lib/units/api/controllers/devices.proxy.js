var wireutil = require('../../../wire/util')
var wire = require('../../../wire')
var wirerouter = require('../../../wire/router')
var uuid = require('uuid');
var dbapi = require('../../../db/api')
var datautil = require('../../../util/datautil')
var logger = require('../../../util/logger')
var deviceutil = require('../../../util/deviceutil')
const FormData = require('form-data')
const Busboy = require('busboy');
var Promise = require('bluebird')
const {
  PassThrough
} = require('stream');
const {
  createProxyMiddleware,
  responseInterceptor
} = require('http-proxy-middleware');
const axios = require('axios');

class NoManifestError extends Error {
  constructor(message, options) {
    super(message, options);
  }
}


class DeviceIsNotResponding extends Error {
  constructor(message, options) {
    super(message, options);
  }
}

class NotOwnedDevice extends Error {
  constructor(message, options) {
    super(message, options);
  }
}

/*
 * Proxy had an error Error: write EPIPE
 * Эта плавающая ошибка возникает когда temp.js прерывает загрузку файла из-за превыщения максимального размера.
 * Почти наверняка она происходит из-за того, что прокси не успевает остановить передачу файлов и шлёт их в
 * уже закрытый сокет, что и приводит к этой ошибке.
 * Когда эта ошибка происходит, клиент получает зависшее соединение. Из хорошего - такое получит
 * только клиент, который обманул и его заголовок content-length был короче реального загружаемого файла.
 * Но эта ситуация всё ещё будет приводить к ошибке в консоли.
 * Чтобы решить есть несколько предполагаемых вариантов:
 * 1. Самый правильный, переписать прокси в этом файле с http-proxy-middleware на сырую работу с node.js сокетами,
 * тогда контролировать размер файла можно будет здесь, а значит ошибка подобная той что по ссылке ниже будет только у плохого
 * клиенте, а не в консоли сервиса - https://stackoverflow.com/a/18370751/201952
 * 2. Можно как-то попробовать в начале отправлять статус код 413 внутри  temp.js, подождать пока прокси отреагирует,
 * остановит поток данных и только после этого закрывать сокет. Вариант костыльный, но возможно быстрее первого.
 */
var log = logger.createLogger('api.devices.proxy')

  function createFileSizeValidationMiddleware(options) {
    return (req, res, next) => {
      let contentLength = req.headers['content-length']
      if (contentLength === undefined) {
        res.status(400).json({
          success: false,
          description: 'Invalid content-length header'
        })
        return
      }

      let bytesExpected = parseInt(contentLength)
      if(bytesExpected === NaN) {
        res.status(400).json({
          success: false,
          description: 'Invalid content-length header'
        })
        return
      }

      if(bytesExpected > 50000){
        res.status(413).json({
          success: false,
          description: 'File is too big'
        })
        return
      }
      next()
    }
  }

function createProxy(options) {
  let proxy = createProxyMiddleware({
    target: options.storageUrl,
    prependPath: false,
    changeOrigin: true,
    selfHandleResponse: true,
    pathRewrite: {
      '^/': options.storagePluginApkPath
    },
    on: {
      /*
       * Не использовать error колбек, так как его использование может привести к тому,
       * что http-middleware-proxy будет пытаться отправить данные уже после того,
       * как загрузка была отменена из-за превышения размера файла, что приведёт к критической ошибке.
       */
      proxyRes: responseInterceptor(async (responseBuffer, proxyRes, req, res) => {
        let downloadHref;
        let manifest;
        return await new Promise(function (resolve, reject) {
            const response = responseBuffer.toString('utf8');

            let parsedResponse = JSON.parse(response)
            if (!parsedResponse.success) {
              reject(parsedResponse)
              return
            }

            // Доступ через values, чтобы не зависеть от key из form-data
            downloadHref = Object.values(parsedResponse.resources)[0].href
            resolve(downloadHref)
          })
          .then(downloadHref => {
            return axios.get(options.storageUrl + downloadHref + '/manifest', {
              headers: {
                'cookie': req.headers['cookie'],
                'x-csrf-token': req.headers['x-csrf-token'],
                'User-Agent': req.headers['User-Agent']
              },
              timeout: 5000
            })
          })
          .then(response => {
            manifest = response.data.manifest
            if (manifest == '')
              throw new NoManifestError()

            return dbapi.loadDevice(req.user.groups.subscribed, req.params.serial)
          })
          .then(cursor => cursor.next())
          .then(device => {
            datautil.normalize(device, req.user)
            if (!deviceutil.isOwnedByUser(device, req.user))
              throw new NotOwnedDevice()

            let responseChannel = 'tx.' + uuid.v4();
            var resolver = Promise.defer()
            var messageListener = wirerouter()
              .on(wire.TransactionDoneMessage, function (channel, message) {
                if (message.success)
                  resolver.resolve(message)
                else
                  resolver.reject(new DeviceIsNotResponding())
              })
              .handler()

            var responseTimer = setTimeout(function () {
              resolver.reject(new DeviceIsNotResponding())
            }, 5000)

            req.options.channelRouter.on(responseChannel, messageListener)
            req.options.sub.subscribe(responseChannel)
            req.options.push.send([
              device.channel, wireutil.transaction(responseChannel, new wire.InstallMessage(downloadHref, true, JSON.stringify(manifest)))
            ])

            return resolver.promise.then(result => {
                clearTimeout(responseTimer)
                return result.data;
              })
              .finally(() => {
                req.options.sub.unsubscribe(responseChannel)
                req.options.channelRouter.removeListener(responseChannel, messageListener)
              })
          })
          .then(result => {
            proxyRes.statusCode = 200
            return JSON.stringify({
              success: true,
              description: 'APK installed successfully'
            })
          })
          .catch(NoManifestError, err => {
            proxyRes.statusCode = 400
            return JSON.stringify({
              success: false,
              description: 'Unable to retrieve manifest'
            })
          })
          .catch(DeviceIsNotResponding, err => {
            proxyRes.statusCode = 400
            return JSON.stringify({
              success: false,
              description: 'Device is not responding'
            })
          })
          .catch(NotOwnedDevice, err => {
            proxyRes.statusCode = 403
            return JSON.stringify({
              success: false,
              description: 'You cannot install on this device. Not owned by you'
            })

          })
          .catch(err => {
            if (proxyRes.statusCode != 200 && err.description !== undefined)
              return JSON.stringify({
                success: false,
                description: err.description
              })

            proxyRes.statusCode = 500
            log.error('Error installing apk', err.stack)
            return JSON.stringify({
              success: false,
              description: 'ServerError'
            })
          })
      })
    },
  });

  return proxy
}

module.exports = {
  createInstallApkProxy: createProxy,
  createFileSizeValdiationMiddleware: createFileSizeValidationMiddleware
}
