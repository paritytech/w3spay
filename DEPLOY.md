# Deploy

Builds the SPA and publishes it as a `.dot` product via `bulletin-deploy`.

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
| `VITE_W3SPAY_REGISTRY_ADDRESS` | yes | Deployed `W3SPayRegistry` H160. |
| `VITE_NETWORK` | no | Defaults to `BULLETIN_ENV` (`paseo-next-v2`). Must match it. |
| `BULLETIN_DEPLOY_PUBLISH` | no | `true` = pass `--publish` (publicly discoverable). Default `false` = upload only. |

## Deploy

```bash
npm run deploy
# or override the domain for one run:
npm run deploy -- mydomain.dot
```

Domain resolution order: CLI arg > shell env > `.env.production.local` > `.env.production` > `.env.local` > `.env`.

The script builds (`tsc` + `vite build`), stamps the resolved domain into `dist/manifest.toml`, and runs `bulletin-deploy --env paseo-next-v2`.

Result: `https://<name>.dot.li`
