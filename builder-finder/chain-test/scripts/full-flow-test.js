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

function assertReverts(promise, label) {
  return promise.then(
    () => {
      console.error(`FAIL: ${label} — expected a revert, but it succeeded`);
      process.exitCode = 1;
    },
    () => {
      console.log(`OK: ${label} reverted as expected`);
    },
  );
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

  // ethers v6's own getTransactionCount caches its response internally and can return a stale
  // value even right after an awaited, mined transaction. A raw provider.send() bypasses that
  // cache entirely, so this is genuinely fresh on every call.
  async function nextNonce(wallet) {
    const hex = await provider.send('eth_getTransactionCount', [wallet.address, 'latest']);
    return parseInt(hex, 16);
  }
  // Same caching problem as getTransactionCount — provider.getBlock('latest') can return a stale
  // cached block. Raw eth_getBlockByNumber avoids it.
  async function latestTimestamp() {
    const block = await provider.send('eth_getBlockByNumber', ['latest', false]);
    return parseInt(block.timestamp, 16);
  }
  async function send(wallet, contractAsWallet, method, args) {
    const nonce = await nextNonce(wallet);
    const tx = await contractAsWallet[method](...args, { nonce });
    return tx.wait();
  }

  // A fifth, freshly generated wallet for the "two applicants, poster picks one" test — funded
  // from the deployer since it starts with zero balance.
  const builder3 = ethers.Wallet.createRandom().connect(provider);
  await (await deployer.sendTransaction({ to: builder3.address, value: ethers.parseEther('1'), nonce: await nextNonce(deployer) })).wait();

  console.log('\n--- Deploy ---');
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, deployer);
  const contract = await factory.deploy({ nonce: await nextNonce(deployer) });
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

  console.log('\n--- postBounty rejects a deadline more than 30 days out ---');
  const tooFar = Math.floor(Date.now() / 1000) + 31 * 24 * 3600;
  await assertReverts(
    send(poster, contract.connect(poster), 'postBounty', ['Too far out', '', '1 BNB', 'Dev', tooFar]),
    'postBounty with deadline > 30 days',
  );

  console.log('\n--- apply / select flow (two applicants, poster picks one) ---');
  await send(builder, contract.connect(builder), 'applyToBounty', [0]);
  await send(builder3, contract.connect(builder3), 'applyToBounty', [0]);
  let applicants = await contract.getApplicants(0);
  assertEq(applicants.length, 2, 'bounty0 has 2 applicants');
  assertEq(applicants[0], builder.address, 'applicant 0 is builder');
  assertEq(applicants[1], builder3.address, 'applicant 1 is builder3');

  await assertReverts(
    send(builder, contract.connect(builder), 'applyToBounty', [0]),
    'duplicate apply reverts',
  );

  await send(poster, contract.connect(poster), 'selectBuilder', [0, builder.address]);
  b = await contract.bounties(0);
  assertEq(b.builder, builder.address, 'bounty0.builder after select');
  assertEq(b.status, 1, 'bounty0.status == Claimed');

  console.log('\n--- releaseBounty (builder backs out, no penalty) ---');
  await send(builder, contract.connect(builder), 'releaseBounty', [0]);
  b = await contract.bounties(0);
  assertEq(b.status, 0, 'bounty0.status back to Open after release');
  assertEq(b.builder, ethers.ZeroAddress, 'bounty0.builder cleared after release');
  assertEq(await contract.builderMissedStrikes(builder.address), 0, 'release gives no strike');

  console.log('\n--- poster re-selects (direct assign, no fresh apply needed) ---');
  await send(poster, contract.connect(poster), 'selectBuilder', [0, builder3.address]);
  b = await contract.bounties(0);
  assertEq(b.builder, builder3.address, 'bounty0.builder is builder3 after re-select');

  console.log('\n--- submitProof ---');
  await send(builder3, contract.connect(builder3), 'submitProof', [0, 'https://github.com/example/pr/1']);
  b = await contract.bounties(0);
  assertEq(b.status, 2, 'bounty0.status == Submitted');
  assertEq(b.proofLink, 'https://github.com/example/pr/1', 'bounty0.proofLink');

  console.log('\n--- approveBounty ---');
  await send(poster, contract.connect(poster), 'approveBounty', [0]);
  b = await contract.bounties(0);
  assertEq(b.status, 3, 'bounty0.status == Approved');
  assertEq(await contract.builderPoints(builder3.address), 100, 'builderPoints after 1 approval');
  assertEq(await contract.buildersCompleted(builder3.address), 1, 'buildersCompleted after 1 approval');

  console.log('\n--- reportNonPayment: works once, reverts on a second call (replay-guard fix) ---');
  await send(builder3, contract.connect(builder3), 'reportNonPayment', [0]);
  assertEq(await contract.posterNonPaymentReports(poster.address), 1, 'posterNonPaymentReports after 1st report');
  assertEq(await contract.posterBlacklisted(poster.address), false, 'poster NOT auto-blacklisted');
  await assertReverts(
    send(builder3, contract.connect(builder3), 'reportNonPayment', [0]),
    'second reportNonPayment on the same bounty reverts',
  );
  assertEq(await contract.posterNonPaymentReports(poster.address), 1, 'posterNonPaymentReports still 1 after blocked replay');

  console.log('\n--- setProfile (struct input, incl. X/TG/GitHub/portfolio) ---');
  await send(builder, contract.connect(builder), 'setProfile', [{
    available: true,
    rate: '0.2-0.5 BNB per gig',
    skills: 'Design, Figma',
    x: '@builderHandle',
    tg: '@builder_tg',
    github: 'builderOctocat',
    portfolio: 'https://builder.example',
  }]);
  assertEq(await contract.openForWork(builder.address), true, 'openForWork');
  assertEq(await contract.rateLabel(builder.address), '0.2-0.5 BNB per gig', 'rateLabel');
  assertEq(await contract.skillsLabel(builder.address), 'Design, Figma', 'skillsLabel');
  assertEq(await contract.xHandle(builder.address), '@builderHandle', 'xHandle');
  assertEq(await contract.tgHandle(builder.address), '@builder_tg', 'tgHandle');
  assertEq(await contract.githubHandle(builder.address), 'builderOctocat', 'githubHandle');
  assertEq(await contract.portfolioLink(builder.address), 'https://builder.example', 'portfolioLink');

  console.log('\n--- owner clearProfile ---');
  await send(deployer, contract.connect(deployer), 'clearProfile', [builder.address]);
  assertEq(await contract.xHandle(builder.address), '', 'xHandle cleared by owner');
  assertEq(await contract.skillsLabel(builder.address), '', 'skillsLabel cleared by owner');

  console.log('\n--- cancelBounty (open bounty, poster withdraws) ---');
  await send(poster, contract.connect(poster), 'postBounty', ['Write docs', '', '20 USDT', 'Content', deadline]);
  await send(poster, contract.connect(poster), 'cancelBounty', [1]);
  b = await contract.bounties(1);
  assertEq(b.status, 5, 'bounty1.status == Cancelled');

  console.log('\n--- owner removeBounty (force-remove regardless of state) ---');
  await send(poster, contract.connect(poster), 'postBounty', ['Scammy listing', '', '1 BNB', 'Dev', deadline]);
  const scamId = 2;
  await send(deployer, contract.connect(deployer), 'removeBounty', [scamId]);
  b = await contract.bounties(scamId);
  assertEq(b.status, 5, 'scam bounty forced to Cancelled by owner');

  console.log('\n--- markExpired + auto-strike + auto-blacklist at 3 strikes (via apply/select) ---');
  for (let i = 0; i < 3; i++) {
    const shortDeadline = (await latestTimestamp()) + 60; // comfortably past the real time this iteration's several round trips take
    await send(poster, contract.connect(poster), 'postBounty', ['Expiring job ' + i, '', '1 BNB', 'Dev', shortDeadline]);
    const id = 3 + i;
    await send(builder2, contract.connect(builder2), 'applyToBounty', [id]);
    await send(poster, contract.connect(poster), 'selectBuilder', [id, builder2.address]);
    await provider.send('evm_increaseTime', [70]); // jump chain clock past the 60s deadline above — instant
    await provider.send('evm_mine', []);
    await send(deployer, contract.connect(deployer), 'markExpired', [id]);
    const strikes = await contract.builderMissedStrikes(builder2.address);
    console.log(`  after expiry ${i + 1}: strikes = ${strikes}`);
  }
  assertEq(await contract.builderMissedStrikes(builder2.address), 3, 'builder2 strikes == 3');
  assertEq(await contract.builderBlacklisted(builder2.address), true, 'builder2 auto-blacklisted at 3 strikes');

  console.log('\n--- blacklisted builder cannot apply or be selected ---');
  await send(poster, contract.connect(poster), 'postBounty', ['New job', '', '1 BNB', 'Dev', deadline]);
  const newId = 6;
  await assertReverts(
    send(builder2, contract.connect(builder2), 'applyToBounty', [newId]),
    'blacklisted builder2 applyToBounty reverts',
  );
  await assertReverts(
    send(poster, contract.connect(poster), 'selectBuilder', [newId, builder2.address]),
    'selecting a blacklisted builder reverts',
  );

  console.log('\n--- owner moderation: setPosterBlacklisted ---');
  await send(deployer, contract.connect(deployer), 'setPosterBlacklisted', [poster.address, true]);
  assertEq(await contract.posterBlacklisted(poster.address), true, 'poster manually blacklisted');
  await assertReverts(
    send(poster, contract.connect(poster), 'postBounty', ['Should fail', '', '1 BNB', 'Dev', deadline]),
    'blacklisted poster postBounty reverts',
  );

  console.log('\n--- Final summary ---');
  console.log('Total bounties posted:', (await contract.bountyCount()).toString());
  console.log('Contract address for frontend testing:', addr);
  console.log(process.exitCode === 1 ? '\n*** SOME CHECKS FAILED ***' : '\nALL CHECKS PASSED');
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
