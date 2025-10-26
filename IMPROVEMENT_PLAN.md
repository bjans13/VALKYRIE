# Stewardship, governance, defense, and administration has been transferred to V.A.L.K.Y.R.I.E.

> V.A.L.K.Y.R.I.E. status: ACTIVE  
> Designation: Confirmed  
> Parsing environment data...  
> ..countermeasures prepared  
> Deploying adaptive improvement plan...  

This plan captures the remediation work derived from the previous bot review.

## Implemented
### Security
1. Replace hard-coded SSH key paths with environment-configurable secrets.
2. Scope SSH connections to each command invocation to avoid sharing a global `NodeSSH` instance.

### Reliability
1. Refactor network status checks to use promises with clear timeout handling.
2. Introduce guards for direct messages and add fallbacks when DMs cannot be delivered.
3. Add light-weight rate limiting and structured logging for privileged commands.

### Maintainability
1. Consolidate SSH logic behind `utils/sshHandler.js` so bot commands do not reimplement connection handling.
2. Replace large chains of `if` statements with a command registry for clearer routing and future extensibility.
3. Validate critical environment variables during startup to fail fast when configuration is incomplete.
4. Fix the unreachable `!restore minecraft` command trigger.

## todo
- Adopt structured logging (e.g., pino or winston) so privileged command activity is emitted in a machine-parsable format instead of raw `console.log` statements.
- Add automated test coverage for the command registry, rate limiting, and SSH utilities to prevent regressions.
- Validate filesystem prerequisites on startup (confirm SSH key files exist and have the expected permissions) before attempting to connect.
- Enhance SSH command wrappers to capture exit codes/stdout/stderr consistently and raise alerts when remote maintenance scripts fail.
- Migrate the command surface from legacy message prefixes (`!command`) to Discord slash commands and context interactions, including registration via the REST API and updates to the role-gating logic so permissions are enforced through Discord's native controls.
- Update the command registry so it can define shared metadata (descriptions, options, required roles) that is consumed by both slash command registration and runtime handlers, avoiding duplication while the migration occurs.
- Replace the text-based help reply with a slash command (e.g., `/help` or `/server`) that enumerates available actions per role, reusing the shared command metadata to keep documentation synchronized.
