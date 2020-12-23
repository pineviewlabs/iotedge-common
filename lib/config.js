const path = require('path');
const dotenv = require('dotenv');
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

module.exports = Object.assign({
  __filename: fileName,
}, AppConf);

