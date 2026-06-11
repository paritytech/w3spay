# Deploy

Builds the SPA and publishes it as a `.dot` product via `bulletin-deploy`.

## Guided deploy (`npm run setup`)

```bash
npm install
cp .env.example .env.local   # optional — the wizard prompts for anything missing
npm run setup
```

`npm run setup` is an interactive wizard that runs the whole pipeline from a
single repo-root `.env.local`: **environment** (Node ≥ 22, `bulletin-deploy`) →
**configure** (network, domain, optional registry override, publisher mnemonic,
and whether to list the app in the Browse directory — written back to
`.env.local`) → **readiness** (Asset Hub RPC reachable) → **build & publish**
(`deploy.sh` → `bulletin-deploy`). Re-running reuses the saved choices.

| Flag | Effect |
| --- | --- |
| `--network <key>` (`--env <key>`) | `paseo` \| `paseo-next-v2` \| `previewnet`. |
| `--domain <name[.dot]>` | Target domain; `.dot` is appended if missing. |
| `--publish` / `--no-publish` | List (or not) the `.dot` in the on-chain Publisher registry — the Browse directory (`paseo-next-v2` only). Default: the saved/`.env` value, else off. |
| `--yes` (`-y`, `--non-interactive`) | No prompts. Every required value must come from `.env.local`/flags. |
| `--dry-run` | Run environment + configure + readiness checks only. Writes nothing. |

Non-interactive (CI):

```bash
npm run setup -- --network paseo-next-v2 --domain w3spay.dot --yes
```

## Prerequisites

- Node ≥ 22
- `npm install` (pins `bulletin-deploy@^0.10.0`; the script requires ≥ 0.10.0)

## Configure

```bash
cp .env.example .env.local
```

Set in `.env.local` (gitignored — never commit a mnemonic):

| Variable | Required | Notes |
| --- | --- | --- |
| `MNEMONIC` or `DOTNS_MNEMONIC` | yes | 12- or 24-word publisher phrase. If both set, must match. |
| `VITE_DOTNS_PRODUCT_DOMAIN` | yes | Target domain, e.g. `w3spay.dot`. No default. |
| `VITE_W3SPAY_REGISTRY_ADDRESS` | no | Deployed `W3SPayRegistry` H160. Defaulted in `src/config.ts`; override per environment. |
| `VITE_NETWORK` | no | Defaults to `BULLETIN_ENV` (`paseo-next-v2`). Must match it. |
| `BULLETIN_DEPLOY_PUBLISH` | no | `true` = pass `--publish` (publicly discoverable). Default `false` = upload only. |

## Manual deploy (`npm run deploy`)

```bash
npm run deploy
# or override the domain for one run:
npm run deploy -- mydomain.dot
```

Domain resolution order: CLI arg > shell env > `.env.production.local` > `.env.production` > `.env.local` > `.env`.

The script builds (`tsc` + `vite build`), stamps the resolved domain into `dist/manifest.toml`, and runs `bulletin-deploy --env paseo-next-v2`.

Result: `https://<name>.dot.li`
