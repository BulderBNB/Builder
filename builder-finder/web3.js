// ---------------------------------------------------------------------
// Builder Finder — wallet + contract wiring.
//
// CONTRACT_ADDRESS is empty until BuilderBounties.sol is actually deployed (see
// builder-finder/README.md for the Remix runbook). Until then, every read falls back to the
// static data/*.json files and every write stays a "Connect Wallet to Post"-style no-op — this
// matches exactly what the site has always said: "Posting opens once BuilderBounties.sol is
// live on-chain." Once a real address is pasted in below, reads and writes go on-chain
// automatically, no other code changes needed.
// ---------------------------------------------------------------------
(function (global) {
  var CONFIG = {
    CONTRACT_ADDRESS: '0x34f76bd241b16bbfac6fcc315336909a9527df7c', // live on BSC Testnet
    RPC_URL: 'https://data-seed-prebsc-1-s1.bnbchain.org:8545', // public BSC testnet RPC, read-only browsing without a wallet
    CHAIN_ID: 97 // BSC testnet; 56 for mainnet
  };
  // Test-only override seam — never set by the shipped site, only by local integration tests.
  if (global.__BF_TEST_CONFIG__) {
    for (var k in global.__BF_TEST_CONFIG__) CONFIG[k] = global.__BF_TEST_CONFIG__[k];
  }

  var ABI = [{"inputs": [], "stateMutability": "nonpayable", "type": "constructor"}, {"anonymous": false, "inputs": [{"indexed": true, "internalType": "uint256", "name": "id", "type": "uint256"}, {"indexed": true, "internalType": "address", "name": "poster", "type": "address"}, {"indexed": true, "internalType": "address", "name": "builder", "type": "address"}], "name": "BountyApproved", "type": "event"}, {"anonymous": false, "inputs": [{"indexed": true, "internalType": "uint256", "name": "id", "type": "uint256"}, {"indexed": true, "internalType": "address", "name": "poster", "type": "address"}], "name": "BountyCancelled", "type": "event"}, {"anonymous": false, "inputs": [{"indexed": true, "internalType": "uint256", "name": "id", "type": "uint256"}, {"indexed": true, "internalType": "address", "name": "builder", "type": "address"}], "name": "BountyClaimed", "type": "event"}, {"anonymous": false, "inputs": [{"indexed": true, "internalType": "uint256", "name": "id", "type": "uint256"}, {"indexed": true, "internalType": "address", "name": "builder", "type": "address"}], "name": "BountyExpired", "type": "event"}, {"anonymous": false, "inputs": [{"indexed": true, "internalType": "uint256", "name": "id", "type": "uint256"}, {"indexed": true, "internalType": "address", "name": "poster", "type": "address"}, {"indexed": false, "internalType": "string", "name": "title", "type": "string"}], "name": "BountyPosted", "type": "event"}, {"anonymous": false, "inputs": [{"indexed": true, "internalType": "uint256", "name": "id", "type": "uint256"}, {"indexed": true, "internalType": "address", "name": "builder", "type": "address"}, {"indexed": false, "internalType": "string", "name": "proofLink", "type": "string"}], "name": "BountySubmitted", "type": "event"}, {"anonymous": false, "inputs": [{"indexed": true, "internalType": "address", "name": "builder", "type": "address"}, {"indexed": false, "internalType": "bool", "name": "blacklisted", "type": "bool"}], "name": "BuilderBlacklistUpdated", "type": "event"}, {"anonymous": false, "inputs": [{"indexed": false, "internalType": "bytes32", "name": "ns", "type": "bytes32"}, {"indexed": false, "internalType": "address", "name": "key", "type": "address"}, {"indexed": false, "internalType": "uint256", "name": "value", "type": "uint256"}, {"indexed": false, "internalType": "string", "name": "data", "type": "string"}], "name": "FlapSharedIndexerAddrUint", "type": "event"}, {"anonymous": false, "inputs": [{"indexed": false, "internalType": "bytes32", "name": "ns", "type": "bytes32"}, {"indexed": false, "internalType": "uint256", "name": "id", "type": "uint256"}, {"indexed": false, "internalType": "uint256", "name": "seq", "type": "uint256"}, {"indexed": false, "internalType": "address", "name": "actor", "type": "address"}, {"indexed": false, "internalType": "address", "name": "related", "type": "address"}, {"indexed": false, "internalType": "uint256", "name": "value", "type": "uint256"}, {"indexed": false, "internalType": "string", "name": "data", "type": "string"}], "name": "FlapSharedIndexerFeed", "type": "event"}, {"anonymous": false, "inputs": [{"indexed": false, "internalType": "bytes32", "name": "ns", "type": "bytes32"}, {"indexed": false, "internalType": "uint256", "name": "id", "type": "uint256"}, {"indexed": false, "internalType": "address", "name": "actor", "type": "address"}, {"indexed": false, "internalType": "address", "name": "related", "type": "address"}, {"indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256"}, {"indexed": false, "internalType": "uint256", "name": "extra", "type": "uint256"}], "name": "FlapSharedIndexerLog", "type": "event"}, {"anonymous": false, "inputs": [{"indexed": false, "internalType": "bytes32", "name": "ns", "type": "bytes32"}, {"indexed": false, "internalType": "uint256", "name": "round", "type": "uint256"}, {"indexed": false, "internalType": "address", "name": "account", "type": "address"}, {"indexed": false, "internalType": "uint256", "name": "value", "type": "uint256"}, {"indexed": false, "internalType": "string", "name": "data", "type": "string"}], "name": "FlapSharedIndexerUintAddrUint", "type": "event"}, {"anonymous": false, "inputs": [{"indexed": true, "internalType": "uint256", "name": "id", "type": "uint256"}, {"indexed": true, "internalType": "address", "name": "poster", "type": "address"}, {"indexed": true, "internalType": "address", "name": "builder", "type": "address"}], "name": "NonPaymentReported", "type": "event"}, {"anonymous": false, "inputs": [{"indexed": true, "internalType": "address", "name": "oldOwner", "type": "address"}, {"indexed": true, "internalType": "address", "name": "newOwner", "type": "address"}], "name": "OwnerUpdated", "type": "event"}, {"anonymous": false, "inputs": [{"indexed": true, "internalType": "address", "name": "poster", "type": "address"}, {"indexed": false, "internalType": "bool", "name": "blacklisted", "type": "bool"}], "name": "PosterBlacklistUpdated", "type": "event"}, {"anonymous": false, "inputs": [{"indexed": true, "internalType": "address", "name": "builder", "type": "address"}, {"indexed": false, "internalType": "bool", "name": "openForWork", "type": "bool"}, {"indexed": false, "internalType": "string", "name": "rateLabel", "type": "string"}, {"indexed": false, "internalType": "string", "name": "skillsLabel", "type": "string"}], "name": "ProfileUpdated", "type": "event"}, {"inputs": [], "name": "MAX_LINK_LEN", "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"}, {"inputs": [], "name": "MAX_PROFILE_FIELD_LEN", "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"}, {"inputs": [], "name": "MAX_TITLE_LEN", "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"}, {"inputs": [], "name": "POINTS_PER_BOUNTY", "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"}, {"inputs": [], "name": "STRIKES_TO_AUTO_BLACKLIST", "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"}, {"inputs": [{"internalType": "uint256", "name": "id", "type": "uint256"}], "name": "approveBounty", "outputs": [], "stateMutability": "nonpayable", "type": "function"}, {"inputs": [{"internalType": "uint256", "name": "", "type": "uint256"}], "name": "bounties", "outputs": [{"internalType": "address", "name": "poster", "type": "address"}, {"internalType": "address", "name": "builder", "type": "address"}, {"internalType": "string", "name": "title", "type": "string"}, {"internalType": "string", "name": "briefLink", "type": "string"}, {"internalType": "string", "name": "rewardLabel", "type": "string"}, {"internalType": "string", "name": "category", "type": "string"}, {"internalType": "uint64", "name": "deadline", "type": "uint64"}, {"internalType": "enum BuilderBounties.Status", "name": "status", "type": "uint8"}, {"internalType": "string", "name": "proofLink", "type": "string"}], "stateMutability": "view", "type": "function"}, {"inputs": [], "name": "bountyCount", "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"}, {"inputs": [{"internalType": "address", "name": "", "type": "address"}], "name": "builderBlacklisted", "outputs": [{"internalType": "bool", "name": "", "type": "bool"}], "stateMutability": "view", "type": "function"}, {"inputs": [{"internalType": "address", "name": "", "type": "address"}], "name": "builderMissedStrikes", "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"}, {"inputs": [{"internalType": "address", "name": "", "type": "address"}], "name": "builderPoints", "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"}, {"inputs": [{"internalType": "address", "name": "", "type": "address"}], "name": "buildersCompleted", "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"}, {"inputs": [{"internalType": "uint256", "name": "id", "type": "uint256"}], "name": "cancelBounty", "outputs": [], "stateMutability": "nonpayable", "type": "function"}, {"inputs": [{"internalType": "uint256", "name": "id", "type": "uint256"}], "name": "claimBounty", "outputs": [], "stateMutability": "nonpayable", "type": "function"}, {"inputs": [], "name": "flapSharedIndexerSpecVersion", "outputs": [{"internalType": "string", "name": "", "type": "string"}], "stateMutability": "pure", "type": "function"}, {"inputs": [{"internalType": "uint256", "name": "id", "type": "uint256"}], "name": "markExpired", "outputs": [], "stateMutability": "nonpayable", "type": "function"}, {"inputs": [{"internalType": "address", "name": "", "type": "address"}], "name": "openForWork", "outputs": [{"internalType": "bool", "name": "", "type": "bool"}], "stateMutability": "view", "type": "function"}, {"inputs": [], "name": "owner", "outputs": [{"internalType": "address", "name": "", "type": "address"}], "stateMutability": "view", "type": "function"}, {"inputs": [{"internalType": "string", "name": "title", "type": "string"}, {"internalType": "string", "name": "briefLink", "type": "string"}, {"internalType": "string", "name": "rewardLabel", "type": "string"}, {"internalType": "string", "name": "category", "type": "string"}, {"internalType": "uint64", "name": "deadline", "type": "uint64"}], "name": "postBounty", "outputs": [{"internalType": "uint256", "name": "id", "type": "uint256"}], "stateMutability": "nonpayable", "type": "function"}, {"inputs": [{"internalType": "address", "name": "", "type": "address"}], "name": "posterBlacklisted", "outputs": [{"internalType": "bool", "name": "", "type": "bool"}], "stateMutability": "view", "type": "function"}, {"inputs": [{"internalType": "address", "name": "", "type": "address"}], "name": "posterNonPaymentReports", "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"}, {"inputs": [{"internalType": "address", "name": "", "type": "address"}], "name": "rateLabel", "outputs": [{"internalType": "string", "name": "", "type": "string"}], "stateMutability": "view", "type": "function"}, {"inputs": [{"internalType": "uint256", "name": "id", "type": "uint256"}], "name": "reportNonPayment", "outputs": [], "stateMutability": "nonpayable", "type": "function"}, {"inputs": [{"internalType": "address", "name": "builder", "type": "address"}, {"internalType": "bool", "name": "blacklisted", "type": "bool"}], "name": "setBuilderBlacklisted", "outputs": [], "stateMutability": "nonpayable", "type": "function"}, {"inputs": [{"internalType": "bool", "name": "available", "type": "bool"}, {"internalType": "string", "name": "rate", "type": "string"}, {"internalType": "string", "name": "skills", "type": "string"}], "name": "setBuilderProfile", "outputs": [], "stateMutability": "nonpayable", "type": "function"}, {"inputs": [{"internalType": "address", "name": "newOwner", "type": "address"}], "name": "setOwner", "outputs": [], "stateMutability": "nonpayable", "type": "function"}, {"inputs": [{"internalType": "address", "name": "poster", "type": "address"}, {"internalType": "bool", "name": "blacklisted", "type": "bool"}], "name": "setPosterBlacklisted", "outputs": [], "stateMutability": "nonpayable", "type": "function"}, {"inputs": [{"internalType": "address", "name": "", "type": "address"}], "name": "skillsLabel", "outputs": [{"internalType": "string", "name": "", "type": "string"}], "stateMutability": "view", "type": "function"}, {"inputs": [{"internalType": "uint256", "name": "id", "type": "uint256"}, {"internalType": "string", "name": "proofLink", "type": "string"}], "name": "submitProof", "outputs": [], "stateMutability": "nonpayable", "type": "function"}];

  var STATUS_NAMES = ['Open', 'Claimed', 'Submitted', 'Approved', 'Expired', 'Cancelled'];

  var readProvider = null;
  var browserProvider = null;
  var signer = null;
  var connectedAddress = null;

  function isLive() {
    return !!CONFIG.CONTRACT_ADDRESS;
  }

  function getReadProvider() {
    if (!readProvider) readProvider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
    return readProvider;
  }

  function getReadContract() {
    return new ethers.Contract(CONFIG.CONTRACT_ADDRESS, ABI, getReadProvider());
  }

  async function connectWallet() {
    if (!global.ethereum) {
      throw new Error('No wallet found. Install MetaMask (or a similar wallet) and reload.');
    }
    browserProvider = new ethers.BrowserProvider(global.ethereum);
    await browserProvider.send('eth_requestAccounts', []);
    signer = await browserProvider.getSigner();
    connectedAddress = await signer.getAddress();
    return connectedAddress;
  }

  function getConnectedAddress() {
    return connectedAddress;
  }

  function getWriteContract() {
    if (!signer) throw new Error('Wallet not connected.');
    return new ethers.Contract(CONFIG.CONTRACT_ADDRESS, ABI, signer);
  }

  function dateToUnix(dateStr) {
    return Math.floor(new Date(dateStr + 'T00:00:00Z').getTime() / 1000);
  }

  function unixToDate(unix) {
    return new Date(Number(unix) * 1000).toISOString().slice(0, 10);
  }

  async function fetchAllBounties() {
    if (!isLive()) return fetch('data/bounties.json').then(function (r) { return r.json(); });
    var c = getReadContract();
    var count = Number(await c.bountyCount());
    var list = [];
    for (var i = 0; i < count; i++) {
      var b = await c.bounties(i);
      list.push({
        id: i,
        poster: b.poster,
        builder: b.builder === '0x0000000000000000000000000000000000000000' ? '' : b.builder,
        title: b.title,
        briefLink: b.briefLink,
        rewardLabel: b.rewardLabel,
        category: b.category,
        deadline: unixToDate(b.deadline),
        status: STATUS_NAMES[Number(b.status)],
        proofLink: b.proofLink
      });
    }
    return list;
  }

  async function fetchProfile(addr) {
    if (!isLive()) {
      return fetch('data/profiles.json').then(function (r) { return r.json(); }).then(function (profiles) {
        return profiles[addr.toLowerCase()] || profiles[addr] || null;
      });
    }
    var c = getReadContract();
    var open = await c.openForWork(addr);
    var rate = await c.rateLabel(addr);
    var skills = await c.skillsLabel(addr);
    if (!open && !rate && !skills) return null;
    return { openForWork: open, rateLabel: rate, skillsLabel: skills };
  }

  async function postBounty(title, briefLink, rewardLabel, category, deadlineDateStr) {
    var c = getWriteContract();
    var tx = await c.postBounty(title, briefLink, rewardLabel, category, dateToUnix(deadlineDateStr));
    return tx.wait();
  }

  async function claimBounty(id) {
    var tx = await getWriteContract().claimBounty(id);
    return tx.wait();
  }

  async function submitProof(id, proofLink) {
    var tx = await getWriteContract().submitProof(id, proofLink);
    return tx.wait();
  }

  async function approveBounty(id) {
    var tx = await getWriteContract().approveBounty(id);
    return tx.wait();
  }

  async function reportNonPayment(id) {
    var tx = await getWriteContract().reportNonPayment(id);
    return tx.wait();
  }

  async function markExpired(id) {
    var tx = await getWriteContract().markExpired(id);
    return tx.wait();
  }

  async function setBuilderProfile(available, rate, skills) {
    var tx = await getWriteContract().setBuilderProfile(available, rate, skills);
    return tx.wait();
  }

  global.BuilderFinderWeb3 = {
    CONFIG: CONFIG,
    isLive: isLive,
    connectWallet: connectWallet,
    getConnectedAddress: getConnectedAddress,
    fetchAllBounties: fetchAllBounties,
    fetchProfile: fetchProfile,
    postBounty: postBounty,
    claimBounty: claimBounty,
    submitProof: submitProof,
    approveBounty: approveBounty,
    reportNonPayment: reportNonPayment,
    markExpired: markExpired,
    setBuilderProfile: setBuilderProfile
  };
})(window);
