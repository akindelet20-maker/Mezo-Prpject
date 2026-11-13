const fs = require('node:fs');
const path = require('node:path');
const { JsonRpcProvider, FetchRequest, Wallet, ContractFactory } = require('ethers');
(async () => {
  if (!process.env.PRIVATE_KEY) throw new Error('Set PRIVATE_KEY locally, or use the webpage wallet deployment. Never commit a private key.');
  const request = new FetchRequest(process.env.MEZO_RPC_URL || 'https://rpc.test.mezo.org/');
  request.setHeader('User-Agent', 'MUSD-Ajo-Testnet-Prototype');
  const provider = new JsonRpcProvider(request, 31611, { staticNetwork: true });
  const actualChain = await provider.send('eth_chainId', []);
  if (BigInt(actualChain) !== 31611n) throw new Error('Refusing non-Mezo-testnet deployment.');
  const wallet = new Wallet(process.env.PRIVATE_KEY, provider);
  const result = { chainId: 31611, deployer: wallet.address, receipts: {} };
  for (const name of ['MusdAjo', ...(process.env.DEPLOY_DEMO_TOKEN === 'true' ? ['DemoMUSD'] : [])]) {
    const artifact = require(path.join(__dirname, '..', 'artifacts', name + '.json'));
    const deployed = await new ContractFactory(artifact.abi, artifact.bytecode, wallet).deploy();
    console.log(`${name} transaction: ${deployed.deploymentTransaction().hash}`);
    const receipt = await deployed.deploymentTransaction().wait();
    if (!receipt || receipt.status !== 1) throw new Error(`${name} deployment did not succeed. Inspect its transaction before retrying.`);
    await deployed.waitForDeployment();
    result[name] = await deployed.getAddress();
    result.receipts[name] = { hash: receipt.hash, blockNumber: receipt.blockNumber, status: receipt.status };
    console.log(`${name}: ${result[name]} (block ${receipt.blockNumber})`);
    fs.mkdirSync(path.join(__dirname, '..', 'deployments'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, '..', 'deployments', 'mezo-testnet.json'), JSON.stringify(result, null, 2) + '\n');
  }
  provider.destroy();
})().catch(error => { console.error(error.message); process.exitCode = 1; });
