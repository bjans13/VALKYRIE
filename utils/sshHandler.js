const { NodeSSH } = require('node-ssh');
const fs = require('fs/promises');

class SSHCommandError extends Error {
    constructor(command, result = {}) {
        const hasNumericCode = typeof result.code === 'number';
        const exitLabel = hasNumericCode ? result.code : (result.signal ? `signal ${result.signal}` : 'unknown');
        super(`SSH command failed (exit ${exitLabel}): ${command}`);
        this.name = 'SSHCommandError';
        this.command = command;
        this.code = result.code;
        this.signal = result.signal;
        this.stdout = result.stdout ?? '';
        this.stderr = result.stderr ?? '';
    }
}

function ensureSSHCommandSuccess(command, result, options = {}) {
    const allowNonZeroExitCode = options.allowNonZeroExitCode === true;
    if (!result) {
        throw new SSHCommandError(command, {});
    }

    const hasNumericCode = typeof result.code === 'number';
    if (allowNonZeroExitCode) {
        return result;
    }

    if ((hasNumericCode && result.code !== 0) || result.signal) {
        throw new SSHCommandError(command, result);
    }

    return result;
}

async function execSSHCommand(client, command, options = {}) {
    const { allowNonZeroExitCode = false, ...execOptions } = options;
    const result = await client.execCommand(command, execOptions);
    return ensureSSHCommandSuccess(command, result, { allowNonZeroExitCode });
}

/**
 * Provides a scoped SSH connection for the supplied task.
 * @param {{ host: string, username: string, privateKeyPath: string }} config
 * @param {(client: import('node-ssh').NodeSSH) => Promise<any>} task
 */
async function withSSHConnection(config, task) {
    const { host, username, privateKeyPath } = config;
    if (!host || !username || !privateKeyPath) {
        throw new Error('Invalid SSH configuration - host, username, and privateKeyPath are required.');
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
 * @param {{ cwd?: string, onStdout?: (chunk: Buffer) => void, onStderr?: (chunk: Buffer) => void, allowNonZeroExitCode?: boolean }} [options]
 */
async function runSSHCommand(config, command, options = {}) {
    return withSSHConnection(config, (client) => execSSHCommand(client, command, options));
}

module.exports = {
    withSSHConnection,
    runSSHCommand,
    execSSHCommand,
    ensureSSHCommandSuccess,
    SSHCommandError,
};
