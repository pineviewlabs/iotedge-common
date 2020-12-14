const path = require('path');
const dotenv = require('dotenv');
const fileName = path.join(process.cwd(), './config/app.conf.json');
const Defaults = require(path.join(process.cwd(), './config/defaults.js'));
let AppConf;

const DefaultConfig = Object.assign({
  transport: 'mqtt',
  logTimestamp: false,
  logFormat: 'text',
  logLevel: 'debug'
}, Defaults);

const Parsers = {
  logTimestamp: JSON.parse,
  transport: function(value) {
    const validTransports = ['mqtt', 'amqp', 'http'];

    if (validTransports.includes(value)) {
      return value;
    }

    console.error('Invalid transport: ' + value);
    process.exit(1);
  }
};

dotenv.config();

try {
  AppConf = require(fileName);

  AppConf = Object.keys(AppConf).reduce((prev, key) => {
    const isDefined = process.env[key] !== undefined;
    prev[key] = isDefined ? process.env[key] : AppConf[key]; // eslint-disable-line no-param-reassign

    if (Parsers[key]) {
      prev[key] = Parsers[key](prev[key]); // eslint-disable-line no-param-reassign
    }

    return prev;
  }, DefaultConfig);
} catch (err) {
  AppConf = DefaultConfig;
}

module.exports = Object.assign({
  __filename: fileName,
}, AppConf);

