const { Client, GatewayIntentBits } = require('discord.js');
const net = require('net');
const { setTimeout: delay } = require('timers/promises');
const { withSSHConnection, runSSHCommand } = require('./utils/sshHandler');
require('dotenv').config();

const REQUIRED_ENV_VARS = [
    'DISCORD_TOKEN',
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

const missingEnv = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
if (missingEnv.length > 0) {
    throw new Error(`Missing required environment variables: ${missingEnv.join(', ')}`);
}

const config = {
    discordToken: process.env.DISCORD_TOKEN,
    terraria: {
        host: process.env.TERRARIA_GAME_SERVER_IP,
        username: process.env.TERRARIA_SSH_USER,
        privateKeyPath: process.env.TERRARIA_SSH_KEY_PATH,
        publicIp: process.env.TERRARIA_PUBLIC_IP,
        port: Number(process.env.TERRARIA_PORT),
        password: process.env.TERRARIA_PASS,
    },
    minecraft: {
        host: process.env.MINECRAFT_GAME_SERVER_IP,
        username: process.env.MINECRAFT_SSH_USER,
        privateKeyPath: process.env.MINECRAFT_SSH_KEY_PATH,
        publicIp: process.env.MINECRAFT_PUBLIC_IP,
        port: Number(process.env.MINECRAFT_PORT),
        password: process.env.MINECRAFT_PASS,
    },
};

if (Number.isNaN(config.terraria.port) || Number.isNaN(config.minecraft.port)) {
    throw new Error('TERRARIA_PORT and MINECRAFT_PORT must be valid numbers.');
}

const COMMAND_PREFIX = '!';
const ROLE_PRIORITY = ['Friends', 'Crows', 'Server Mgt'];
const SENSITIVE_COMMANDS = new Set([
    'start terraria',
    'stop terraria',
    'stop terraria warning',
    'restart terraria',
    'start minecraft',
    'stop minecraft',
    'restart minecraft',
    'backup minecraft',
    'update minecraft',
    'restore minecraft',
]);
const COOLDOWN_MS = 30_000;
const cooldowns = new Map();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
    ],
});

client.once('ready', () => {
    console.log(`Bot connected as ${client.user.tag}`);
});

function checkRateLimit(userId, commandKey) {
    if (!SENSITIVE_COMMANDS.has(commandKey)) {
        return false;
    }

    const now = Date.now();
    const userCooldowns = cooldowns.get(userId) || new Map();
    const lastUsed = userCooldowns.get(commandKey) || 0;

    if (now - lastUsed < COOLDOWN_MS) {
        return true;
    }

    userCooldowns.set(commandKey, now);
    cooldowns.set(userId, userCooldowns);
    return false;
}

async function sendDirectMessage(message, content) {
    try {
        await message.author.send(content);
        await message.channel.send('I sent you a DM with the requested information.');
    } catch (error) {
        console.warn(`Failed to DM ${message.author.tag}:`, error.message);
        await message.channel.send(
            'I could not send you a DM. Please make sure your privacy settings allow messages from server members.'
        );
    }
}

async function isServerOnline(host, port, timeout = 5000) {
    return new Promise((resolve) => {
        let settled = false;

        const finish = (result) => {
            if (!settled) {
                settled = true;
                resolve(result);
            }
        };

        const socket = net.createConnection({ host, port });
        socket.setTimeout(timeout);

        socket.once('connect', () => {
            finish(true);
            socket.destroy();
        });

        socket.once('timeout', () => {
            finish(false);
            socket.destroy();
        });

        socket.once('error', () => {
            finish(false);
            socket.destroy();
        });

        socket.once('close', () => {
            finish(false);
        });
    });
}

function getUserRoleLevel(message) {
    if (!message.guild || !message.member || !message.member.roles) {
        return 0;
    }

    for (let i = ROLE_PRIORITY.length - 1; i >= 0; i -= 1) {
        const roleName = ROLE_PRIORITY[i];
        const role = message.guild.roles.cache.find((r) => r.name === roleName);
        if (role && message.member.roles.cache.has(role.id)) {
            return i + 1;
        }
    }

    return 0;
}

