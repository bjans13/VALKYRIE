const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
    ContextMenuCommandBuilder,
    ApplicationCommandOptionType,
    ApplicationCommandType,
    Events,
    MessageFlags,
} = require('discord.js');
const net = require('net');
const fs = require('fs');
const { setTimeout: delay } = require('timers/promises');
const config = require('./config');
const logger = require('./utils/logger');
const { withSSHConnection, runSSHCommand } = require('./utils/sshHandler');

validateFilesystemPrerequisites([
    { name: 'Terraria', keyPath: config.terraria.privateKeyPath },
    { name: 'Minecraft', keyPath: config.minecraft.privateKeyPath },
]);

logger.info('Starting Valkyrie bot', { environment: config.environment.name });

let ownerUser = null;
const unauthorizedGuildNotices = new Set();

function isAllowedGuild(guildId) {
    return Boolean(guildId && config.allowedGuilds.includes(guildId));
}

async function getOwnerUser(clientInstance) {
    if (!config.ownerId) {
        return null;
    }

    if (ownerUser && ownerUser.id === config.ownerId) {
        return ownerUser;
    }

    try {
        ownerUser = await clientInstance.users.fetch(config.ownerId);
        return ownerUser;
    } catch (error) {
        logger.error('Failed to fetch owner user for alerts', { error });
        return null;
    }
}

async function alertOwner(clientInstance, message) {
    const owner = await getOwnerUser(clientInstance);
    if (!owner) {
        return;
    }

    try {
        await owner.send(message);
    } catch (error) {
        logger.error('Failed to send alert to owner', { error });
    }
}

async function reportUnauthorizedGuild(clientInstance, guildId, context, guildName = 'Unknown') {
    const label = guildId ? `${guildName} (${guildId})` : guildName;
    logger.warn(`[SECURITY] ${context}: unauthorized guild ${label}.`);

    if (guildId && !unauthorizedGuildNotices.has(guildId)) {
        unauthorizedGuildNotices.add(guildId);
        await alertOwner(clientInstance, `[SECURITY] ${context}: unauthorized guild ${label}.`);
    }
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

const MINECRAFT_UPDATE_STATUS_LINES = new Set([
    'No backup found! Update aborted.',
    'Latest version link not found! Update aborted.',
    'Stopping server...',
    'Backing up server...',
    'Downloading latest version...',
    'Download failed! Update aborted.',
    'Extracting new files...',
    'Ensuring bedrock_server is executable...',
    'Update complete!',
    'Restoring settings and worlds...',
    'Restoration failed! Please check manually.',
    'No backup found! Restore aborted.',
    'Restoring worlds, server.properties, and permissions.json from backup...',
    'Starting server...',
    'Restore complete!',
]);
const COOLDOWN_MS = 30_000;
const cooldowns = new Map();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
    ],
});

