# Phineas T. Kogsworth Improvement Plan

This plan captures the remediation work derived from the previous bot review.

## Security
1. Replace hard-coded SSH key paths with environment-configurable secrets.
2. Scope SSH connections to each command invocation to avoid sharing a global `NodeSSH` instance.

## Reliability
1. Refactor network status checks to use promises with clear timeout handling.
2. Introduce guards for direct messages and add fallbacks when DMs cannot be delivered.
3. Add light-weight rate limiting and structured logging for privileged commands.

## Maintainability
1. Consolidate SSH logic behind `utils/sshHandler.js` so bot commands do not reimplement connection handling.
2. Replace large chains of `if` statements with a command registry for clearer routing and future extensibility.
3. Validate critical environment variables during startup to fail fast when configuration is incomplete.
4. Fix the unreachable `!restore minecraft` command trigger.

All implementation tasks below follow directly from this plan.