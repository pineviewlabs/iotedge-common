const EventEmitter = require('events');
const Config = require('./config.js');
const Logger = require('./logger.js');

module.exports = class ModuleClient extends EventEmitter {
  static printResultFor(op) {
    return function printResult(err, res) {
      if (err) {
        Logger.error(op + ' error: ' + err.toString());

        return;
      }

      if (res) {
        Logger.info(op + ' status: ' + res.constructor.name);
      }
    };
  }

  get Twin_Properties() {
    return {
    }
  }

  get Properties_Needs_Parsing() {
    return [
    ];
  }

  get defaultOutput() {
    return 'output_messages';
  }

  parsePropertyValue(name, value) {
    return this.Properties_Needs_Parsing.includes(name) ? JSON.parse(value) : value;
  }

  /**
   * @param {string} name
   * @param {string} value
   */
  updateTwinProperty(name, value) {
    const configKey = this.Twin_Properties[name];
    if (!configKey) {
      Logger.error(`Config key "${configKey} is not defined.`);
      return;
    }

    Config[configKey] = this.parsePropertyValue(name, value);
  }

  constructor(client, {packageInfo}) {
    super();

    this.client = client;
    this.packageInfo = packageInfo;

    client.on('message', function (msg) {
      // When using MQTT the following line is a no-op.
      client.complete(msg, ModuleClient.printResultFor('completed'));
    });

    client.on('disconnect', function () {
      Logger.info('IoT Hub module client disconnected');
      //client.removeAllListeners();
    });

    client.on('error', function (err) {
      Logger.error(`Client error: ${err.message}`);
    });
  }

  async init() {
    try {
      this.twin = await this.getTwin();
    } catch (err) {
      Logger.error(`Error getting device twin: ${err.code ? ` [${err.code}]` : ''}:\n${err.stack}`);

      process.exit(1);
    }

    await this.sendInitialProperties();

    this.setupPropertyUpdateHandler();
    this.setupCommandHandlers();
  }

  sendOutputEvent(message, {output = this.defaultOutput} = {}) {
    Logger.info('Sending message: ' + message.getData());

    if (!process.env.DISABLE_MESSAGING || process.env.DISABLE_MESSAGING === '0') {
      //
      this.client.sendOutputEvent(output, message, ModuleClient.printResultFor(`Message: ${message.getData()}`));
    }
  }

  /**
   *
   * @return {Promise<twin>}
   */
  getTwin() {
    return new Promise((resolve, reject) => {
      this.client.getTwin(function (err, twin) {
        if (err) {
          reject(err);
        } else {
          resolve(twin);
        }
      });
    });
  }

  /**
   *
   * @return {Promise<any>}
   */
  sendInitialProperties() {
    const props = Object.keys(this.Twin_Properties).reduce((prev, key) => {
      prev[key] = Config[this.Twin_Properties[key]];

      return prev;
    }, {
      moduleVersion: this.packageInfo.version
    });

    return this.sendDeviceProperties(props, {restart: true});
  }

  /**
   * Send device twin reported properties
   *
   * @param properties
   * @return {Promise<any>}
   */
  sendDeviceProperties(properties) {
    return new Promise((resolve, reject) => {
      this.twin.properties.reported.update(properties, (err) => {
        let statusMsg = 'status: success';

        if (err) {
          statusMsg = `error: ${err.toString()}`;
        }

        Logger.debug(`Sent device properties: ${JSON.stringify(properties)}; ${statusMsg}`);

        resolve();
      });
    });
  }

  setupPropertyUpdateHandler() {
    this.twin.on('properties.desired', (desiredChange) => {
      let propertiesUpdated = false;
      const promises = Object.keys(desiredChange).reduce((prev, setting) => {
        if (this.Twin_Properties[setting]) {
          const newValue = desiredChange[setting];

          Logger.info(`Updating property "${setting}" with: ${newValue}`);

          try {
            this.updateTwinProperty(setting, newValue);
          } catch (err) {
            Logger.warn(`Failed to update property: ${setting} - ${err.stack}`);
          }

          propertiesUpdated = true;
          const patch = {
            [setting]: {
              value: newValue,
              ad: 'completed',
              ac: 200,
              av: desiredChange.$version
            }
          };

          prev.push(this.sendDeviceProperties(patch));
        }

        return prev;
      }, []);

      Promise.all(promises)
        .then(() => {
          Logger.info('Finished sending twin properties.');
          if (propertiesUpdated) {
            //this.emit('properties:updated');
          }
        })
        .catch(err => {
          Logger.error('Error while sending twin properties: ' + err.stack);
        });
    });
  }

  setupCommandHandlers() {
    this.client.onMethod('restart', function(request, response) {
      response.send(200, (err) => {
        if (err) {
          Logger.error('Unable to send restart method response: ' + err.toString());
        } else {
          Logger.warn('\nReceived restart command. Exiting...\n');
          process.exit();
        }
      });
    });
  }
};
