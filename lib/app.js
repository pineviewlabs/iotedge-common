const fs = require('fs');
const util = require('util');
const { ModuleClient } = require('azure-iot-device');
const ProvisioningDeviceClient = require('azure-iot-provisioning-device').ProvisioningDeviceClient;
const SymmetricKeySecurityClient = require('azure-iot-security-symmetric-key').SymmetricKeySecurityClient;
const ProvisioningTransport = require('azure-iot-provisioning-device-mqtt').Mqtt;

const Config = require('./config.js');
const Logger = require('./logger.js');
const ClientClass = require('./client.js');
const {
  DEVICE_CONNECTION_STRING,
  LOCAL_ENV,
  IOT_CENTRAL_SYMMETRIC_KEY,
  IOT_CENTRAL_ID_SCOPE,
  IOT_CENTRAL_REGISTRATION_ID
} = process.env;

const ProvisioningHost = 'global.azure-devices-provisioning.net';

const exitHandler = (code) => {
  code = code || 0;
  Logger.info('\nExiting...\n', code);
  process.exit(0);
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

const provisionIoTCentralDevice = () => {
  const provisioningSecurityClient = new SymmetricKeySecurityClient(IOT_CENTRAL_REGISTRATION_ID, IOT_CENTRAL_SYMMETRIC_KEY);
  const provisioningClient = ProvisioningDeviceClient.create(ProvisioningHost, IOT_CENTRAL_ID_SCOPE, new ProvisioningTransport(), provisioningSecurityClient);
  provisioningClient.setProvisioningPayload({a: 'b'});

  return new Promise((resolve, reject) => {
    provisioningClient.register((err, result) => {
      if (err) {
        console.error('Error registering device:', err);
        reject(err);
        return;
      }

      console.log('Registration on IoT Central succeeded', result);

      resolve('HostName=' + result.assignedHub + ';DeviceId=' + IOT_CENTRAL_REGISTRATION_ID + ';SharedAccessKey=' + IOT_CENTRAL_SYMMETRIC_KEY);
    });
  });
};

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

  static async run({Client = ClientClass}) {
    const Transport = Application.getTransport();

    let connectFn;

    if (LOCAL_ENV) {
      console.log('Running in local environment using device connection string.');
      let connStr;

      if (IOT_CENTRAL_REGISTRATION_ID && IOT_CENTRAL_SYMMETRIC_KEY && IOT_CENTRAL_ID_SCOPE) {
        console.log('Using IoT Central connection...');

        connStr = await provisionIoTCentralDevice();
      } else {
        if (!DEVICE_CONNECTION_STRING) {
          throw new Error('Missing DEVICE_CONNECTION_STRING environment variable.');
        }
        connStr = DEVICE_CONNECTION_STRING;
      }

      connectFn = function() {
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
