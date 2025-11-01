const fs = require('fs');
const path = require('path');
const { createLogger, format, transports } = require('winston');
const config = require('../config');

const { combine, timestamp, errors, splat, json, colorize, printf } = format;

const baseFormats = [timestamp(), errors({ stack: true }), splat()];

const consoleFormat = config.environment.isDevelopment
    ? combine(
        ...baseFormats,
        colorize(),
        printf(({ level, message, timestamp: time, ...meta }) => {
            const metaData = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
            return `[${time}] ${level}: ${message}${metaData}`;
        })
    )
    : combine(...baseFormats, json());

const jsonFormat = combine(...baseFormats, json());

const loggerTransports = [];

if (config.logging?.console?.enabled !== false) {
    loggerTransports.push(
        new transports.Console({
            level: config.logging.console.level || config.logging.level || 'info',
            format: consoleFormat,
        })
    );
}

if (config.logging?.file?.enabled) {
    const logDirectory = path.resolve(process.cwd(), config.logging.directory || 'logs');
    fs.mkdirSync(logDirectory, { recursive: true });

    loggerTransports.push(
        new transports.File({
            level: config.logging.file.level || config.logging.level || 'info',
            filename: path.join(logDirectory, config.logging.file.filename || 'valkyrie.log'),
            maxsize: config.logging.file.maxsize,
            maxFiles: config.logging.file.maxFiles,
            format: jsonFormat,
        })
    );
}

const logger = createLogger({
    level: config.logging?.level || 'info',
    format: jsonFormat,
    defaultMeta: { service: 'valkyrie-bot', environment: config.environment.name },
    transports: loggerTransports,
});

module.exports = logger;