function logPrivilegedCommand(message, commandKey) {
    if (!SENSITIVE_COMMANDS.has(commandKey)) {
        return;
    }

    console.log(
        `[${new Date().toISOString()}] ${message.author.tag} (${message.author.id}) executed ${COMMAND_PREFIX}${commandKey}`
    );
}

async function handleHelp(message, roleLevel) {
    if (roleLevel === 0) {
        await message.reply('You do not have the required permissions to use bot commands.');
        return;
    }

    if (roleLevel === 1) {
        await message.channel.send(
            `Hello! Here are the commands you can use:

Terraria:
!status terraria - Checks if the Terraria server is online.

Minecraft:
!status minecraft - Checks if the Minecraft server is online.

Help:
!serverhelp - Shows this help message.
!Phineashelp - Shows this help message.

Please reach out if you need additional permissions.`
        );
        return;
    }

    if (roleLevel === 2) {
        await message.channel.send(
            `Hello! Here are the commands you can use:

Terraria:
!status terraria - Checks if the Terraria server is online.
!player list - Lists the currently connected players.
!announce <message> - Sends an announcement to players currently online in Terraria.
!join terrariaserver - Provides instructions on how to connect to the Terraria server.

Minecraft:
!join minecraftserver - Provides instructions on how to connect to the Minecraft server.
!status minecraft - Checks if the Minecraft server is online.

Help:
!serverhelp - Shows this help message.
!Phineashelp - Shows this help message.`
        );
        return;
    }

    await message.channel.send(
        `Hello! Here are the commands you can use:

Terraria:
!join terrariaserver - Provides connection instructions.
!status terraria - Checks if the Terraria server is online.
!start terraria - Starts the Terraria server.
!stop terraria - Stops the Terraria server.
!restart terraria - Restarts the Terraria server.
!player list - Lists the currently connected players.
!uptime terraria - Shows the server uptime.
!stop terraria warning - Gracefully stops the server with a warning to players.
!announce <message> - Sends an announcement to players currently online.

Minecraft:
!join minecraftserver - Provides connection instructions.
!status minecraft - Checks if the Minecraft server is online.
!start minecraft - Starts the Minecraft server.
!stop minecraft - Stops the Minecraft server.
!restart minecraft - Restarts the Minecraft server.
!backup minecraft - Backs up the Minecraft server.
!update minecraft - Updates the Minecraft server.
!restore minecraft - Restores the Minecraft server from backup.
!set minecraftpatch <patch> - Sets the Bedrock download link.

Help:
!serverhelp - Shows this help message.
!Phineashelp - Shows this help message.`
    );
}

const commandRegistry = new Map();

function registerCommand(trigger, options) {
    commandRegistry.set(trigger.toLowerCase(), options);
}

registerCommand('status terraria', {
    minRole: 1,
    handler: async (message) => {
        await message.channel.send('Checking Terraria server status...');
        const online = await isServerOnline(config.terraria.host, config.terraria.port);
        await message.channel.send(
            online
                ? 'Terraria server is currently online and connectable!'
                : 'Terraria server is currently offline.'
        );
    },
});

registerCommand('player list', {
    minRole: 2,
    handler: async (message) => {
        await message.channel.send('Fetching list of currently connected players...');
        try {
            const stdout = await withSSHConnection(config.terraria, async (client) => {
                await client.execCommand('screen -S terraria -p 0 -X stuff "playing\\n"');
                await delay(5000);
                const result = await client.execCommand('cat 1449/Linux/screenlog.0');
                return result.stdout;
            });

            const playerLines = stdout
                .split('\n')
                .filter((line) => /\w+ \(.*\)/.test(line));
            const players =
                playerLines.length > 0
                    ? playerLines.map((line) => line.split(' ')[0]).join('\n')
                    : 'No players currently connected.';

            await message.channel.send(`Currently connected players:\n${players}`);
        } catch (error) {
            console.error('Failed to fetch player list:', error);
            await message.channel.send('Failed to fetch player list.');
        }
    },
});

