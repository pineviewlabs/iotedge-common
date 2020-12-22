const fs = require('fs');
const {ModuleClient} = require('azure-iot-device');
const Config = require('./config.js');
const Logger = require('./logger.js');
const ClientClass = require('./client.js');

const exitHandler = (code) => {
  Logger.info('\nExiting...\n');

  if (!Config.__filename) {
    Logger.warn('Cannot write config file, __filename field not set.');
    process.exit(code);
  }

  fs.writeFile(Config.__filename, Buffer.from(JSON.stringify(Config), 'utf8'), function(err) {
    if (err) {
      Logger.warn(`Error saving config file: ${Config.__filename}'`);
    }

    process.exit(code);
  });
};

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

  static run({Client = ClientClass, callback = function() {}}) {
    const Transport = Application.getTransport();

    ModuleClient.fromEnvironment(Transport, async function(err, client) {
      if (err) {
        Logger.error(`Could not connect${err.code ? ` [${err.code}]` : ''}:\n${err.stack}`);
      } else {
        Logger.info('Client connected');

        // connect to the Edge instance
        client.open(function (err) {
          if (err) {
            Logger.error(`Error initializing IoT Hub module client: ${err.code ? ` [${err.code}]` : ''}:\n${err.stack}`);
          } else {
            Logger.info('IoT Hub module client initialized');
          }
        });

        const instance = new Client(client);

        instance.on('properties:updated', function() {
          Logger.warn('Updated properties; client should be restarted...');
        });

        await instance.init();
        callback(instance);
      }
    });
  }
};
