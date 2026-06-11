# W3S Receipts

> [!WARNING]
> The following is a prototype, reference implementation, and proof-of-concept. This open source code is provided for research, experimentation, and developer education only. This code has not been audited, is actively experimental, and may contain bugs, vulnerabilities, or incomplete features. Use at your own risk.

This is code developed and published by Parity as an experimental proof-of-concept. It is **not** a Parity product or service, and Parity does not operate, host, deploy, or endorse any downstream deployment of it — downstream operators run their own forks at their own discretion.

Mobile-first customer checkout for the W3S Receipts payment surface. The app scans merchant receipt and terminal-payment codes, resolves pilot merchants from the on-chain registry, asks the Polkadot host to execute CASH payments, and keeps a local wallet-style activity and receipt history.


## Getting Started

### Deploy

```bash
npm install
cp .env.example .env.local        # set secrets, or let the wizard prompt
npm run setup                     # guided deploy: configure → readiness → publish
```

See **[DEPLOY.md](./DEPLOY.md)** for the full guide: the `npm run setup` wizard, the `.env.local` variable table, flags (`--yes`, `--dry-run`, `--publish`, …), and the manual `npm run deploy` path.

### Frontend (local dev)

```bash
npm install
cp .env.example .env.local        # then set VITE_DOTNS_PRODUCT_DOMAIN and VITE_* values
npm run dev                       # http://localhost:5174
```


### Checks

```bash
npm test
npm run typecheck
npm run build
```


## Security

Before deploying it for real use cases, you are responsible for:

- Reviewing the code yourself; this is a reference proof-of-concept, not a hardened production build.
- Checking that dependencies are up to date and free of known vulnerabilities.
- Securing your own fork or deployment environment, especially mnemonics, CI secrets, host product identity, registry address, and DotNS ownership.
- Tracking the latest tagged release / commits for security fixes; older releases are not backported (exceptions might apply).

For Parity's security disclosure process and Bug Bounty program, see [parity.io/bug-bounty](https://parity.io/bug-bounty).

## License

Licensed under [GPL-3.0-or-later](./LICENSE).