registerCommand('announce', {
    minRole: 2,
    handler: async (message, args) => {
        const announcement = args.join(' ').trim();
        if (!announcement) {
            await message.channel.send('Please provide a message to announce. Usage: `!announce <message>`');
            return;
        }

        await message.channel.send(`Announcement to players: ${announcement}`);
        try {
            await withSSHConnection(config.terraria, async (client) => {
                await client.execCommand(`screen -S terraria -p 0 -X stuff "say ${announcement.replace(/"/g, '\\"')}\\n"`);
            });
        } catch (error) {
            console.error('Failed to send announcement:', error);
            await message.channel.send('Failed to send announcement to players.');
        }
    },
});

registerCommand('join terrariaserver', {
    minRole: 2,
    handler: async (message) => {
        await sendDirectMessage(
            message,
            `Hello! Here are the instructions to join the Terraria server:

1. Open Terraria.
2. Click on Multiplayer.
3. Click on Join via IP.
4. Enter the server IP and port when prompted.

Server IP: ${config.terraria.publicIp}
Server Password: ${config.terraria.password}
Server Port: ${config.terraria.port}`
        );
    },
});

registerCommand('status minecraft', {
    minRole: 2,
    handler: async (message) => {
        await message.channel.send('Checking Minecraft server status...');
        try {
            const result = await runSSHCommand(config.minecraft, 'sudo systemctl is-active minecraft');
            await message.channel.send(`Minecraft server status: ${result.stdout.trim() || result.stderr.trim()}`);
        } catch (error) {
            console.error('Failed to check Minecraft server status:', error);
            await message.channel.send('Failed to check Minecraft server status.');
        }
    },
});

registerCommand('join minecraftserver', {
    minRole: 2,
    handler: async (message) => {
        await sendDirectMessage(
            message,
            `To join the Minecraft Bedrock server:
1. Open Minecraft Bedrock Edition.
2. Click "Play" > "Servers" > "Add Server".
3. Enter the server details:
   - Server IP: ${config.minecraft.publicIp}
   - Port: ${config.minecraft.port}
   - Password: ${config.minecraft.password}`
        );
    },
});

registerCommand('start terraria', {
    minRole: 3,
    handler: async (message) => {
        await message.channel.send('Starting Terraria server...');
        try {
            await withSSHConnection(config.terraria, async (client) => {
                await client.execCommand(
                    'screen -L -Logfile screenlog.0 -dmS terraria ./TerrariaServer.bin.x86_64 -config ./serverconfig.txt',
                    { cwd: '1449/Linux' }
                );
            });

            setTimeout(async () => {
                try {
                    const online = await isServerOnline(config.terraria.host, config.terraria.port);
                    await message.channel.send(
                        online
                            ? 'Terraria server is online and connectable!'
                            : 'Failed to verify if Terraria server started.'
                    );
                } catch (verificationError) {
                    console.error('Failed to verify Terraria server status:', verificationError);
                }
            }, 10_000);
        } catch (error) {
            console.error('Failed to start Terraria server:', error);
            await message.channel.send('Failed to start Terraria server.');
        }
    },
});

registerCommand('stop terraria', {
    minRole: 3,
    handler: async (message) => {
        await message.channel.send('Stopping Terraria server...');
        try {
            await withSSHConnection(config.terraria, (client) => client.execCommand('screen -S terraria -X quit'));
            await message.channel.send('Terraria server stopped.');
        } catch (error) {
            console.error('Failed to stop Terraria server:', error);
            await message.channel.send('Failed to stop Terraria server.');
        }
    },
});

