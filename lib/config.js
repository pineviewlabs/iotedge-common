const path = require('path');
const dotenv = require('dotenv');
const fileName = path.join(process.cwd(), './config/app.conf.json');
const Defaults = require(path.join(process.cwd(), './config/defaults.js'));
let AppConf;

const Parsers = {};
dotenv.config();

try {
  AppConf = require(fileName);
} catch (err) {
  AppConf = Defaults;
}

const CONFIG = Object.keys(AppConf).reduce((prev, key) => {
  const isDefined = process.env[key] !== undefined;
  prev[key] = isDefined ? process.env[key] : AppConf[key]; // eslint-disable-line no-param-reassign

  if (Parsers[key]) {
    prev[key] = Parsers[key](prev[key]); // eslint-disable-line no-param-reassign
  }

  return prev;
}, {});

module.exports = Object.assign({
  __filename: fileName,
}, Defaults, CONFIG);

