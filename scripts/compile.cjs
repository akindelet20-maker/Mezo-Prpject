const fs = require('node:fs');
const path = require('node:path');
const solc = require('solc');
const root = path.resolve(__dirname, '..');
const input = {
  language: 'Solidity',
  sources: Object.fromEntries(['MusdAjo.sol', 'DemoMUSD.sol'].map(name => [name, { content: fs.readFileSync(path.join(root, 'contracts', name), 'utf8') }])),
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: 'london',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } }
  }
};
const output = JSON.parse(solc.compile(JSON.stringify(input)));
for (const error of output.errors || []) console.log(error.formattedMessage);
if ((output.errors || []).some(error => error.severity === 'error')) process.exit(1);
fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
const contracts = {};
for (const [filename, name] of [['MusdAjo.sol', 'MusdAjo'], ['DemoMUSD.sol', 'DemoMUSD']]) {
  const c = output.contracts[filename][name];
  contracts[name] = { abi: c.abi, bytecode: '0x' + c.evm.bytecode.object };
  fs.writeFileSync(path.join(root, 'artifacts', name + '.json'), JSON.stringify({ contractName: name, compiler: solc.version(), evmVersion: 'london', ...contracts[name], deployedBytecode: '0x' + c.evm.deployedBytecode.object }, null, 2) + '\n');
  console.log(`${name}: ${c.evm.bytecode.object.length / 2} byte deployment, ${c.evm.deployedBytecode.object.length / 2} byte runtime`);
}
let defaults = { factory: '', token: '', demoToken: false };
const configPath = path.join(root, 'config', 'mezo-testnet.json');
if (fs.existsSync(configPath)) {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (config.chainId !== 31611) throw new Error('Browser defaults must use Mezo testnet.');
  defaults = { factory: config.factory, token: config.token, demoToken: config.demoToken === true };
}
fs.writeFileSync(path.join(root, 'site', 'deployment.js'), 'window.AJO_CONTRACTS = ' + JSON.stringify(contracts) + ';\nwindow.AJO_DEFAULTS = ' + JSON.stringify(defaults) + ';\n');
fs.copyFileSync(path.join(root, 'node_modules', 'ethers', 'dist', 'ethers.umd.min.js'), path.join(root, 'site', 'ethers.umd.min.js'));
console.log('Built London-targeted artifacts, confirmed public deployment defaults, and browser bundle.');