registerCommand('stop terraria warning', {
    minRole: 3,
    handler: async (message) => {
        await message.channel.send('Warning: The server will stop in 1 minute. Please save your progress.');
        setTimeout(async () => {
            try {
                await message.channel.send('Stopping Terraria server now...');
                await withSSHConnection(config.terraria, (client) => client.execCommand('screen -S terraria -X quit'));
                await message.channel.send('Terraria server stopped.');
            } catch (error) {
                console.error('Failed to stop Terraria server:', error);
                await message.channel.send('Failed to stop Terraria server.');
            }
        }, 60_000);
    },
});

registerCommand('restart terraria', {
    minRole: 3,
    handler: async (message) => {
        await message.channel.send('Restarting Terraria server...');
        try {
            await withSSHConnection(config.terraria, async (client) => {
                await client.execCommand('screen -S terraria -X quit');
                await client.execCommand(
                    'screen -L -Logfile screenlog.0 -dmS terraria ./TerrariaServer.bin.x86_64 -config ./serverconfig.txt',
                    { cwd: '1449/Linux' }
                );
            });

            setTimeout(async () => {
                try {
                    const online = await isServerOnline(config.terraria.host, config.terraria.port);
                    await message.channel.send(
                        online
                            ? 'Terraria server has been restarted and is online!'
                            : 'Failed to verify if Terraria server restarted.'
                    );
                } catch (verificationError) {
                    console.error('Failed to verify Terraria server restart status:', verificationError);
                }
            }, 10_000);
        } catch (error) {
            console.error('Failed to restart Terraria server:', error);
            await message.channel.send('Failed to restart Terraria server.');
        }
    },
});

registerCommand('uptime terraria', {
    minRole: 3,
    handler: async (message) => {
        await message.channel.send('Fetching server uptime...');
        try {
            const result = await runSSHCommand(
                config.terraria,
                'ps -eo pid,etime,cmd | grep TerrariaServer | grep -v grep'
            );
            const uptime = result.stdout ? result.stdout.split(/\s+/)[1] : 'Unable to determine uptime.';
            await message.channel.send(`Server uptime: ${uptime}`);
        } catch (error) {
            console.error('Failed to fetch server uptime:', error);
            await message.channel.send('Failed to fetch server uptime.');
        }
    },
});

registerCommand('start minecraft', {
    minRole: 3,
    handler: async (message) => {
        await message.channel.send('Starting Minecraft server...');
        try {
            await runSSHCommand(config.minecraft, 'sudo systemctl start minecraft');
            await message.channel.send('Minecraft server started.');
        } catch (error) {
            console.error('Failed to start Minecraft server:', error);
            await message.channel.send('Failed to start Minecraft server.');
        }
    },
});

registerCommand('stop minecraft', {
    minRole: 3,
    handler: async (message) => {
        await message.channel.send('Stopping Minecraft server...');
        try {
            await runSSHCommand(config.minecraft, 'sudo systemctl stop minecraft');
            await message.channel.send('Minecraft server stopped.');
        } catch (error) {
            console.error('Failed to stop Minecraft server:', error);
            await message.channel.send('Failed to stop Minecraft server.');
        }
    },
});

registerCommand('restart minecraft', {
    minRole: 3,
    handler: async (message) => {
        await message.channel.send('Restarting Minecraft server...');
        try {
            await runSSHCommand(config.minecraft, 'sudo systemctl restart minecraft');
            await message.channel.send('Minecraft server restarted.');
        } catch (error) {
            console.error('Failed to restart Minecraft server:', error);
            await message.channel.send('Failed to restart Minecraft server.');
        }
    },
});

registerCommand('backup minecraft', {
    minRole: 3,
    handler: async (message) => {
        await message.channel.send('Running Minecraft server backup...');
        try {
            await runSSHCommand(config.minecraft, 'sudo /minecraft/backup.sh');
            await message.channel.send('Minecraft backup completed.');
        } catch (error) {
            console.error('Failed to backup Minecraft server:', error);
            await message.channel.send('Failed to backup Minecraft server.');
        }
    },
});

