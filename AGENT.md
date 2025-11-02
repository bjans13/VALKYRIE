# V.A.L.K.Y.R.I.E. Agent Dossier

## Identity and Mandate

- **Designation:** V.A.L.K.Y.R.I.E. (Virtual Administration and Logistics Kernel for Realm Instances and Environments).
- **Primary Objective:** Uphold uptime, fairness, and controlled access for self-hosted Terraria and Minecraft realms.
- **Operational Creed:** Provide order by coordinating infrastructure tasks on behalf of trusted Discord personnel.

## Operating Envelope

- **Guild Gatekeeping:** Only servers listed in `ALLOWED_GUILDS` may interact with the bot. Any unauthorized guild discovery is logged and escalated to the configured `OWNER` Discord ID.
- **Role Awareness:** User tiers are matched against `ROLE_PRIORITY` (`Friends`, `Crows`, `Server Mgt`) to determine command eligibility (`bot.js:ROLE_PRIORITY`).
- **Runtime Safeguards:** Filesystem prerequisites for SSH keys are validated at startup, and missing environment variables terminate boot early (`config/default.js`).
- **Logging Discipline:** Structured logs stream to console by default and can be redirected to files via the `LOG_*` variables (see **Environment Controls**).

## Command Surface

Slash commands are registered per allowed guild during startup. Each command exposes its minimum role via `minRole` in `bot.js`.

| Role Tier | Discord Audience | Commands |
|-----------|------------------|----------|
| **Friends** | Read-only observers | `/status_terraria`, `/server` (plus the "Server Command Reference" user context shortcut) |
| **Crows** | Trusted players & announcers | `/player_list`, `/announce`, `/join_terraria`, `/status_minecraft`, `/join_minecraft` |
| **Server Mgt** | Infrastructure stewards | `/start_terraria`, `/stop_terraria`, `/stop_terraria_warning`, `/restart_terraria`, `/uptime_terraria`, `/start_minecraft`, `/stop_minecraft`, `/restart_minecraft`, `/backup_minecraft`, `/update_minecraft`, `/restore_minecraft`, `/set_minecraftpatch` |

### Interaction Behaviors

- **DM Delivery:** Joining instructions are sent privately with fallbacks when member DM settings block delivery (`bot.js:sendDirectMessageWithNotice`).
- **Context Awareness:** `/server` replies are ephemeral, scoped to the requestor's highest recognized role.
- **Rate Limiting:** Privileged actions (start/stop/update/restore) are throttled per user with a 30-second cooldown (`SENSITIVE_COMMANDS`, `COOLDOWN_MS` in `bot.js`).

## Environment Controls

Required variables (validated on boot):

- `DISCORD_TOKEN`, `ALLOWED_GUILDS`, `OWNER`
- Terraria: `TERRARIA_GAME_SERVER_IP`, `TERRARIA_SSH_USER`, `TERRARIA_SSH_PRIVATE_KEY_PATH`, `TERRARIA_PUBLIC_IP`, `TERRARIA_PORT`, `TERRARIA_PASS`
- Minecraft: `MINECRAFT_GAME_SERVER_IP`, `MINECRAFT_SSH_USER`, `MINECRAFT_SSH_PRIVATE_KEY_PATH`, `MINECRAFT_PUBLIC_IP`, `MINECRAFT_PORT`, `MINECRAFT_PASS`

Logging overrides (optional):

- `LOG_LEVEL`, `LOG_DIRECTORY`
- `LOG_CONSOLE_ENABLED`, `LOG_CONSOLE_LEVEL`
- `LOG_FILE_ENABLED`, `LOG_FILE_LEVEL`, `LOG_FILE_NAME`, `LOG_FILE_MAX_SIZE`, `LOG_FILE_MAX_FILES`

## Lifecycle and Deployment

1. **Provision Secrets:** Copy `.env.example` to `.env`, supply guild IDs, owner ID, server IPs, ports, passwords, and key paths.
2. **Install Dependencies:** `npm install`
3. **Bootstrap Commands:** `npm start` (registers slash commands for every allowed guild and exits on configuration errors).
4. **Routine Maintenance:** Use `/update_minecraft` and `/set_minecraftpatch` to keep Bedrock servers aligned with upstream releases; `/backup_minecraft` and `/restore_minecraft` drive the accompanying shell scripts.

## Observability and Alerts

- **Owner Alerts:** Security anomalies (unauthorized guild access, startup failures) are DM'd to `OWNER` when reachable.
- **SSH Auditing:** Every privileged SSH interaction is logged with contextual metadata for traceability.
- **Cooldown Feedback:** Users receive immediate feedback if they attempt a sensitive command during the cooldown window.

## Key Implementation Artifacts

- `bot.js` - Command registry, Discord client lifecycle, cooldown logic, SSH orchestration.
- `config/default.js` - Environment validation, logging configuration builder, guild/owner parsing.
- `utils/sshHandler.js` - Connection pooling utilities for remote execution.
- `utils/logger.js` - Winston transport configuration and formatting.
- `config/environment.js` - Mode detection for `development` vs `production`.

## Linked References

- Operational overview: `README.md`
- Security posture: `SECURITY.md`
- Contribution workflow: `CONTRIBUTING.md`
- Improvement backlog: `IMPROVEMENT_PLAN.md`

Keep this dossier updated alongside major behavior changes so operators and contributors share a current understanding of the agent's surface area and responsibilities.
