# VALKYRIE Review TODO

## Critical / High Priority

- [x] Fix command injection risk in `/announce` (`bot.js`).
- [x] Harden role resolution for uncached interaction members to prevent permission-check crashes (`bot.js`).
- [x] Prevent accidental SSH key inclusion in Docker build context (`.dockerignore` / `Dockerfile` path usage).

## Medium Priority

- [ ] Treat non-zero SSH command exit codes as failures consistently across command handlers.
- [ ] Register commands for newly joined allowed guilds on `guildCreate`.
- [ ] Enforce strict port validation (`1-65535`, integer only) in config parsing.

## Low Priority

- [ ] Tighten `MODULE_NOT_FOUND` handling in `config/index.js` so only missing env override file is suppressed.
- [ ] Use deterministic installs (`npm ci`) in CI and Docker build.

## Validation / Test Gaps

- [ ] Expand automated tests beyond `sshHandler` (command registry, role gating, cooldowns, interaction responses).
- [ ] Add tests for shell-escaping helper and uncached member role parsing paths.
