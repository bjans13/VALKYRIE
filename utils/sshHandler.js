const { NodeSSH } = require('node-ssh');
const fs = require('fs/promises');

/**
 * Provides a scoped SSH connection for the supplied task.
 * @param {{ host: string, username: string, privateKeyPath: string }} config
 * @param {(client: import('node-ssh').NodeSSH) => Promise<any>} task
 */
async function withSSHConnection(config, task) {
    const { host, username, privateKeyPath } = config;
    if (!host || !username || !privateKeyPath) {
        throw new Error('Invalid SSH configuration – host, username, and privateKeyPath are required.');
    }

    const client = new NodeSSH();
    const privateKey = await fs.readFile(privateKeyPath, 'utf8');

    try {
        await client.connect({ host, username, privateKey });
        return await task(client);
    } finally {
        client.dispose();
    }
}

/**
 * Executes a single command with its own SSH connection.
 * @param {{ host: string, username: string, privateKeyPath: string }} config
 * @param {string} command
 * @param {{ cwd?: string }} [options]
 */
async function runSSHCommand(config, command, options = {}) {
    return withSSHConnection(config, (client) => client.execCommand(command, options));
}

module.exports = {
    withSSHConnection,
    runSSHCommand,
};
