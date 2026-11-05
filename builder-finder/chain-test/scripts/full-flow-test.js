const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

const RPC = 'http://127.0.0.1:8546';
const artifact = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'artifact.json'), 'utf8'));

function assertEq(actual, expected, label) {
  const a = actual.toString();
  const e = expected.toString();
  if (a !== e) {
    console.error(`FAIL: ${label} — expected ${e}, got ${a}`);
    process.exitCode = 1;
  } else {
    console.log(`OK: ${label} = ${a}`);
  }
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const net = await provider.getNetwork();
  console.log('Connected to local chain, chainId =', net.chainId.toString());

  // Hardhat's well-known default accounts (local test chain only — never real funds)
  const keys = [
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', // deployer/owner
    '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', // poster
    '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a', // builder
    '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6', // builder2 (for strike test)
  ];
  const [deployer, poster, builder, builder2] = keys.map(k => new ethers.Wallet(k, provider));

  // ethers v6's automatic nonce resolution goes stale across rapid sequential sends from
  // different signers sharing one script/provider — track nonces ourselves, locally, since
  // this script is fully sequential (no concurrency) so a plain counter is exact.
  const nonces = {};
  for (const w of [deployer, poster, builder, builder2]) {
    nonces[w.address] = await provider.getTransactionCount(w.address, 'latest');
  }
  async function send(wallet, contractAsWallet, method, args) {
    const nonce = nonces[wallet.address]++;
    const tx = await contractAsWallet[method](...args, { nonce });
    return tx.wait();
  }

  console.log('\n--- Deploy ---');
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, deployer);
  const contract = await factory.deploy({ nonce: nonces[deployer.address]++ });
  await contract.waitForDeployment();
  const addr = await contract.getAddress();
  console.log('Deployed BuilderBounties at', addr);
  assertEq(await contract.owner(), deployer.address, 'owner is deployer');

  console.log('\n--- postBounty ---');
  const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour out
  await send(poster, contract.connect(poster), 'postBounty', ['Design a banner', 'https://x.com/example', '0.5 BNB', 'Design', deadline]);
  assertEq(await contract.bountyCount(), 1, 'bountyCount after post');
  let b = await contract.bounties(0);
  assertEq(b.poster, poster.address, 'bounty0.poster');
  assertEq(b.status, 0, 'bounty0.status == Open');

  console.log('\n--- claimBounty ---');
  await send(builder, contract.connect(builder), 'claimBounty', [0]);
  b = await contract.bounties(0);
  assertEq(b.builder, builder.address, 'bounty0.builder');
  assertEq(b.status, 1, 'bounty0.status == Claimed');

  console.log('\n--- submitProof ---');
  await send(builder, contract.connect(builder), 'submitProof', [0, 'https://github.com/example/pr/1']);
  b = await contract.bounties(0);
  assertEq(b.status, 2, 'bounty0.status == Submitted');
  assertEq(b.proofLink, 'https://github.com/example/pr/1', 'bounty0.proofLink');

  console.log('\n--- approveBounty ---');
  await send(poster, contract.connect(poster), 'approveBounty', [0]);
  b = await contract.bounties(0);
  assertEq(b.status, 3, 'bounty0.status == Approved');
  assertEq(await contract.builderPoints(builder.address), 100, 'builderPoints after 1 approval');
  assertEq(await contract.buildersCompleted(builder.address), 1, 'buildersCompleted after 1 approval');

  console.log('\n--- reportNonPayment (logged, no auto-blacklist) ---');
  await send(builder, contract.connect(builder), 'reportNonPayment', [0]);
  assertEq(await contract.posterNonPaymentReports(poster.address), 1, 'posterNonPaymentReports');
  assertEq(await contract.posterBlacklisted(poster.address), false, 'poster NOT auto-blacklisted');

  console.log('\n--- setBuilderProfile ---');
  await send(builder, contract.connect(builder), 'setBuilderProfile', [true, '0.2-0.5 BNB per gig', 'Design, Figma']);
  assertEq(await contract.openForWork(builder.address), true, 'openForWork');
  assertEq(await contract.rateLabel(builder.address), '0.2-0.5 BNB per gig', 'rateLabel');
  assertEq(await contract.skillsLabel(builder.address), 'Design, Figma', 'skillsLabel');

  console.log('\n--- cancelBounty (open bounty, poster withdraws) ---');
  await send(poster, contract.connect(poster), 'postBounty', ['Write docs', '', '20 USDT', 'Content', deadline]);
  await send(poster, contract.connect(poster), 'cancelBounty', [1]);
  b = await contract.bounties(1);
  assertEq(b.status, 5, 'bounty1.status == Cancelled');

  console.log('\n--- markExpired + auto-strike + auto-blacklist at 3 strikes ---');
  for (let i = 0; i < 3; i++) {
    const latestBlock = await provider.getBlock('latest');
    const shortDeadline = latestBlock.timestamp + 5; // 5 chain-seconds out, immune to wall-clock drift
    await send(poster, contract.connect(poster), 'postBounty', ['Expiring job ' + i, '', '1 BNB', 'Dev', shortDeadline]);
    const id = 2 + i;
    await send(builder2, contract.connect(builder2), 'claimBounty', [id]);
    await provider.send('evm_increaseTime', [10]); // jump chain clock, not wall clock — instant
    await provider.send('evm_mine', []);
    await send(deployer, contract.connect(deployer), 'markExpired', [id]);
    const strikes = await contract.builderMissedStrikes(builder2.address);
    console.log(`  after expiry ${i + 1}: strikes = ${strikes}`);
  }
  assertEq(await contract.builderMissedStrikes(builder2.address), 3, 'builder2 strikes == 3');
  assertEq(await contract.builderBlacklisted(builder2.address), true, 'builder2 auto-blacklisted at 3 strikes');

  console.log('\n--- blacklisted builder cannot claim new bounties ---');
  await send(poster, contract.connect(poster), 'postBounty', ['New job', '', '1 BNB', 'Dev', deadline]);
  const newId = 5;
  let reverted = false;
  try {
    await send(builder2, contract.connect(builder2), 'claimBounty', [newId]);
  } catch (e) {
    reverted = true;
  }
  assertEq(reverted, true, 'blacklisted builder2 claim reverts');

  console.log('\n--- owner moderation: setPosterBlacklisted ---');
  await send(deployer, contract.connect(deployer), 'setPosterBlacklisted', [poster.address, true]);
  assertEq(await contract.posterBlacklisted(poster.address), true, 'poster manually blacklisted');
  reverted = false;
  try {
    await send(poster, contract.connect(poster), 'postBounty', ['Should fail', '', '1 BNB', 'Dev', deadline]);
  } catch (e) {
    reverted = true;
  }
  assertEq(reverted, true, 'blacklisted poster postBounty reverts');

  console.log('\n--- Final summary ---');
  console.log('Total bounties posted:', (await contract.bountyCount()).toString());
  console.log('Contract address for frontend testing:', addr);
  console.log(process.exitCode === 1 ? '\n*** SOME CHECKS FAILED ***' : '\nALL CHECKS PASSED');
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
