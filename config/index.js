const fs = require('fs');
const path = require('path');
const environment = require('./environment');
const { buildBaseConfig, REQUIRED_ENV_VARS } = require('./default');

function merge(base, override) {
    if (!override) {
        return base;
    }

    const result = Array.isArray(base) ? [...base] : { ...base };

    for (const [key, value] of Object.entries(override)) {
        if (
            value &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            Object.prototype.hasOwnProperty.call(base, key) &&
            base[key] &&
            typeof base[key] === 'object' &&
            !Array.isArray(base[key])
        ) {
            result[key] = merge(base[key], value);
        } else {
            result[key] = value;
        }
    }

    return result;
}

const baseConfig = buildBaseConfig();

const overrideFilePath = path.resolve(__dirname, `${environment.name}.js`);
const overrides = fs.existsSync(overrideFilePath) ? require(overrideFilePath) : {};

const config = merge(baseConfig, overrides);
config.environment = environment;

module.exports = config;
module.exports.REQUIRED_ENV_VARS = REQUIRED_ENV_VARS;
