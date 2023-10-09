const EventEmitter = require('events');
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

  static get Twin_Properties() {
    return {
      Log_Level: 'logLevel',
      Log_Format: 'logFormat',
      Log_Timestamp: {
        configKey: 'logTimestamp',
        parser(value) {
          return JSON.parse(value);
        }
      }
    };
  }

  get defaultOutput() {
    return 'output_messages';
  }

  /**
   * @param {string} name
   * @param {string} value
   * @param {object} opts
   */
  updateTwinProperty(name, value, {reportMissing = true} = {}) {
    const {configKey, parser = function(val) {return val;}} = this.Twin_Properties[name] || {};

    if (!configKey) {
      if (reportMissing) {
        Logger.warn(`Config key "${name}" is not defined.`);
      }

      return;
    }

    if (process.env[configKey]) {
      Logger.debug(`Skipped configKey "${configKey}" because it is defined as an env variable.`);
    } else if (process.env.DISABLE_TWIN_UPDATES && process.env.DISABLE_TWIN_UPDATES === '1') {
      Logger.debug(`Skipped configKey "${configKey}" because twin property updates are disabled.`);
    } else if (value !== '' && value !== 0) {
      try {
        this.Twin_Properties[name].value = parser.call(this, value);

        Logger.debug(`Updated twin property "${name}" with ${value}`);
      } catch (err) {
        Logger.warn(`Error while updating twin property "${name}": ${err.message}`);
      }
    }
  }

  setTwinProperties() {}

  async updateConfig() {
    const props = Object.keys(this.Twin_Properties).reduce((prev, key) => {
      const {configKey, value} = this.Twin_Properties[key];
      if (value !== undefined && configKey && typeof this.config[configKey] != 'undefined') {
        prev[configKey] = value;
      }

      return prev;
    }, {});

    const updated = Object.assign({}, this.config, props);
    const data = await this.config.$update(updated);
    Logger.debug(`Wrote properties to config file:\n${data}`);
  }

  constructor({client, config}) {
    super();

    this.setTwinProperties();
    this.client = client;
    this.config = config;

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
      await this.sendInitialProperties();
    }

    this.setupPropertyUpdateHandler();
    this.setupCommandHandlers();
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
      if (this.Twin_Properties[key].configKey && typeof this.config[this.Twin_Properties[key].configKey] != 'undefined') {
        const value = this.config[this.Twin_Properties[key].configKey];
        prev[key] = {
          value,
          ad: 'completed',
          ac: 200
        };
      }

      return prev;
    }, {
      moduleVersion: packageInfo.version
    });

    Logger.debug(`Sending initial twin properties: ${util.inspect(props)}`);

    return this.updateProperties(props, {initial: true});
  }

  /**
   * Send device twin reported properties
   *
   * @param properties
   * @return {Promise<any>}
   */
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

  setupPropertyUpdateHandler() {
    this.twin.on('properties.desired', (desiredChange) => {
      Logger.debug(`Twin properties.desired: ${util.inspect(desiredChange)}`);
      let updated = false;

      Promise.all(Object.keys(desiredChange).reduce((prev, setting) => {
        if (typeof this.Twin_Properties[setting] != 'undefined') {
          const newValue = desiredChange[setting];

          Logger.info(`Updating property "${setting}" with: "${newValue}"`);

          try {
            this.updateTwinProperty(setting, newValue);
            updated = true;
          } catch (err) {
            Logger.warn(`Failed to update property: ${setting} - ${err.stack}`);
          }

          const patch = {
            [setting]: {
              value: newValue,
              ad: 'completed',
              ac: 200,
              av: desiredChange.$version
            }
          };

          prev.push(this.updateProperties(patch));
        }

        return prev;
      }, []))
        .then(() => {
          if (updated) {
            return this.updateConfig();
          }
        })
        .then(() => {
          Logger.info('Finished updating twin properties.desired.');
          this.emit('properties:updated');
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
