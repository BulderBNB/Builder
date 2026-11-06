import { parseAbi } from "viem";

export const BuilderBountiesAbi = parseAbi([
  "function postBounty(string title, string briefLink, string rewardLabel, string category, uint64 deadline) returns (uint256 id)",
  "function claimBounty(uint256 id)",
  "function submitProof(uint256 id, string proofLink)",
  "function approveBounty(uint256 id)",
  "function reportNonPayment(uint256 id)",
  "function cancelBounty(uint256 id)",
  "function markExpired(uint256 id)",
  "function setBuilderProfile(bool available, string rate, string skills)",
  "function bountyCount() view returns (uint256)",
  "function bounties(uint256) view returns (address poster, address builder, string title, string briefLink, string rewardLabel, string category, uint64 deadline, uint8 status, string proofLink)",
  "function builderPoints(address) view returns (uint256)",
  "function buildersCompleted(address) view returns (uint256)",
  "function builderMissedStrikes(address) view returns (uint256)",
  "function builderBlacklisted(address) view returns (bool)",
  "function posterNonPaymentReports(address) view returns (uint256)",
  "function posterBlacklisted(address) view returns (bool)",
  "function openForWork(address) view returns (bool)",
  "function rateLabel(address) view returns (string)",
  "function skillsLabel(address) view returns (string)",
]);