client.once(Events.ClientReady, async () => {
    logger.info('Bot connected as %s', client.user.tag);
    try {
        await getOwnerUser(client);
    } catch (error) {
        logger.error('Unable to resolve owner user during startup', { error });
    }

    try {
        await registerSlashCommands(client);
    } catch (error) {
        logger.error('Failed to register slash commands via REST', { error });
    }

    for (const guild of client.guilds.cache.values()) {
        if (!isAllowedGuild(guild.id)) {
            await reportUnauthorizedGuild(
                client,
                guild.id,
                'Detected on startup',
                guild.name ?? 'Unknown'
            );
        }
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

function prepareInteractionPayload(content, options = {}) {
    const basePayload =
        typeof content === 'object' && content !== null ? { ...content } : { content, ...options };

    if (!basePayload || typeof basePayload !== 'object') {
        return { raw: basePayload, reply: basePayload };
    }

    if (!Object.prototype.hasOwnProperty.call(basePayload, 'ephemeral')) {
        return { raw: basePayload, reply: basePayload };
    }

    const { ephemeral, ...rest } = basePayload;

    if (!ephemeral) {
        return { raw: rest, reply: rest };
    }

    const baseFlags = rest.flags ?? 0;
    return {
        raw: rest,
        reply: {
            ...rest,
            flags: baseFlags | MessageFlags.Ephemeral,
        },
    };
}

async function respond(interaction, content, options = {}) {
    const { raw, reply } = prepareInteractionPayload(content, options);

    if (interaction.deferred && !interaction.replied) {
        return interaction.editReply(raw);
    }

    if (interaction.replied) {
        return interaction.followUp(reply);
    }

    return interaction.reply(reply);
}

const dmNoticeHandledInteractions = new WeakSet();

async function sendDirectMessageWithNotice(interaction, content) {
    if (dmNoticeHandledInteractions.has(interaction)) {
        logger.debug('DM notice already handled for interaction', {
            command: interaction.commandName,
            userId: interaction.user.id,
        });
        return;
    }

    dmNoticeHandledInteractions.add(interaction);

    if (!interaction.deferred && !interaction.replied) {
        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        } catch (error) {
            logger.warn('Failed to defer interaction before sending DM.', { error });
        }
    }

    let dmError = null;
    try {
        await interaction.user.send(content);
    } catch (error) {
        dmError = error;
    }

    if (!dmError) {
        try {
            await respond(interaction, 'I sent you a DM with the requested information.', { ephemeral: true });
        } catch (responseError) {
            logger.error('Failed to confirm DM delivery to interaction.', { error: responseError });
        }
        return;
    }

    logger.warn(`Failed to DM ${interaction.user.tag}: ${dmError.message}`);
    try {
        await respond(
            interaction,
            'I could not send you a DM. Please make sure your privacy settings allow messages from server members.',
            { ephemeral: true }
        );
    } catch (responseError) {
        logger.error('Failed to notify interaction about DM failure.', { error: responseError });
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

    const logEntry = {
        event: 'privileged_command',
        timestamp: new Date().toISOString(),
        user: {
            id: interaction.user.id,
            tag: interaction.user.tag,
        },
        guildId: interaction.guildId ?? null,
        channelId: interaction.channelId ?? null,
        command: {
            name: interaction.commandName,
            type: interaction.commandType ?? null,
            legacyKey: commandKey,
        },
    };

    logger.info({ message: 'Privileged command executed', ...logEntry });
}

function getCommandKey(name, type = ApplicationCommandType.ChatInput) {
    return `${type}:${name}`;
}

const commandDefinitions = [];
const commandRegistry = new Map();

function applyDefaultPermissions(builder, command) {
    const permissionValue = command.defaultMemberPermissions ?? null;
    return builder.setDefaultMemberPermissions(permissionValue);
}

function createCommandBuilder(command) {
    if (command.type === ApplicationCommandType.ChatInput) {
        const builder = new SlashCommandBuilder()
            .setName(command.name)
            .setDescription(command.description)
            .setDMPermission(false);

        for (const option of command.options) {
            if (option.type === ApplicationCommandOptionType.String) {
                builder.addStringOption((opt) =>
                    opt
                        .setName(option.name)
                        .setDescription(option.description)
                        .setRequired(Boolean(option.required))
                );
                continue;
            }

            throw new Error(`Unsupported option type for ${command.name}: ${option.type}`);
        }

        return applyDefaultPermissions(builder, command);
    }

    if (
        command.type === ApplicationCommandType.User ||
        command.type === ApplicationCommandType.Message
    ) {
        const builder = new ContextMenuCommandBuilder()
            .setName(command.name)
            .setType(command.type)
            .setDMPermission(false);

        return applyDefaultPermissions(builder, command);
    }

    return null;
}

function registerCommand(definition) {
    const normalized = {
        ...definition,
        type: definition.type ?? ApplicationCommandType.ChatInput,
        options: definition.options ?? [],
        minRole: definition.minRole ?? 0,
        usage: definition.usage ?? definition.name,
        category: definition.category ?? 'General',
    };

    normalized.builder = createCommandBuilder(normalized);

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
        await interaction.deferReply();

        try {
            const online = await isServerOnline(config.terraria.host, config.terraria.port);
            await interaction.editReply(
                online
                    ? 'Terraria server is currently online and connectable!'
                    : 'Terraria server is currently offline.'
            );
        } catch (error) {
            logger.error('Failed to check Terraria server status', { error });
            await interaction.editReply('Failed to check Terraria server status.');
        }
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
            logger.error('Failed to fetch player list', { error });
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
            logger.error('Failed to send announcement', { error });
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
            logger.error('Failed to check Minecraft server status', { error });
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
                    logger.error('Failed to verify Terraria server status', { error: verificationError });
                }
            }, 10_000);
        } catch (error) {
            logger.error('Failed to start Terraria server', { error });
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
            logger.error('Failed to stop Terraria server', { error });
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
                logger.error('Failed to stop Terraria server', { error });
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
                    logger.error('Failed to verify Terraria server restart status', { error: verificationError });
                }
            }, 10_000);
        } catch (error) {
            logger.error('Failed to restart Terraria server', { error });
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
            logger.error('Failed to fetch server uptime', { error });
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
            logger.error('Failed to start Minecraft server', { error });
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
            logger.error('Failed to stop Minecraft server', { error });
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
            logger.error('Failed to restart Minecraft server', { error });
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
            logger.error('Failed to backup Minecraft server', { error });
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
        try {
            await interaction.deferReply();
        } catch (error) {
            logger.error('Failed to defer update_minecraft interaction', { error });
            await respond(interaction, 'Failed to start Minecraft update. Please try again.');
            return;
        }

        const progressLines = [];
        let editQueue = Promise.resolve();
        const STATUS_PREFIX = {
            pending: '\u23f3',
            failure: '\u274c',
            success: '\u2705',
        };

        const formatProgressMessage = () => {
            const header = '**Minecraft Update Progress**';
            if (progressLines.length === 0) {
                return `${header}\n(Waiting for script output...)`;
            }

            return `${header}\n${progressLines.join('\n')}`;
        };

        const queueProgressEdit = () => {
            const message = formatProgressMessage();
            editQueue = editQueue
                .then(() => interaction.editReply(message))
                .catch((editError) => {
                    logger.error('Failed to update Minecraft progress message', { error: editError });
                });
            return editQueue;
        };

        const removeHourglassLines = async () => {
            const filtered = progressLines.filter((line) => !line.startsWith(STATUS_PREFIX.pending));
            if (filtered.length === progressLines.length) {
                return;
            }

            progressLines.splice(0, progressLines.length, ...filtered);
            await interaction.editReply(formatProgressMessage());
        };

        const scheduleHourglassCleanup = () => {
            setTimeout(() => {
                editQueue = editQueue
                    .then(() => removeHourglassLines())
                    .catch((cleanupError) => {
                        logger.error('Failed to clean up Minecraft progress message after completion', {
                            error: cleanupError,
                        });
                    });
            }, 60_000);
        };

        const pushFormattedLine = (line) => {
            if (!line) {
                return editQueue;
            }

            progressLines.push(line);
            return queueProgressEdit();
        };

        const formatStatusLine = (rawLine) => {
            const normalized = rawLine.trim();
            const lower = normalized.toLowerCase();

            let prefix = STATUS_PREFIX.pending;
            if (lower.includes('failed') || lower.includes('aborted')) {
                prefix = STATUS_PREFIX.failure;
            } else if (lower.includes('complete')) {
                prefix = STATUS_PREFIX.success;
            }

            return `${prefix} ${normalized}`;
        };

        const addProgressFromRawLine = (rawLine) => {
            const normalized = rawLine.replace(/\r/g, '').trim();
            if (!normalized || !MINECRAFT_UPDATE_STATUS_LINES.has(normalized)) {
                return;
            }

            pushFormattedLine(formatStatusLine(normalized));
        };

        await pushFormattedLine(`${STATUS_PREFIX.pending} Starting Minecraft update...`);

        let stdoutBuffer = '';
        let stderrBuffer = '';

        const handleStdoutChunk = (chunk) => {
            stdoutBuffer += chunk.toString();
            let newlineIndex;
            while ((newlineIndex = stdoutBuffer.indexOf('\n')) !== -1) {
                const line = stdoutBuffer.slice(0, newlineIndex);
                stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
                addProgressFromRawLine(line);
            }
        };

        const handleStderrChunk = (chunk) => {
            stderrBuffer += chunk.toString();
        };

        let commandResult = null;

        try {
            commandResult = await runSSHCommand(config.minecraft, 'sudo /minecraft/update.sh', {
                onStdout: handleStdoutChunk,
                onStderr: handleStderrChunk,
            });
        } catch (error) {
            if (stdoutBuffer) {
                addProgressFromRawLine(stdoutBuffer);
                stdoutBuffer = '';
            }

            logger.error('Failed to execute Minecraft update script', {
                error,
                stderr: stderrBuffer,
            });

            await pushFormattedLine(`${STATUS_PREFIX.failure} Failed to execute update script. Please check server logs.`);
            await editQueue;
            return;
        }

        if (stdoutBuffer) {
            addProgressFromRawLine(stdoutBuffer);
            stdoutBuffer = '';
        }

        if (commandResult && commandResult.code === 0) {
            logger.info('Minecraft update script completed successfully.');
            await pushFormattedLine(`${STATUS_PREFIX.success} Minecraft update finished successfully.`);
            scheduleHourglassCleanup();
        } else {
            const exitCode = commandResult && typeof commandResult.code === 'number' ? commandResult.code : 'unknown';
            logger.error('Minecraft update script exited with non-zero status', {
                code: exitCode,
                stdout: commandResult ? commandResult.stdout : undefined,
                stderr: commandResult ? commandResult.stderr ?? stderrBuffer : stderrBuffer,
            });
            await pushFormattedLine(`${STATUS_PREFIX.failure} Minecraft update failed (exit code ${exitCode}). Please check server logs.`);
        }

        await editQueue;
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
            logger.error('Failed to restore Minecraft server', { error });
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
            logger.error('Failed to update Minecraft download link', { error });
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
                lines.push(`\u2022 ${usageLine} \u2014 ${command.description}`);
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

    const body = commandDefinitions
        .map((command) => command.builder)
        .filter(Boolean)
        .map((builder) => builder.toJSON());

    const guilds = clientInstance.guilds.cache;
    for (const guild of guilds.values()) {
        if (!isAllowedGuild(guild.id)) {
            await reportUnauthorizedGuild(
                clientInstance,
                guild.id,
                'Skipped command registration',
                guild.name ?? 'Unknown'
            );
            continue;
        }

        try {
            await rest.put(
                Routes.applicationGuildCommands(clientInstance.user.id, guild.id),
                { body }
            );
        } catch (error) {
            logger.error(`Failed to register commands for guild ${guild.id}`, { error });
        }
    }
}

