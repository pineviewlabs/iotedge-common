const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');
const lodashMerge = require('lodash.merge');
const fileName = path.join(process.cwd(), './config/app.conf.json');
const Defaults = require(path.join(process.cwd(), './lib/config/defaults.js'));

let CustomParsers;
let AppConf;

try {
  CustomParsers = require(path.join(process.cwd(), './lib/config/parsers.js'));
} catch (err) {
  CustomParsers = {};
}

const DefaultConfig = Object.assign({
  transport: 'mqtt',
  logTimestamp: false,
  logFormat: 'text',
  logLevel: 'debug'
}, Defaults);

const Parsers = Object.assign({
  logTimestamp: JSON.parse,
  transport: function(value) {
    const validTransports = ['mqtt', 'amqp', 'http'];

    if (validTransports.includes(value)) {
      return value;
    }

    console.error('Invalid transport: ' + value);
    process.exit(1);
  }
}, CustomParsers);

dotenv.config();

try {
  let Contents = require(fileName);
  AppConf = lodashMerge({}, DefaultConfig, Contents);
} catch (err) {
  AppConf = DefaultConfig;
}

AppConf = Object.keys(AppConf).reduce((prev, key) => {
  const isDefined = process.env[key] !== undefined;
  prev[key] = isDefined ? process.env[key] : AppConf[key]; // eslint-disable-line no-param-reassign

  if (Parsers[key]) {
    try {
      prev[key] = Parsers[key](prev[key]); // eslint-disable-line no-param-reassign
    } catch (err) {
      console.warn(`Error while parsing ${key}`, err);
    }
  }

  return prev;
}, {});

const Config = module.exports = Object.assign({
  __filename: fileName,

  $update(prop, value) {
    if (prop && typeof prop == 'object') {
      Object.keys(prop).forEach(key => {
        Config[key] = prop[key];
      });
    } else {
      Config[prop] = value;
    }

    return new Promise(function(resolve) {
      const data = Buffer.from(JSON.stringify(Config, null, 2), 'utf8');
      fs.writeFile(fileName, data, function(err) {
        if (err) {
          console.warn('Error while trying to write config file:', fileName, err)
        }

        resolve(data.toString('utf8'));
      });
    });
  }
}, AppConf);

