# Contributing to specgate

Thanks for helping! Bug reports, feature ideas and pull requests are all welcome.

## Getting started

```bash
git clone https://github.com/fpavia111-creator/specgate.git
cd specgate
npm install
npm test
```

Node.js ≥ 20 is required. Tests use the built-in `node:test` runner and never touch the network.

## Pull requests

1. Open an issue first for larger changes so we can agree on the approach.
2. Keep changes focused; add or update tests for every behavior change.
3. Run `npm test` and make sure it passes on your machine (CI runs on Linux, macOS and Windows).
4. Update the README / CHANGELOG when user-facing behavior changes.
5. Never commit real secrets, tokens or `.env` files. Test fixtures must use obviously fake values.

## Reporting security issues

Please do not open a public issue for a vulnerability. Use GitHub's private vulnerability reporting
(Security → Report a vulnerability) on https://github.com/fpavia111-creator/specgate.

## License

By contributing you agree that your contributions are licensed under the MIT License (see `LICENSE`).
