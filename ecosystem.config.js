module.exports = {
    apps: [{
        name: 'valkyrie',
        script: 'bot.js',
        watch: false,
        env: {
            NODE_ENV: 'development',
        },
        env_production: {
            NODE_ENV: 'production',
        },
        max_memory_restart: '1G',
        error_file: 'logs/err.log',
        out_file: 'logs/out.log',
        time: true,
        instances: 1,
        autorestart: true,
        max_restarts: 10,
        restart_delay: 4000,
    }],
};
