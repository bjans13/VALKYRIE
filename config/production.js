module.exports = {
    logging: {
        level: 'info',
        console: {
            level: 'info',
        },
        file: {
            enabled: true,
            filename: 'valkyrie.log',
            level: 'info',
            maxsize: 10 * 1024 * 1024,
            maxFiles: 5,
        },
    },
};