registerCommand('update minecraft', {
    minRole: 3,
    handler: async (message) => {
        await message.channel.send('Updating Minecraft server...');
        try {
            await runSSHCommand(config.minecraft, 'sudo /minecraft/update.sh');
            await message.channel.send('Minecraft update completed.');
        } catch (error) {
            console.error('Failed to update Minecraft server:', error);
            await message.channel.send('Failed to update Minecraft server.');
        }
    },
});

registerCommand('restore minecraft', {
    minRole: 3,
    handler: async (message) => {
        await message.channel.send('Restoring Minecraft server worlds, settings, and permissions...');
        try {
            await runSSHCommand(config.minecraft, 'sudo /minecraft/restore.sh');
            await message.channel.send('Minecraft restore completed.');
        } catch (error) {
            console.error('Failed to restore Minecraft server:', error);
            await message.channel.send('Failed to restore Minecraft server.');
        }
    },
});

registerCommand('set minecraftpatch', {
    minRole: 3,
    handler: async (message, args) => {
        const patch = args.join(' ').trim();
        const patchRegex = /^\d+\.\d+\.\d+\.\d+$/;

        if (!patchRegex.test(patch)) {
            await message.channel.send('Invalid patch format. Please use the format `!set minecraftpatch 1.21.113.1`.');
            return;
        }

        const newLink = `https://www.minecraft.net/bedrockdedicatedserver/bin-linux/bedrock-server-${patch}.zip`;
        const command = `echo "${newLink}" | sudo tee /minecraft/bedrock_last_link.txt > /dev/null`;

        await message.channel.send('Updating Minecraft Bedrock download link...');
        try {
            await runSSHCommand(config.minecraft, command);
            await message.channel.send(`Minecraft Bedrock download link updated to version ${patch}.`);
        } catch (error) {
            console.error('Failed to update Minecraft download link:', error);
            await message.channel.send('Failed to update the download link due to insufficient permissions or other errors.');
        }
    },
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const trimmedContent = message.content.trim();
    if (!trimmedContent.startsWith(COMMAND_PREFIX)) {
        return;
    }

    if (!message.guild) {
        await message.reply('Please use commands within the Discord server.');
        return;
    }

    const commandBody = trimmedContent.slice(COMMAND_PREFIX.length).trim();
    if (!commandBody) {
        return;
    }

    const lowerBody = commandBody.toLowerCase();
    const matchingKeys = [...commandRegistry.keys()].filter(
        (key) => lowerBody === key || lowerBody.startsWith(`${key} `)
    );

    let matchedKey = null;
    if (matchingKeys.length > 0) {
        matchedKey = matchingKeys.sort((a, b) => b.length - a.length)[0];
    }

    const roleLevel = getUserRoleLevel(message);

    if (lowerBody === 'serverhelp' || lowerBody === 'phineashelp') {
        await handleHelp(message, roleLevel);
        return;
    }

    const command = matchedKey ? commandRegistry.get(matchedKey) : undefined;

    if (!command) {
        await message.reply('You have either entered an invalid command or you do not have the required permissions to use this command.');
        return;
    }

    if (roleLevel < command.minRole) {
        await message.reply('You do not have the required permissions to use this command.');
        return;
    }

    if (checkRateLimit(message.author.id, matchedKey || lowerBody)) {
        await message.reply('Please wait before using this command again.');
        return;
    }

    try {
        logPrivilegedCommand(message, matchedKey || lowerBody);
        const argString = matchedKey ? commandBody.slice(matchedKey.length).trim() : '';
        const args = argString ? argString.split(/\s+/) : [];
        await command.handler(message, args);
    } catch (error) {
        console.error(`Unexpected error while executing ${COMMAND_PREFIX}${commandBody}:`, error);
        await message.reply('An unexpected error occurred while processing your command.');
    }
});

client.login(config.discordToken);