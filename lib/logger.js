const winston = require('winston');
const Config = require('./config.js');

const level = Config.logLevel || (process.env.NODE_ENV === 'development' ? 'debug' : 'info');
const format = Config.logFormat || 'text';
const logTimestamp = Config.logTimestamp || false;

const {
  combine, colorize, printf, timestamp, align,
} = winston.format;

function consoleTransport() {
  const opts = {
    level,
    format: null,
  };

  const formatArgs = [];
  if (format === 'text') {
    formatArgs.push(align());
  }

  opts.format = combine(
    timestamp(),
    ...formatArgs,
    printf(info => {
      const {timestamp, level, message} = info;

      switch (format) {
        case 'json':{
          const opts = {
            level, message
          };

          if (logTimestamp) {
            opts.timestamp = timestamp;
          }

          return JSON.stringify(opts);
        }


        case 'text':
          if (!logTimestamp) {
            return `${level} | ${message}`;
          }

          return `${timestamp} | ${level} | ${message}`;
      }
    })
  );

  return new winston.transports.Console(opts);
}

module.exports = winston.createLogger({
  level,
  transports: [
    consoleTransport()
  ],
});

