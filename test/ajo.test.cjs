const test = require('node:test');
const assert = require('node:assert/strict');
const ganache = require('ganache');
const { BrowserProvider, ContractFactory, parseEther } = require('ethers');
const ajoArtifact = require('../artifacts/MusdAjo.json');
const tokenArtifact = require('../artifacts/DemoMUSD.json');

async function fixture(memberCount = 3) {
  const rpc = ganache.provider({ logging: { quiet: true }, chain: { hardfork: 'london' }, wallet: { totalAccounts: 6 } });
  const provider = new BrowserProvider(rpc);
  provider.pollingInterval = 10;
  const people = await Promise.all(Array.from({ length: 6 }, (_, i) => provider.getSigner(i)));
  const token = await new ContractFactory(tokenArtifact.abi, tokenArtifact.bytecode, people[0]).deploy();
  await token.waitForDeployment();
  const ajo = await new ContractFactory(ajoArtifact.abi, ajoArtifact.bytecode, people[0]).deploy();
  await ajo.waitForDeployment();
  const amount = parseEther('25');
  for (const p of people.slice(0, 4)) {
    await (await token.mint(await p.getAddress(), parseEther('1000'))).wait();
    await (await token.connect(p).approve(await ajo.getAddress(), parseEther('1000'))).wait();
  }
  await (await ajo.createCircle('The Test Circle', await token.getAddress(), amount, memberCount, 60)).wait();
  return { rpc, provider, people, token, ajo, amount };
}
async function fill(f, id = 0, count = 3) {
  for (let i = 1; i < count; i++) await (await f.ajo.connect(f.people[i]).joinCircle(id)).wait();
}
async function reject(tx) { await assert.rejects(async () => { const t = await tx(); if (t.wait) await t.wait(); }); }

test('creates a circle with creator first and no deposits before the group is full', async () => {
  const f = await fixture();
  const c = await f.ajo.getCircle(0);
  assert.equal(c.status, 0n); assert.equal(c.members.length, 1); assert.equal(c.deadline, 0n);
  assert.equal(c.members[0], await f.people[0].getAddress());
  assert.equal(await f.token.balanceOf(await f.ajo.getAddress()), 0n);
  await reject(() => f.ajo.contribute(0));
});

test('starts only at full membership and rejects duplicate/late joins', async () => {
  const f = await fixture();
  await reject(() => f.ajo.joinCircle(0));
  await fill(f);
  const c = await f.ajo.getCircle(0);
  assert.equal(c.status, 1n); assert.ok(c.deadline > 0n); assert.equal(c.members.length, 3);
  await reject(() => f.ajo.connect(f.people[3]).joinCircle(0));
});

test('rejects invalid circle parameters and unknown IDs', async () => {
  const f = await fixture();
  await reject(() => f.ajo.createCircle('', awaitAddress(f.people[0]), 1, 3, 60));
  await reject(() => f.ajo.createCircle('Invalid', '0x0000000000000000000000000000000000000000', 1, 3, 60));
  await reject(() => f.ajo.createCircle('Invalid', f.token.target, 1, 1, 60));
  await reject(() => f.ajo.createCircle('Invalid', f.token.target, 1, 3, 59));
  await assert.rejects(() => f.ajo.getCircle(99));
});
function awaitAddress(person) { return person.address; }

test('accepts each member exactly once and excludes nonmembers', async () => {
  const f = await fixture(); await fill(f);
  await (await f.ajo.contribute(0)).wait();
  assert.equal((await f.ajo.getCircle(0)).paidCount, 1n);
  assert.equal((await f.ajo.getMemberState(0, f.people[0].address)).hasContributed, true);
  await reject(() => f.ajo.contribute(0));
  await reject(() => f.ajo.connect(f.people[3]).contribute(0));
});

test('pays the exact full pot to the first member and advances the round', async () => {
  const f = await fixture(); await fill(f);
  for (const p of f.people.slice(0, 3)) await (await f.ajo.connect(p).contribute(0)).wait();
  assert.equal(await f.token.balanceOf(f.people[0].address), parseEther('1050'));
  assert.equal(await f.token.balanceOf(f.ajo.target), 0n);
  const c = await f.ajo.getCircle(0);
  assert.equal(c.round, 1n); assert.equal(c.paidCount, 0n); assert.equal(c.status, 1n);
  assert.equal((await f.ajo.getMemberState(0, f.people[0].address)).hasContributed, false);
});

test('rotates recipients, pays everyone once, and completes one cycle', async () => {
  const f = await fixture(); await fill(f);
  for (let round = 0; round < 3; round++) for (const p of f.people.slice(0, 3)) await (await f.ajo.connect(p).contribute(0)).wait();
  for (const p of f.people.slice(0, 3)) assert.equal(await f.token.balanceOf(p.address), parseEther('1000'));
  const c = await f.ajo.getCircle(0);
  assert.equal(c.status, 2n); assert.equal(c.round, 3n); assert.equal(c.deadline, 0n);
  await reject(() => f.ajo.contribute(0));
  await reject(() => f.ajo.claimRefund(0));
});

test('does not allow early timeout or early refunds', async () => {
  const f = await fixture(); await fill(f); await (await f.ajo.contribute(0)).wait();
  await reject(() => f.ajo.expireCircle(0));
  await reject(() => f.ajo.claimRefund(0));
});

test('refunds a timed-out incomplete round in one call and forbids repeat claims', async () => {
  const f = await fixture(); await fill(f); await (await f.ajo.contribute(0)).wait();
  await f.rpc.request({ method: 'evm_increaseTime', params: [61] }); await f.rpc.request({ method: 'evm_mine', params: [] });
  assert.equal((await f.ajo.getMemberState(0, f.people[0].address)).canRefund, true);
  await (await f.ajo.claimRefund(0)).wait();
  assert.equal(await f.token.balanceOf(f.people[0].address), parseEther('1000'));
  assert.equal((await f.ajo.getCircle(0)).status, 3n);
  await reject(() => f.ajo.claimRefund(0));
  await reject(() => f.ajo.connect(f.people[1]).claimRefund(0));
  await reject(() => f.ajo.connect(f.people[1]).contribute(0));
});

test('refunds only the current round, not payments from a previously paid round', async () => {
  const f = await fixture(); await fill(f);
  for (const p of f.people.slice(0, 3)) await (await f.ajo.connect(p).contribute(0)).wait();
  await (await f.ajo.connect(f.people[1]).contribute(0)).wait();
  await f.rpc.request({ method: 'evm_increaseTime', params: [61] }); await f.rpc.request({ method: 'evm_mine', params: [] });
  await (await f.ajo.expireCircle(0)).wait();
  await reject(() => f.ajo.claimRefund(0));
  await (await f.ajo.connect(f.people[1]).claimRefund(0)).wait();
  assert.equal(await f.token.balanceOf(f.people[1].address), parseEther('975'));
  assert.equal(await f.token.balanceOf(f.ajo.target), 0n);
});

test('keeps an incomplete pot intact while another circle with the same token pays', async () => {
  const f = await fixture(2); await fill(f, 0, 2);
  await (await f.ajo.createCircle('Another circle', f.token.target, f.amount, 2, 60)).wait();
  await fill(f, 1, 2);
  await (await f.ajo.contribute(0)).wait();
  await (await f.ajo.contribute(1)).wait();
  await (await f.ajo.connect(f.people[1]).contribute(1)).wait();
  assert.equal(await f.token.balanceOf(f.ajo.target), f.amount);
  assert.equal((await f.ajo.getCircle(0)).paidCount, 1n);
});