client.on('guildCreate', async (guild) => {
    if (isAllowedGuild(guild.id)) {
        return;
    }

    await reportUnauthorizedGuild(
        client,
        guild.id,
        'Joined unauthorized guild',
        guild.name ?? 'Unknown'
    );
});

client.on('interactionCreate', async (interaction) => {
    if (
        !interaction.isChatInputCommand() &&
        !interaction.isUserContextMenuCommand() &&
        !interaction.isMessageContextMenuCommand()
    ) {
        return;
    }

    const guildId = interaction.guildId ?? null;
    if (!isAllowedGuild(guildId)) {
        await reportUnauthorizedGuild(
            client,
            guildId,
            'Blocked interaction',
            interaction.guild?.name ?? 'Unknown'
        );
        return;
    }

    const key = getCommandKey(interaction.commandName, interaction.commandType);
    const command = commandRegistry.get(key);

    if (!command) {
        if (!interaction.deferred && !interaction.replied) {
            await respond(interaction, 'This command is not available right now.', { ephemeral: true });
        }
        return;
    }

    if (command.minRole > 0) {
        const member = interaction.member ?? null;
        const roleLevel = getMemberRoleLevel(member);
        if (roleLevel < command.minRole) {
            const requiredRoleName = ROLE_PRIORITY[command.minRole - 1] ?? 'required';
            await respond(
                interaction,
                `You must hold the ${requiredRoleName} role or higher to use this command.`,
                { ephemeral: true }
            );
            return;
        }
    }

    if (checkRateLimit(interaction.user.id, command.legacyKey)) {
        await respond(interaction, 'Please wait before using this command again.', { ephemeral: true });
        return;
    }

    try {
        logPrivilegedCommand(interaction, command.legacyKey);
        await command.handler(interaction);
    } catch (error) {
        logger.error(`Unexpected error while executing /${interaction.commandName}`, { error });
        try {
            await respond(interaction, 'An unexpected error occurred while processing your command.', {
                ephemeral: true,
            });
        } catch (responseError) {
            logger.error('Failed to send error notification to interaction.', { error: responseError });
        }
    }
});

client.login(config.discordToken);

function validateFilesystemPrerequisites(services) {
    for (const { name, keyPath } of services) {
        try {
            const stats = fs.statSync(keyPath);
            if (!stats.isFile()) {
                throw new Error(`[${name}] private key path ${keyPath} is not a file.`);
            }

            fs.accessSync(keyPath, fs.constants.R_OK);

            if (process.platform !== 'win32') {
                const mode = stats.mode & 0o777;
                if ((mode & 0o077) !== 0) {
                    throw new Error(
                        `[${name}] private key ${keyPath} must not be accessible to group or others. Run chmod 600.`
                    );
                }
            }
        } catch (error) {
            if (error.code === 'ENOENT') {
                throw new Error(`[${name}] private key file not found at ${keyPath}.`);
            }

            throw new Error(
                `[${name}] private key validation failed for ${keyPath}: ${error.message || error.toString()}`
            );
        }
    }
}
