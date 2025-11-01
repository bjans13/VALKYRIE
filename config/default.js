const environment = require('./environment');

const REQUIRED_ENV_VARS = [
    'DISCORD_TOKEN',
    'ALLOWED_GUILDS',
    'OWNER',
    'TERRARIA_GAME_SERVER_IP',
    'TERRARIA_SSH_USER',
    'TERRARIA_SSH_PRIVATE_KEY_PATH',
    'TERRARIA_PUBLIC_IP',
    'TERRARIA_PORT',
    'TERRARIA_PASS',
    'MINECRAFT_GAME_SERVER_IP',
    'MINECRAFT_SSH_USER',
    'MINECRAFT_SSH_PRIVATE_KEY_PATH',
    'MINECRAFT_PUBLIC_IP',
    'MINECRAFT_PORT',
    'MINECRAFT_PASS',
];

function ensureRequiredEnvVars() {
    return REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
}

function parsePort(value, label) {
    const parsed = Number(value);
    if (Number.isNaN(parsed)) {
        throw new Error(`${label} must be a valid number.`);
    }
    return parsed;
}

function buildLoggingConfig() {
    const level = process.env.LOG_LEVEL || (environment.isProduction ? 'info' : 'debug');
    const directory = process.env.LOG_DIRECTORY || 'logs';

    const consoleConfig = {
        enabled: process.env.LOG_CONSOLE_ENABLED !== 'false',
        level: process.env.LOG_CONSOLE_LEVEL || level,
    };

    const fileEnabled = process.env.LOG_FILE_ENABLED
        ? process.env.LOG_FILE_ENABLED === 'true'
        : environment.isProduction;

    const fileConfig = {
        enabled: fileEnabled,
        filename: process.env.LOG_FILE_NAME || 'valkyrie.log',
        level: process.env.LOG_FILE_LEVEL || level,
    };

    if (process.env.LOG_FILE_MAX_SIZE) {
        const size = Number(process.env.LOG_FILE_MAX_SIZE);
        if (!Number.isNaN(size) && size > 0) {
            fileConfig.maxsize = size;
        }
    }

    if (process.env.LOG_FILE_MAX_FILES) {
        const maxFiles = Number(process.env.LOG_FILE_MAX_FILES);
        if (!Number.isNaN(maxFiles) && maxFiles > 0) {
            fileConfig.maxFiles = maxFiles;
        }
    }

    return {
        level,
        directory,
        console: consoleConfig,
        file: fileConfig,
    };
}

function buildBaseConfig() {
    const missingEnv = ensureRequiredEnvVars();
    if (missingEnv.length > 0) {
        throw new Error(`Missing required environment variables: ${missingEnv.join(', ')}`);
    }

    const allowedGuilds = (process.env.ALLOWED_GUILDS || '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);

    if (allowedGuilds.length === 0) {
        throw new Error('ALLOWED_GUILDS must specify at least one guild ID.');
    }

    for (const guildId of allowedGuilds) {
        if (!/^\d+$/.test(guildId)) {
            throw new Error(`Invalid guild ID in ALLOWED_GUILDS: ${guildId}`);
        }
    }

    const ownerId = (process.env.OWNER || '').trim();
    if (!/^\d+$/.test(ownerId)) {
        throw new Error('OWNER must be set to a numeric Discord user ID.');
    }

    const terrariaPort = parsePort(process.env.TERRARIA_PORT, 'TERRARIA_PORT');
    const minecraftPort = parsePort(process.env.MINECRAFT_PORT, 'MINECRAFT_PORT');

    return {
        discordToken: process.env.DISCORD_TOKEN,
        allowedGuilds,
        ownerId,
        terraria: {
            host: process.env.TERRARIA_GAME_SERVER_IP,
            username: process.env.TERRARIA_SSH_USER,
            privateKeyPath: process.env.TERRARIA_SSH_PRIVATE_KEY_PATH,
            publicIp: process.env.TERRARIA_PUBLIC_IP,
            port: terrariaPort,
            password: process.env.TERRARIA_PASS,
        },
        minecraft: {
            host: process.env.MINECRAFT_GAME_SERVER_IP,
            username: process.env.MINECRAFT_SSH_USER,
            privateKeyPath: process.env.MINECRAFT_SSH_PRIVATE_KEY_PATH,
            publicIp: process.env.MINECRAFT_PUBLIC_IP,
            port: minecraftPort,
            password: process.env.MINECRAFT_PASS,
        },
        logging: buildLoggingConfig(),
    };
}

module.exports = {
    REQUIRED_ENV_VARS,
    buildBaseConfig,
};
