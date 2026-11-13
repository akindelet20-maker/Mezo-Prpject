# MUSD Ajo

A rotating savings-circle app for **Mezo testnet**, built with plain HTML, CSS, JavaScript, and Solidity. The page runtime lives in `site/`; only that folder should be hosted. No Webdev or GameDev tooling was used.

## Try it

Temporary public preview: https://panels-rehabilitation-peterson-patrol.trycloudflare.com/

The preview uses a temporary Cloudflare Tunnel and depends on the local server/tunnel staying active. It is not a permanent production deployment.

The homepage starts in a clearly labeled **Preview workspace** with sample data. Switch to **Mezo testnet** to read actual circles from the deployed factory without a wallet. To create, join, contribute, or claim, connect an EVM browser wallet to Mezo testnet.

## Deployed on Mezo testnet

Chain ID: **31611** (`0x7b7b`). Gas currency: **testnet BTC**.

| Contract | Address | Deployment |
| --- | --- | --- |
| Ajo factory | [0x14620673294cF7230D3583D916dc57810A0B3494](https://explorer.test.mezo.org/address/0x14620673294cF7230D3583D916dc57810A0B3494) | [Transaction](https://explorer.test.mezo.org/tx/0xd74249c54f8c415c4ff061ab0725faaaade47079dfe74c0eb861ca25ed970c72), block 16744108 |
| Ajo Demo USD (dMUSD) | [0xC76727373a56BB0dcEFdAc1Fde1F892A877add3b](https://explorer.test.mezo.org/token/0xC76727373a56BB0dcEFdAc1Fde1F892A877add3b) | [Transaction](https://explorer.test.mezo.org/tx/0x8d04e74fa67a350badccea1c0d902769c455e667ee0c123c088bd1eba49a40a6), block 16744110 |

Both deployment receipts returned status 1. Their on-chain runtime bytecode was compared byte-for-byte with the compiled source and matched. The public deployment configuration is versioned in `config/mezo-testnet.json`; no key is stored there. Neither contract has an administrator withdrawal or owner-only mint privilege.

## MUSD integration boundary

**Official MUSD is not enabled in this build.** Mezo's docs list testnet MUSD at `0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503`, and prior explorer research labeled it a stub. Direct official-RPC reads now confirm that it has bytecode and returns `Mezo USD`, `MUSD`, and 18 decimals. That confirms metadata availability, not a tested funding/transfer integration. This project has not claimed or exercised official-MUSD transfers.

The app instead defaults to the separate **Ajo Demo USD (dMUSD)** contract above and blocks the published MUSD address in its configuration flow. dMUSD is publicly mintable, has no monetary value, and is **not official MUSD**.

The source is unaudited and testnet-only. Never use real funds.

## Use the shared testnet deployment

1. Open **Testnet setup** (the sliders icon).
2. Connect or switch to Mezo Testnet. Get testnet BTC for gas from the [official faucet](https://faucet.test.mezo.org/).
3. The factory and dMUSD token addresses are already filled in. Select **Mint 1,000 dMUSD** and sign the testnet transaction.
4. Save the configuration, create a circle, and share its factory address and circle ID with your members.
5. Other wallets use the same addresses, mint demo tokens, and join. Once full, all members contribute the fixed amount each round.

Every write operation is a real testnet transaction requiring a wallet signature. Token approval and contribution are separate transactions; approvals request only the contribution amount. Optional buttons let users deploy a separate factory or demo token from their own wallets.

The page never asks for, stores, or transmits private keys. Configuration, preview data, and browser-initiated activity history are stored locally. Clearing browser storage removes those local records, not on-chain records. Activity is not a complete indexed transaction history.

## Run and test locally

Node 20+ and Python 3 are recommended.

```sh
npm ci
npm test
npm run serve
```

Open `http://localhost:4173`. The build uses Solidity 0.8.28, optimizer enabled, and `evmVersion: london`, following Mezo's deployment guidance.

**Ten local contract tests pass**, covering initialization, joining, exact contributions, recipient rotation, completion, duplicate prevention, early-refund rejection, timeout refunds, current-round-only refunds, and accounting isolation across circles using one token. A separate static review found no critical issue in the stated conventional-ERC20 flow; that is not an audit or a production-safety guarantee.

**The live Mezo testnet smoke test also passed:** an automatic [10 dMUSD full-pot payout](https://explorer.test.mezo.org/tx/0x6ace2f51d934b0505be112ee1dd80891aee01a401056ce3c5c98af2b79a05443), followed by a [5 dMUSD current-round timeout refund](https://explorer.test.mezo.org/tx/0x46807bcd371b7cd1f4199daa4793a17ec028de435783a24ed3b99635ebe638bc). The final state was expired, with no residual pot and no repeat refund eligibility.

The scripts are `scripts/smoke-testnet.cjs` and the guarded refund-only recovery helper `scripts/resume-refund.cjs`. Transaction hashes and assertions are recorded in `config/mezo-testnet-smoke.json`, whose `complete` field is true. Tests use project-only test wallets and valueless dMUSD. Timeout waiting and interface status use Mezo block time rather than assuming the local clock matches the node.

The browser demo creation, final-contribution payout simulation, refund simulation, and public-RPC circle loading were also exercised through the hosted page. Browser-wallet write controls are implemented; the connected preview browser itself has no injected wallet, so actual testnet writes were verified using the CLI instead.

## Optional CLI deployment

Build, set `PRIVATE_KEY` securely in your local shell, then run:

```sh
npm run build
DEPLOY_DEMO_TOKEN=true npm run deploy:testnet
```

The script defaults to `https://rpc.test.mezo.org/`, checks the actual chain ID, and refuses anything other than 31611. `MEZO_RPC_URL` can override the endpoint. Never commit a private key. CLI receipts are written to `deployments/mezo-testnet.json` (ignored by git); curated public defaults live in `config/`.

## Circle rules and risks

- Contribution, membership cap (2–20), and round duration (1 minute–90 days) are fixed when created.
- The creator is first in payout order. Joining is permissionless until capacity is reached; join order sets later turns.
- No funds are collected while places remain open. The first deadline starts only when the group is full.
- Each member pays once per round. The last contribution triggers the full-pot payout automatically.
- One cycle pays each member once, then completes.
- An incomplete timed-out round ends the circle. Anyone can mark it expired, or an eligible contributor can expire and claim in one transaction.
- Refunds return only that member's payment in the current incomplete round. Past full-pot payouts are not reversed.
- There is no collateral, insurance, yield, credit scoring, or guarantee that someone who received early will continue contributing. **Member default is a fundamental risk. Save only with people you trust.**
- Conventional ERC-20s only. Incoming fee-on-transfer tokens are rejected; rebasing, malicious, and other nonstandard tokens are unsupported.
- The live interface reads the newest 30 circles in the selected factory.

## Sources and assets

- [Official Mezo developer guide](https://mezo.org/docs/developers/getting-started/)
- [Official environment/deployment setup](https://mezo.org/docs/developers/getting-started/configure-environment/)
- [Official contract/token reference](https://mezo.org/docs/users/resources/contracts-reference/)
- [Published testnet MUSD explorer page](https://explorer.test.mezo.org/token/0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503)
- [Akindo Wave Hacks challenge](https://app.akindo.io/wave-hacks/OVOO0gdrVU8379D10)

The small Mezo footer mark was collected from Mezo's official documentation asset repository. Fonts load from Google Fonts; ethers is pinned and bundled locally. `site/` contains only files loaded by the page. Solidity source, test files, keys, and Node dependencies are outside the hosted root.

## GitHub

Nothing has been pushed because no repository destination was supplied. Provide the target GitHub URL or `owner/repo` before pushing.
