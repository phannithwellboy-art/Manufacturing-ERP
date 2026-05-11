// src/utils/logger.js
// Structured logging with Winston — console in dev, rotating files in prod

const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

const { combine, timestamp, errors, json, colorize, printf } = winston.format;

const isProd = process.env.NODE_ENV === 'production';

// Pretty format for development console
const devFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `${timestamp} [${level}] ${stack || message}${metaStr}`;
});

const transports = [];

// Console transport
transports.push(new winston.transports.Console({
  format: isProd
    ? combine(timestamp(), errors({ stack: true }), json())
    : combine(colorize(), timestamp({ format: 'HH:mm:ss' }), errors({ stack: true }), devFormat),
}));

// Rotating file transports (production only)
if (isProd) {
  transports.push(new DailyRotateFile({
    filename:      path.join('logs', 'error-%DATE%.log'),
    datePattern:   'YYYY-MM-DD',
    level:         'error',
    maxSize:       '20m',
    maxFiles:      '14d',
    zippedArchive: true,
    format:        combine(timestamp(), errors({ stack: true }), json()),
  }));

  transports.push(new DailyRotateFile({
    filename:      path.join('logs', 'combined-%DATE%.log'),
    datePattern:   'YYYY-MM-DD',
    maxSize:       '20m',
    maxFiles:      '7d',
    zippedArchive: true,
    format:        combine(timestamp(), errors({ stack: true }), json()),
  }));
}

const logger = winston.createLogger({
  level:      process.env.LOG_LEVEL || (isProd ? 'info' : 'debug'),
  transports,
  exitOnError: false,
});

// Stream for Morgan HTTP logger
logger.stream = {
  write: (message) => logger.http(message.trim()),
};

module.exports = logger;
