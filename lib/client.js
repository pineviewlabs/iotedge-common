const EventEmitter = require('events');
const Config = require('./config.js');
const Logger = require('./logger.js');
const path = require('path');
const util = require('util');
let packageInfo;

try {
  packageInfo = require(path.join(process.cwd(), './package.json'));
} catch (e) {
  Logger.warn(`package.info could not be loaded from the current folder: ${process.cwd()}`);

  packageInfo = {
    version: 'unknown'
  };
}

module.exports = class Client extends EventEmitter {
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
    if (this.Properties_Needs_Parsing.includes(name)) {
      try {
        return JSON.parse(value);
      } catch (err) {
        Logger.warn(`Error parsing property ${name}="${value}"`);
      }
    }

    return value;
  }

  /**
   * @param {string} name
   * @param {string} value
   * @param {object} opts
   */
  updateTwinProperty(name, value, {reportMissing = true} = {}) {
    const configKey = this.Twin_Properties[name];

    if (!configKey) {
      if (reportMissing) {
        Logger.warn(`Config key "${name}" is not defined.`);
      }

      return;
    }

    if (process.env[configKey]) {
      Logger.debug(`Skipped configKey "${configKey}" because it is defined as an env variable.`);
    } else {
      Config[configKey] = this.parsePropertyValue(name, value);
      Logger.debug(`Updated configKey: "${configKey}" with ${Config[configKey]}`);
    }


  }

  constructor(client) {
    super();

    this.client = client;

    client.on('message', function (msg) {
      // When using MQTT the following line is a no-op.
      client.complete(msg, Client.printResultFor('completed'));
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
      Logger.error(`Error getting module twin: ${err.code ? ` [${err.code}]` : ''}:\n${err.stack}`);

      process.exit(1);
    }

    if (!process.env.IGNORE_TWIN_PROPERTIES) {
      if (this.twin.properties.reported) {
        this.applyTwinProperties();
      } else {
        await this.sendInitialProperties();
      }
    }

    this.setupPropertyUpdateHandler();
    this.setupCommandHandlers();
  }

  applyTwinProperties() {
    Object.keys(this.twin.properties.reported).forEach(property => {
      this.updateTwinProperty(property, this.twin.properties.reported[property], {reportMissing: false});
    });
  }

  sendOutputEvent(message, {output = this.defaultOutput} = {}) {
    Logger.info('Sending message: ' + message.getData());

    if (!process.env.DISABLE_MESSAGING || process.env.DISABLE_MESSAGING === '0') {
      this.client.sendOutputEvent(output, message, Client.printResultFor(`Message: ${message.getData()}`));
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
          Logger.debug(`Module twin: ${util.inspect(twin.properties)}`);
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
      moduleVersion: packageInfo.version
    });

    Logger.debug(`Sending initial twin properties: ${util.inspect(props)}`);
    return this.updateProperties(props, {initial: true});
  }

  updateProperties(properties, {initial = false} = {}) {
    return new Promise((resolve, reject) => {
      this.twin.properties.reported.update(properties, (err) => {
        let statusMsg = 'status: success';

        if (err) {
          statusMsg = `error: ${err.toString()}`;
        }

        Logger.debug(`Sent device properties: ${JSON.stringify(properties)}; ${statusMsg}`);

        resolve(initial);
      });
    });
  }

  /**
   * Send device twin reported properties
   *
   * @param properties
   * @return {Promise<any>}
   */
  sendDeviceProperties(properties) {
    return this.updateProperties(properties);
  }

  setupPropertyUpdateHandler() {
    this.twin.on('properties.desired', (desiredChange) => {
      let propertiesUpdated = false;
      let initialUpdate = false;

      Logger.debug(`Twin properties.desired: ${util.inspect(desiredChange)}`);

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

          prev.push(this.sendDeviceProperties(patch).then(initial => {
            initialUpdate = initial;
          }));
        }

        return prev;
      }, []);

      Promise.all(promises)
        .then(() => {
          Logger.info('Finished sending twin properties.');
          if (propertiesUpdated && !initialUpdate) {
            this.emit('properties:updated');
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
