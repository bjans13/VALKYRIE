const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    ApplicationCommandOptionType,
    ApplicationCommandPermissionType,
    ApplicationCommandType,
} = require('discord.js');
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
        privateKeyPath: process.env.TERRARIA_SSH_PRIVATE_KEY_PATH,
        publicIp: process.env.TERRARIA_PUBLIC_IP,
        port: Number(process.env.TERRARIA_PORT),
        password: process.env.TERRARIA_PASS,
    },
    minecraft: {
        host: process.env.MINECRAFT_GAME_SERVER_IP,
        username: process.env.MINECRAFT_SSH_USER,
        privateKeyPath: process.env.MINECRAFT_SSH_PRIVATE_KEY_PATH,
        publicIp: process.env.MINECRAFT_PUBLIC_IP,
        port: Number(process.env.MINECRAFT_PORT),
        password: process.env.MINECRAFT_PASS,
    },
};

if (Number.isNaN(config.terraria.port) || Number.isNaN(config.minecraft.port)) {
    throw new Error('TERRARIA_PORT and MINECRAFT_PORT must be valid numbers.');
}

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

client.once('ready', async () => {
    console.log(`Bot connected as ${client.user.tag}`);
    try {
        await registerSlashCommands(client);
    } catch (error) {
        console.error('Failed to register slash commands via REST:', error);
    }
});

