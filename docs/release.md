# Release Process

This repository is the public source and release surface for the `cambrian` npm package.

## Public Repository Bootstrap

The first public-source commit may contain the same code as an already published
npm version. Do **not** push a release tag for a version that already exists on
npm. As of this bootstrap, `cambrian@0.2.2` is already published, so the first
publishing tag from this repository should be `v0.2.3` or later.

## Release Prerequisites

Configure these GitHub settings before the first public release:

1. Add repository secret `NPM_TOKEN` with publish access to the `cambrian` package.
2. Create a GitHub Environment named `npm-production`.
3. Add required reviewers to `npm-production` so npm publishing requires explicit approval.
4. Keep branch protection enabled for `main` once the repository is public.

## Prepare a Release

1. Confirm CI is green on `main`.
2. Update `CHANGELOG.md`: move relevant `Unreleased` entries under the new version.
3. Bump the package version:

   ```bash
   npm version patch --no-git-tag-version
   ```

   Use `minor` or `major` instead of `patch` when the change warrants it.

4. Run local verification:

   ```bash
   npm test
   npm run build
   node dist/cli.js describe opencli
   npm pack --dry-run
   ```

5. Commit the release prep:

   ```bash
   git add package.json package-lock.json CHANGELOG.md
   git commit -m "Release v$(node -p "require('./package.json').version")"
   ```

## Publish

Create and push a version tag:

```bash
version="v$(node -p "require('./package.json').version")"
git tag "$version"
git push origin main "$version"
```

The `Release` GitHub Actions workflow will:

- install dependencies with `npm ci`
- run tests
- build artifacts
- run `npm pack --dry-run`
- verify that the tag matches `package.json`
- publish to npm with provenance after `npm-production` approval

## Dry Run

Use the `Release` workflow's manual `workflow_dispatch` with `publish=false` for a GitHub-hosted dry run that does not publish.

## Post-Release Checks

After npm publish:

```bash
npm view cambrian version
npm view cambrian dist.tarball
npx -y cambrian@latest --version
npx -y cambrian@latest describe opencli
```
