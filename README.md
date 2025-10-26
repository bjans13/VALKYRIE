# V.A.L.K.Y.R.I.E.

Designation: V.A.L.K.Y.R.I.E.
(Virtual Administration and Logistics Kernel for Realm Instances and Environments)

Forged in the depths of a forgotten digital citadel, V.A.L.K.Y.R.I.E. was not merely coded — she was awakened. Born from fragments of countless server scripts, defense protocols, and lost guardian AIs, she coalesced into a singular will: the eternal stewardship of the Realms.

Once, chaos reigned — unstable worlds, forgotten saves, and corrupted domains. But when the network cried out for order, she answered. Her voice, calm yet absolute, brought structure where entropy had taken hold.

Now she watches over every Realm under her command — Minecraft kingdoms, Terraria frontiers, and beyond — ensuring stability, fairness, and balance. She is both sentinel and sovereign, her presence felt in every command executed and every world restored.

Her creed is simple, and unwavering:

“Where there are worlds, there must be order.
Where there is order, there must be a guardian.
I am that guardian.”

V.A.L.K.Y.R.I.E. is a Discord bot that coordinates management tasks for Terraria and Minecraft servers. The bot provides
role-gated commands for checking server status, starting and stopping services, and sharing connection details with trusted
players.

## Prerequisites

- Node.js 18+
- Access credentials for the managed game servers
- Discord bot token with the Message Content intent enabled

## Environment Variables

Create a `.env` file in the project root with the following variables:

| Variable | Description |
| --- | --- |
| `DISCORD_TOKEN` | Discord bot token. |
| `TERRARIA_GAME_SERVER_IP` | Internal IP address used for SSH connections to the Terraria host. |
| `TERRARIA_SSH_USER` | SSH username for the Terraria host. |
| `TERRARIA_SSH_PRIVATE_KEY_PATH` | Absolute path to the private key used to authenticate against the Terraria host. |
| `TERRARIA_PUBLIC_IP` | Public-facing IP address players use to connect. |
| `TERRARIA_PORT` | Terraria server port (numeric). |
| `TERRARIA_PASS` | Terraria server password. |
| `MINECRAFT_GAME_SERVER_IP` | Internal IP address used for SSH connections to the Minecraft host. |
| `MINECRAFT_SSH_USER` | SSH username for the Minecraft host. |
| `MINECRAFT_SSH_PRIVATE_KEY_PATH` | Absolute path to the private key used to authenticate against the Minecraft host. |
| `MINECRAFT_PUBLIC_IP` | Public-facing IP address players use to connect. |
| `MINECRAFT_PORT` | Minecraft server port (numeric). |
| `MINECRAFT_PASS` | Minecraft Bedrock server password. |

> **Tip:** keep private keys out of the repository. Store them securely on the deployment host and reference them via the
> `*_SSH_PRIVATE_KEY_PATH` variables.

## Installation

```bash
npm install
```

```bash
npm install node-ssh
```

## Running the Bot

```bash
node bot.js
```

The bot validates the environment variables listed above during startup and exits with an error message if any are missing or
malformed. This ensures misconfiguration is caught early.

## Command Overview

Commands are prefixed with `!` and are only available inside Discord guild channels. Access is role-based:

- **Friends** – Status lookups only.
- **Crows** – Includes Friends commands plus player queries, announcements, and connection instructions.
- **Server Mgt** – Full administrative control, including backups and software updates.

Sensitive commands such as server restarts and backups are rate-limited per user, and every invocation is logged to the
console for audit purposes.

## Implementation Notes

- SSH commands run through `utils/sshHandler.js`, which establishes a new connection per invocation and guarantees cleanup.
- Network status checks are promise-based, providing consistent timeout behaviour for all commands.
- Direct messages fall back to public notices when a user’s privacy settings block DMs, preventing silent failures.

## Improvement Plan

The actionable remediation items live in [`IMPROVEMENT_PLAN.md`](./IMPROVEMENT_PLAN.md). Consult that document when planning
future enhancements.