function checkRateLimit(userId, commandKey) {
    if (!commandKey || !SENSITIVE_COMMANDS.has(commandKey)) {
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

async function respond(interaction, content, options = {}) {
    if (typeof content === 'object' && content !== null) {
        if (interaction.deferred || interaction.replied) {
            return interaction.followUp(content);
        }
        return interaction.reply(content);
    }

    const payload = { content, ...options };
    if (interaction.deferred || interaction.replied) {
        return interaction.followUp(payload);
    }
    return interaction.reply(payload);
}

async function sendDirectMessageWithNotice(interaction, content) {
    try {
        await interaction.user.send(content);
        await respond(interaction, 'I sent you a DM with the requested information.', { ephemeral: true });
    } catch (error) {
        console.warn(`Failed to DM ${interaction.user.tag}:`, error.message);
        await respond(
            interaction,
            'I could not send you a DM. Please make sure your privacy settings allow messages from server members.',
            { ephemeral: true }
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

function getMemberRoleLevel(member) {
    if (!member || !member.roles) {
        return 0;
    }

    const roleCache = member.roles.cache ?? new Map();

    for (let i = ROLE_PRIORITY.length - 1; i >= 0; i -= 1) {
        const roleName = ROLE_PRIORITY[i];
        const role = roleCache.find((r) => r.name === roleName);
        if (role) {
            return i + 1;
        }
    }

    return 0;
}

function logPrivilegedCommand(interaction, commandKey) {
    if (!commandKey || !SENSITIVE_COMMANDS.has(commandKey)) {
        return;
    }

    console.log(
        `[${new Date().toISOString()}] ${interaction.user.tag} (${interaction.user.id}) executed /${interaction.commandName}`
    );
}

function getAllowedRoleNames(minRole) {
    if (minRole <= 0) {
        return [];
    }

    return ROLE_PRIORITY.slice(minRole - 1);
}

function getCommandKey(name, type = ApplicationCommandType.ChatInput) {
    return `${type}:${name}`;
}

const commandDefinitions = [];
const commandRegistry = new Map();

function registerCommand(definition) {
    const normalized = {
        ...definition,
        type: definition.type ?? ApplicationCommandType.ChatInput,
        options: definition.options ?? [],
        minRole: definition.minRole ?? 0,
        usage: definition.usage ?? definition.name,
        category: definition.category ?? 'General',
    };

    const key = getCommandKey(normalized.name, normalized.type);
    commandDefinitions.push(normalized);
    commandRegistry.set(key, normalized);
}

registerCommand({
    name: 'status_terraria',
    usage: 'status_terraria',
    legacyKey: 'status terraria',
    description: 'Check if the Terraria server is online and connectable.',
    category: 'Terraria',
    minRole: 1,
    handler: async (interaction) => {
        await respond(interaction, 'Checking Terraria server status...');
        const online = await isServerOnline(config.terraria.host, config.terraria.port);
        await respond(
            interaction,
            online
                ? 'Terraria server is currently online and connectable!'
                : 'Terraria server is currently offline.'
        );
    },
});

registerCommand({
    name: 'player_list',
    usage: 'player_list',
    legacyKey: 'player list',
    description: 'List the currently connected Terraria players.',
    category: 'Terraria',
    minRole: 2,
    handler: async (interaction) => {
        await respond(interaction, 'Fetching list of currently connected players...');
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

            await respond(interaction, `Currently connected players:\n${players}`);
        } catch (error) {
            console.error('Failed to fetch player list:', error);
            await respond(interaction, 'Failed to fetch player list.');
        }
    },
});

registerCommand({
    name: 'announce',
    usage: 'announce <message>',
    legacyKey: 'announce',
    description: 'Send an announcement to players currently online in Terraria.',
    category: 'Terraria',
    minRole: 2,
    options: [
        {
            name: 'message',
            description: 'The announcement to send to online Terraria players.',
            type: ApplicationCommandOptionType.String,
            required: true,
        },
    ],
    handler: async (interaction) => {
        const announcement = interaction.options.getString('message', true).trim();

        await respond(interaction, 'Sending announcement to players...');
        try {
            await withSSHConnection(config.terraria, async (client) => {
                await client.execCommand(
                    `screen -S terraria -p 0 -X stuff "say ${announcement.replace(/"/g, '\\"')}\\n"`
                );
            });
            await respond(interaction, `Announcement delivered: ${announcement}`);
        } catch (error) {
            console.error('Failed to send announcement:', error);
            await respond(interaction, 'Failed to send announcement to players.');
        }
    },
});

registerCommand({
    name: 'join_terraria',
    usage: 'join_terraria',
    legacyKey: 'join terrariaserver',
    description: 'Receive instructions on how to join the Terraria server via DM.',
    category: 'Terraria',
    minRole: 2,
    handler: async (interaction) => {
        await sendDirectMessageWithNotice(
            interaction,
            `Hello! Here are the instructions to join the Terraria server:\n\n1. Open Terraria.\n2. Click on Multiplayer.\n3. Click on Join via IP.\n4. Enter the server IP and port when prompted.\n\nServer IP: ${config.terraria.publicIp}\nServer Password: ${config.terraria.password}\nServer Port: ${config.terraria.port}`
        );
    },
});

registerCommand({
    name: 'status_minecraft',
    usage: 'status_minecraft',
    legacyKey: 'status minecraft',
    description: 'Check if the Minecraft server is online.',
    category: 'Minecraft',
    minRole: 2,
    handler: async (interaction) => {
        await respond(interaction, 'Checking Minecraft server status...');
        try {
            const result = await runSSHCommand(config.minecraft, 'sudo systemctl is-active minecraft');
            const status = result.stdout.trim() || result.stderr.trim();
            await respond(interaction, `Minecraft server status: ${status}`);
        } catch (error) {
            console.error('Failed to check Minecraft server status:', error);
            await respond(interaction, 'Failed to check Minecraft server status.');
        }
    },
});

registerCommand({
    name: 'join_minecraft',
    usage: 'join_minecraft',
    legacyKey: 'join minecraftserver',
    description: 'Receive instructions on how to join the Minecraft server via DM.',
    category: 'Minecraft',
    minRole: 2,
    handler: async (interaction) => {
        await sendDirectMessageWithNotice(
            interaction,
            `To join the Minecraft Bedrock server:\n1. Open Minecraft Bedrock Edition.\n2. Click "Play" > "Servers" > "Add Server".\n3. Enter the server details:\n   - Server IP: ${config.minecraft.publicIp}\n   - Port: ${config.minecraft.port}\n   - Password: ${config.minecraft.password}`
        );
    },
});

registerCommand({
    name: 'start_terraria',
    usage: 'start_terraria',
    legacyKey: 'start terraria',
    description: 'Start the Terraria server.',
    category: 'Terraria',
    minRole: 3,
    handler: async (interaction) => {
        await respond(interaction, 'Starting Terraria server...');
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
                    await respond(
                        interaction,
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
            await respond(interaction, 'Failed to start Terraria server.');
        }
    },
});

registerCommand({
    name: 'stop_terraria',
    usage: 'stop_terraria',
    legacyKey: 'stop terraria',
    description: 'Stop the Terraria server immediately.',
    category: 'Terraria',
    minRole: 3,
    handler: async (interaction) => {
        await respond(interaction, 'Stopping Terraria server...');
        try {
            await withSSHConnection(config.terraria, (client) => client.execCommand('screen -S terraria -X quit'));
            await respond(interaction, 'Terraria server stopped.');
        } catch (error) {
            console.error('Failed to stop Terraria server:', error);
            await respond(interaction, 'Failed to stop Terraria server.');
        }
    },
});

registerCommand({
    name: 'stop_terraria_warning',
    usage: 'stop_terraria_warning',
    legacyKey: 'stop terraria warning',
    description: 'Warn players and stop the Terraria server after one minute.',
    category: 'Terraria',
    minRole: 3,
    handler: async (interaction) => {
        await respond(interaction, 'Warning: The server will stop in 1 minute. Please save your progress.');
        setTimeout(async () => {
            try {
                await respond(interaction, 'Stopping Terraria server now...');
                await withSSHConnection(config.terraria, (client) => client.execCommand('screen -S terraria -X quit'));
                await respond(interaction, 'Terraria server stopped.');
            } catch (error) {
                console.error('Failed to stop Terraria server:', error);
                await respond(interaction, 'Failed to stop Terraria server.');
            }
        }, 60_000);
    },
});

registerCommand({
    name: 'restart_terraria',
    usage: 'restart_terraria',
    legacyKey: 'restart terraria',
    description: 'Restart the Terraria server.',
    category: 'Terraria',
    minRole: 3,
    handler: async (interaction) => {
        await respond(interaction, 'Restarting Terraria server...');
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
                    await respond(
                        interaction,
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
            await respond(interaction, 'Failed to restart Terraria server.');
        }
    },
});

registerCommand({
    name: 'uptime_terraria',
    usage: 'uptime_terraria',
    legacyKey: 'uptime terraria',
    description: 'Display Terraria server uptime.',
    category: 'Terraria',
    minRole: 3,
    handler: async (interaction) => {
        await respond(interaction, 'Fetching server uptime...');
        try {
            const result = await runSSHCommand(
                config.terraria,
                'ps -eo pid,etime,cmd | grep TerrariaServer | grep -v grep'
            );
            const uptime = result.stdout ? result.stdout.split(/\s+/)[1] : 'Unable to determine uptime.';
            await respond(interaction, `Server uptime: ${uptime}`);
        } catch (error) {
            console.error('Failed to fetch server uptime:', error);
            await respond(interaction, 'Failed to fetch server uptime.');
        }
    },
});

registerCommand({
    name: 'start_minecraft',
    usage: 'start_minecraft',
    legacyKey: 'start minecraft',
    description: 'Start the Minecraft server.',
    category: 'Minecraft',
    minRole: 3,
    handler: async (interaction) => {
        await respond(interaction, 'Starting Minecraft server...');
        try {
            await runSSHCommand(config.minecraft, 'sudo systemctl start minecraft');
            await respond(interaction, 'Minecraft server started.');
        } catch (error) {
            console.error('Failed to start Minecraft server:', error);
            await respond(interaction, 'Failed to start Minecraft server.');
        }
    },
});

registerCommand({
    name: 'stop_minecraft',
    usage: 'stop_minecraft',
    legacyKey: 'stop minecraft',
    description: 'Stop the Minecraft server.',
    category: 'Minecraft',
    minRole: 3,
    handler: async (interaction) => {
        await respond(interaction, 'Stopping Minecraft server...');
        try {
            await runSSHCommand(config.minecraft, 'sudo systemctl stop minecraft');
            await respond(interaction, 'Minecraft server stopped.');
        } catch (error) {
            console.error('Failed to stop Minecraft server:', error);
            await respond(interaction, 'Failed to stop Minecraft server.');
        }
    },
});

registerCommand({
    name: 'restart_minecraft',
    usage: 'restart_minecraft',
    legacyKey: 'restart minecraft',
    description: 'Restart the Minecraft server.',
    category: 'Minecraft',
    minRole: 3,
    handler: async (interaction) => {
        await respond(interaction, 'Restarting Minecraft server...');
        try {
            await runSSHCommand(config.minecraft, 'sudo systemctl restart minecraft');
            await respond(interaction, 'Minecraft server restarted.');
        } catch (error) {
            console.error('Failed to restart Minecraft server:', error);
            await respond(interaction, 'Failed to restart Minecraft server.');
        }
    },
});

registerCommand({
    name: 'backup_minecraft',
    usage: 'backup_minecraft',
    legacyKey: 'backup minecraft',
    description: 'Back up the Minecraft server.',
    category: 'Minecraft',
    minRole: 3,
    handler: async (interaction) => {
        await respond(interaction, 'Backing up Minecraft server...');
        try {
            await runSSHCommand(config.minecraft, 'sudo /minecraft/backup.sh');
            await respond(interaction, 'Minecraft backup completed.');
        } catch (error) {
            console.error('Failed to backup Minecraft server:', error);
            await respond(interaction, 'Failed to backup Minecraft server.');
        }
    },
});

registerCommand({
    name: 'update_minecraft',
    usage: 'update_minecraft',
    legacyKey: 'update minecraft',
    description: 'Update the Minecraft server.',
    category: 'Minecraft',
    minRole: 3,
    handler: async (interaction) => {
        await respond(interaction, 'Updating Minecraft server...');
        try {
            await runSSHCommand(config.minecraft, 'sudo /minecraft/update.sh');
            await respond(interaction, 'Minecraft update completed.');
        } catch (error) {
            console.error('Failed to update Minecraft server:', error);
            await respond(interaction, 'Failed to update Minecraft server.');
        }
    },
});

registerCommand({
    name: 'restore_minecraft',
    usage: 'restore_minecraft',
    legacyKey: 'restore minecraft',
    description: 'Restore the Minecraft server from backup.',
    category: 'Minecraft',
    minRole: 3,
    handler: async (interaction) => {
        await respond(interaction, 'Restoring Minecraft server worlds, settings, and permissions...');
        try {
            await runSSHCommand(config.minecraft, 'sudo /minecraft/restore.sh');
            await respond(interaction, 'Minecraft restore completed.');
        } catch (error) {
            console.error('Failed to restore Minecraft server:', error);
            await respond(interaction, 'Failed to restore Minecraft server.');
        }
    },
});

registerCommand({
    name: 'set_minecraftpatch',
    usage: 'set_minecraftpatch <patch>',
    legacyKey: 'set minecraftpatch',
    description: 'Update the Minecraft Bedrock download link to a specific patch version.',
    category: 'Minecraft',
    minRole: 3,
    options: [
        {
            name: 'patch',
            description: 'The Minecraft Bedrock patch version (e.g., 1.21.113.1).',
            type: ApplicationCommandOptionType.String,
            required: true,
        },
    ],
    handler: async (interaction) => {
        const patch = interaction.options.getString('patch', true).trim();
        const patchRegex = /^\d+\.\d+\.\d+\.\d+$/;

        if (!patchRegex.test(patch)) {
            await respond(
                interaction,
                'Invalid patch format. Please use the format `/set_minecraftpatch 1.21.113.1`.',
                { ephemeral: true }
            );
            return;
        }

        const newLink = `https://www.minecraft.net/bedrockdedicatedserver/bin-linux/bedrock-server-${patch}.zip`;
        const command = `echo "${newLink}" | sudo tee /minecraft/bedrock_last_link.txt > /dev/null`;

        await respond(interaction, 'Updating Minecraft Bedrock download link...');
        try {
            await runSSHCommand(config.minecraft, command);
            await respond(interaction, `Minecraft Bedrock download link updated to version ${patch}.`);
        } catch (error) {
            console.error('Failed to update Minecraft download link:', error);
            await respond(
                interaction,
                'Failed to update the download link due to insufficient permissions or other errors.'
            );
        }
    },
});

async function respondWithServerHelp(interaction) {
    const member = interaction.member ?? null;
    const roleLevel = getMemberRoleLevel(member);

    if (roleLevel === 0) {
        await respond(interaction, 'You do not have the required permissions to use bot commands.', { ephemeral: true });
        return;
    }

    const commandsByRole = new Map();
    for (let i = 1; i <= ROLE_PRIORITY.length; i += 1) {
        commandsByRole.set(ROLE_PRIORITY[i - 1], []);
    }

    commandDefinitions
        .filter((command) => command.type === ApplicationCommandType.ChatInput)
        .forEach((command) => {
            if (command.minRole <= 0 || command.minRole > ROLE_PRIORITY.length) {
                return;
            }
            const roleName = ROLE_PRIORITY[command.minRole - 1];
            const entries = commandsByRole.get(roleName);
            entries.push(command);
        });

    const lines = [];
    lines.push('Here are the available server commands by role:');
    lines.push('');

    for (let i = 0; i < ROLE_PRIORITY.length; i += 1) {
        const roleName = ROLE_PRIORITY[i];
        const commands = commandsByRole.get(roleName) || [];
        if (commands.length === 0) {
            continue;
        }

        lines.push(`${roleName}:`);
        commands
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name))
            .forEach((command) => {
                const usageSuffix = command.usage.replace(command.name, '').trim();
                const usageLine = usageSuffix ? `/${command.name} ${usageSuffix}` : `/${command.name}`;
                lines.push(`• ${usageLine} — ${command.description}`);
            });
        lines.push('');
    }

    lines.push(
        `Your highest recognized role is: ${roleLevel > 0 ? ROLE_PRIORITY[roleLevel - 1] : 'None'}. You can use all commands listed for your role and any preceding roles.`
    );

    await respond(interaction, lines.join('\n'), { ephemeral: true });
}

const serverHelpCommand = {
    name: 'server',
    usage: 'server',
    legacyKey: 'serverhelp',
    description: 'Display the list of available server commands grouped by role.',
    category: 'Help',
    minRole: 1,
    handler: respondWithServerHelp,
};

registerCommand(serverHelpCommand);
registerCommand({
    ...serverHelpCommand,
    name: 'Server Command Reference',
    type: ApplicationCommandType.User,
    handler: respondWithServerHelp,
});

async function registerSlashCommands(clientInstance) {
    const rest = new REST({ version: '10' }).setToken(config.discordToken);

    const body = commandDefinitions.map((command) => {
        const base = {
            name: command.name,
            type: command.type,
            dm_permission: false,
        };

        if (command.type === ApplicationCommandType.ChatInput) {
            base.description = command.description;
            base.options = command.options;
        }

        const allowedRoles = getAllowedRoleNames(command.minRole);
        base.default_member_permissions = allowedRoles.length > 0 ? '0' : null;

        return base;
    });

    const guilds = clientInstance.guilds.cache;
    for (const guild of guilds.values()) {
        try {
            const registeredCommands = await rest.put(
                Routes.applicationGuildCommands(clientInstance.user.id, guild.id),
                { body }
            );
            await applyRolePermissions(guild, registeredCommands);
        } catch (error) {
            console.error(`Failed to register commands for guild ${guild.id}:`, error);
        }
    }
}

async function applyRolePermissions(guild, registeredCommands) {
    await guild.roles.fetch();

    for (const apiCommand of registeredCommands) {
        const key = getCommandKey(apiCommand.name, apiCommand.type);
        const metadata = commandRegistry.get(key);
        if (!metadata) {
            continue;
        }

        const allowedRoleNames = getAllowedRoleNames(metadata.minRole);
        if (allowedRoleNames.length === 0) {
            continue;
        }

        const resolvedRoles = allowedRoleNames
            .map((roleName) => guild.roles.cache.find((role) => role.name === roleName))
            .filter(Boolean);

        if (resolvedRoles.length === 0) {
            console.warn(`No matching roles found for command ${apiCommand.name} in guild ${guild.name}.`);
            continue;
        }

        const permissions = resolvedRoles.map((role) => ({
            id: role.id,
            type: ApplicationCommandPermissionType.Role,
            permission: true,
        }));

        try {
            await guild.commands.permissions.set({
                command: apiCommand.id,
                permissions,
            });
        } catch (error) {
            console.error(`Failed to set permissions for command ${apiCommand.name} in guild ${guild.name}:`, error);
        }
    }
}

client.on('interactionCreate', async (interaction) => {
    if (
        !interaction.isChatInputCommand() &&
        !interaction.isUserContextMenuCommand() &&
        !interaction.isMessageContextMenuCommand()
    ) {
        return;
    }

    const key = getCommandKey(interaction.commandName, interaction.commandType);
    const command = commandRegistry.get(key);

    if (!command) {
        if (!interaction.deferred && !interaction.replied) {
            await interaction.reply({
                content: 'This command is not available right now.',
                ephemeral: true,
            });
        }
        return;
    }

    if (checkRateLimit(interaction.user.id, command.legacyKey)) {
        await respond(interaction, 'Please wait before using this command again.', { ephemeral: true });
        return;
    }

    try {
        logPrivilegedCommand(interaction, command.legacyKey);
        await command.handler(interaction);
    } catch (error) {
        console.error(`Unexpected error while executing /${interaction.commandName}:`, error);
        if (interaction.deferred || interaction.replied) {
            await interaction.followUp({
                content: 'An unexpected error occurred while processing your command.',
                ephemeral: true,
            });
        } else {
            await interaction.reply({
                content: 'An unexpected error occurred while processing your command.',
                ephemeral: true,
            });
        }
    }
});

client.login(config.discordToken);
