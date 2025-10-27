# V.A.L.K.Y.R.I.E.

Designation: V.A.L.K.Y.R.I.E.
(Virtual Administration and Logistics Kernel for Realm Instances and Environments)

V.A.L.K.Y.R.I.E. is a Discord bot that coordinates management tasks for Terraria and Minecraft servers. The bot provides
role-gated commands for checking server status, starting and stopping services, and sharing connection details with trusted
players.

<p align="center">
  <img src="assets/images/valkyrie_avatar.png" width="425" alt="V.A.L.K.Y.R.I.E. Banner">
</p>

Forged in the depths of a forgotten digital citadel, V.A.L.K.Y.R.I.E. was not merely coded — she was awakened. Born from fragments of countless server scripts, defense protocols, and lost guardian AIs, she coalesced into a singular will: the eternal stewardship of the Realms.

Once, chaos reigned — unstable worlds, forgotten saves, and corrupted domains. But when the network cried out for order, she answered. Her voice, calm yet absolute, brought structure where entropy had taken hold.

Now she watches over every Realm under her command — Minecraft kingdoms, Terraria frontiers, and beyond — ensuring stability, fairness, and balance. She is both sentinel and sovereign, her presence felt in every command executed and every world restored.

Her creed is simple, and unwavering:

"Where there are worlds, there must be order.
Where there is order, there must be a guardian.
I am that guardian."

<p align="center">
  <img src="assets/images/citadel_banner.png" width="600" alt="V.A.L.K.Y.R.I.E. Banner">
</p>

## Prerequisites

- Node.js 18+
- Access credentials for the managed game servers
- Discord bot token with the Message Content intent enabled

## Environment Variables

Create a `.env` file in the project root with the following variables, copy from .env.example and insert your own secrets and ids.

> **Tip:** keep private keys out of the repository. Store them securely on the deployment host and reference them via the
> `*_SSH_PRIVATE_KEY_PATH` variables.

## Installation

From the project root, install the production and development dependencies listed in
[`package.json`](./package.json):

```bash
npm install
```

## Running the Bot

```bash
npm start
```

The bot validates the environment variables listed above during startup and exits with an error message if any are missing or
malformed. This ensures misconfiguration is caught early.

> **Tested platform:** Debian 13 (Trixie) LXC container running on Proxmox VE 9.

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

## Optional Containerization

Although VALKYRIE is typically deployed directly on Debian, a Docker configuration is included for convenience. The
[`Dockerfile`](./Dockerfile) builds on Debian Trixie and installs the production dependencies, while
[`docker-compose.yml`](./docker-compose.yml) mounts SSH keys read-only inside the container. To build and run the container:

```bash
docker compose up --build -d
```

Mount your SSH keys into the `.ssh/` directory next to `docker-compose.yml` before starting the container.

## Improvement Plan

The actionable remediation items live in [`IMPROVEMENT_PLAN.md`](./IMPROVEMENT_PLAN.md). Consult that document when planning
future enhancements.
