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

let overrides = {};
try {
    overrides = require(`./${environment.name}`);
} catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') {
        throw error;
    }
}

const config = merge(baseConfig, overrides);
config.environment = environment;

module.exports = config;
module.exports.REQUIRED_ENV_VARS = REQUIRED_ENV_VARS;
