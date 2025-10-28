# Release Checklist

Use this checklist before publishing a public release or Git tag.

1. **Confirm scope**
   - Review open issues and PRs for anything that must ship in this release.
   - Ensure security fixes are documented in [`SECURITY.md`](./SECURITY.md) if applicable.
2. **Update metadata**
   - Bump the version in [`package.json`](./package.json) and regenerate `package-lock.json` with `npm install`.
   - Update the release entry in [`CHANGELOG.md`](./CHANGELOG.md) with the version and release date.
3. **Verify configuration**
   - Validate `.env.example` for accuracy and remove any unused variables.
   - Confirm [`README.md`](./README.md) and other top-level docs reflect current features.
4. **Quality gates**
   - Run `npm test` and `npm run lint` locally and ensure CI passes.
   - Execute a smoke test of the bot in a staging guild, validating slash command registration.
5. **Tag and publish**
   - Create a signed Git tag (`git tag -s vX.Y.Z`) and push it (`git push --tags`).
   - Draft the GitHub release notes summarizing key changes and linking back to the changelog.
6. **Post-release**
   - Monitor CI/CD and Discord logs for errors in the first 24 hours.
   - Open follow-up issues for any deferred work discovered during testing.

Checking every item keeps the public release process consistent and auditable.
