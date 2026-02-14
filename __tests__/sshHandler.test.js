jest.mock('node-ssh', () => {
    const connectMock = jest.fn();
    const execCommandMock = jest.fn();
    const disposeMock = jest.fn();

    const NodeSSHMock = jest.fn().mockImplementation(() => ({
        connect: connectMock,
        execCommand: execCommandMock,
        dispose: disposeMock,
    }));

    return {
        NodeSSH: NodeSSHMock,
        __mocks: {
            connectMock,
            execCommandMock,
            disposeMock,
        },
    };
});

jest.mock('fs/promises', () => ({
    readFile: jest.fn(() => Promise.resolve('fake-private-key')),
}));

const { withSSHConnection, runSSHCommand, SSHCommandError } = require('../utils/sshHandler');
const nodeSshModule = require('node-ssh');
const fsPromises = require('fs/promises');

const validConfig = {
    host: 'example.com',
    username: 'valkyrie',
    privateKeyPath: '/keys/valkyrie',
};

beforeEach(() => {
    jest.clearAllMocks();
    nodeSshModule.__mocks.connectMock.mockResolvedValue();
    nodeSshModule.__mocks.execCommandMock.mockResolvedValue({ stdout: 'ok', stderr: '' });
    nodeSshModule.__mocks.disposeMock.mockReturnValue();
});

describe('withSSHConnection', () => {
    it('throws when required configuration is missing', async () => {
        await expect(
            withSSHConnection({ host: '', username: 'user', privateKeyPath: '/tmp/key' }, async () => undefined),
        ).rejects.toThrow('Invalid SSH configuration');
    });

    it('establishes a connection, executes the task, and disposes the client', async () => {
        const task = jest.fn(async () => 'task-result');

        const result = await withSSHConnection(validConfig, task);

        expect(fsPromises.readFile).toHaveBeenCalledWith(validConfig.privateKeyPath, 'utf8');
        expect(nodeSshModule.__mocks.connectMock).toHaveBeenCalledWith({
            host: validConfig.host,
            username: validConfig.username,
            privateKey: 'fake-private-key',
        });
        expect(task).toHaveBeenCalledTimes(1);
        const taskClient = task.mock.calls[0][0];
        expect(typeof taskClient.execCommand).toBe('function');
        expect(nodeSshModule.__mocks.disposeMock).toHaveBeenCalledTimes(1);
        expect(result).toBe('task-result');
    });

    it('still disposes the client if the task throws', async () => {
        const error = new Error('task failure');
        const task = jest.fn(async () => {
            throw error;
        });

        await expect(withSSHConnection(validConfig, task)).rejects.toThrow(error);
        expect(nodeSshModule.__mocks.disposeMock).toHaveBeenCalledTimes(1);
    });
});

describe('runSSHCommand', () => {
    it('executes a command through the scoped connection', async () => {
        nodeSshModule.__mocks.execCommandMock.mockResolvedValue({ stdout: 'listing', stderr: '' });

        const result = await runSSHCommand(validConfig, 'ls -la', { cwd: '/srv' });

        expect(result).toEqual({ stdout: 'listing', stderr: '' });
        expect(nodeSshModule.__mocks.execCommandMock).toHaveBeenCalledWith('ls -la', { cwd: '/srv' });
        expect(nodeSshModule.__mocks.disposeMock).toHaveBeenCalledTimes(1);
    });

    it('throws an SSHCommandError when the command exits with a non-zero code', async () => {
        nodeSshModule.__mocks.execCommandMock.mockResolvedValue({
            stdout: '',
            stderr: 'permission denied',
            code: 1,
        });

        await expect(runSSHCommand(validConfig, 'sudo systemctl restart minecraft')).rejects.toBeInstanceOf(SSHCommandError);
        expect(nodeSshModule.__mocks.disposeMock).toHaveBeenCalledTimes(1);
    });

    it('allows non-zero exit codes when explicitly requested', async () => {
        nodeSshModule.__mocks.execCommandMock.mockResolvedValue({
            stdout: 'inactive',
            stderr: '',
            code: 3,
        });

        const result = await runSSHCommand(validConfig, 'systemctl is-active minecraft', {
            allowNonZeroExitCode: true,
        });

        expect(result).toEqual({ stdout: 'inactive', stderr: '', code: 3 });
        expect(nodeSshModule.__mocks.execCommandMock).toHaveBeenCalledWith('systemctl is-active minecraft', {});
    });
});
