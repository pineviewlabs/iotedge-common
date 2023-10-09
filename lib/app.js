const fs = require('fs');
const util = require('util');
const {ModuleClient} = require('azure-iot-device');
const Config = require('./config.js');
const Logger = require('./logger.js');
const ClientClass = require('./client.js');

const exitHandler = (code) => {
  Logger.info('\nExiting...\n');
  process.exit(code);
};

process.on('exit', function(signal) {
  Logger.debug(`Writing config: ${util.inspect(Config, {depth: 5})}`);

  if (Config.__filename) {
    fs.writeFileSync(Config.__filename, Buffer.from(JSON.stringify(Config, null, 2), 'utf8'));
  } else {
    Logger.warn('Cannot write config file, __filename field not set.');
  }

});

//catches ctrl+c event
process.on('SIGINT', exitHandler);
// catches "kill pid" (for example: nodemon restart)
process.on('SIGUSR1', exitHandler);
process.on('SIGUSR2', exitHandler);

module.exports = class Application {
  static getTransport() {
    switch (Config.transport) {
      case 'mqtt': {
        const {Mqtt} = require('azure-iot-device-mqtt');

        return Mqtt;
      }

      case 'amqp':{
        const {Amqp} = require('azure-iot-device-amqp');

        return Amqp;
      }

      case 'http': {
        const {Http} = require('azure-iot-device-http');

        return Http;
      }
    }
  }

  static run({Client = ClientClass}) {
    const Transport = Application.getTransport();

    let connectFn;

    if (process.env.LOCAL_ENV) {
      console.log('Running in local environment using device connection string.');
      if (!process.env.DEVICE_CONNECTION_STRING) {
        throw new Error('Missing DEVICE_CONNECTION_STRING environment variable.');
      }

      connectFn = function() {
        const connStr = process.env.DEVICE_CONNECTION_STRING;
        const client = ModuleClient.fromConnectionString(connStr, Transport);

        return new Promise((resolve, reject) => {
          client.open(function (err) {
            if (err) {
              reject(err);
            } else {
              resolve(client);
            }
          });
        });
      };
    } else {
      connectFn = function() {
        return new Promise((resolve, reject) => {
          ModuleClient.fromEnvironment(Transport, function(err, client) {
            if (err) {
              reject(err);
            } else {
              client.open(function (err) {
                if (err) {
                  reject(err);
                } else {

                  resolve(client);
                }
              });
            }
          });
        });
      };
    }

    return connectFn().then(async (client) => {
      Logger.info('IoT Hub module client initialized');

      const instance = new Client({client, config: Config});

      instance.on('properties:updated', function() {
        Logger.warn('Updated properties; client should be restarted...');
      });

      await instance.init();

      return instance;
    }).catch(err => {
      Logger.error(`Could not connect${err.code ? ` [${err.code}]` : ''}:\n${err.stack}`);

      throw err;
    });
  }
};
