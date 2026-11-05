// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {FlapSharedIndexerV1} from "./FlapSharedIndexerV1.sol";

/// @title BuilderBounties
/// @notice An on-chain bounty board and builder reputation ledger. Payment and communication
///         happen off-platform (X, Telegram, a direct wallet transfer) — this contract never
///         holds funds. It only records the lifecycle of a bounty (posted, claimed, proof
///         submitted, approved) and turns that into points, a leaderboard, and a strike/blacklist
///         record, via the Flap Shared Indexer (FSI).
/// @dev Trust model:
///      - Deadline misses are objective (block.timestamp vs. a stored deadline), so missing one
///        auto-strikes the builder, and repeated strikes auto-blacklist them. No dispute needed —
///        the chain itself is the referee.
///      - Non-payment is NOT objective — we never see money move, so a report is just one wallet's
///        claim about another. Reports are logged permanently and publicly, but never
///        auto-blacklist a poster; that's an owner-reviewed action (see `setPosterBlacklisted`),
///        so one bad-faith report can't unilaterally destroy someone's reputation.
contract BuilderBounties is FlapSharedIndexerV1 {
    bytes32 constant NS_BUILDER_POINTS = "builderPoints"; // Template A -> top-builders leaderboard
    bytes32 constant NS_BOUNTY = "bounty";                // Template L -> full lifecycle feed per bounty
    bytes32 constant NS_ACTIVITY = "activity";            // Template G -> flat activity log

    enum Status { Open, Claimed, Submitted, Approved, Expired, Cancelled }

    struct Bounty {
        address poster;
        address builder;          // zero until claimed
        string title;             // short, on-chain
        string briefLink;         // link to the full brief (X post, doc, wherever)
        string rewardLabel;       // free text, e.g. "0.5 BNB" — payment itself is off-platform
        string category;          // free text, e.g. "dev", "design", "content", "community"
        uint64 deadline;
        Status status;
        string proofLink;         // set by the builder when they submit
    }

    uint256 public constant POINTS_PER_BOUNTY = 100;
    uint256 public constant STRIKES_TO_AUTO_BLACKLIST = 3;
    uint256 public constant MAX_TITLE_LEN = 120;
    uint256 public constant MAX_LINK_LEN = 300;

    address public owner;

    uint256 public bountyCount;
    mapping(uint256 => Bounty) public bounties;

    mapping(address => uint256) public builderPoints;
    mapping(address => uint256) public buildersCompleted;
    mapping(address => uint256) public builderMissedStrikes;
    mapping(address => bool) public builderBlacklisted;

    mapping(address => uint256) public posterNonPaymentReports;
    mapping(address => bool) public posterBlacklisted;

    event BountyPosted(uint256 indexed id, address indexed poster, string title);
    event BountyClaimed(uint256 indexed id, address indexed builder);
    event BountySubmitted(uint256 indexed id, address indexed builder, string proofLink);
    event BountyApproved(uint256 indexed id, address indexed poster, address indexed builder);
    event BountyCancelled(uint256 indexed id, address indexed poster);
    event BountyExpired(uint256 indexed id, address indexed builder);
    event NonPaymentReported(uint256 indexed id, address indexed poster, address indexed builder);
    event BuilderBlacklistUpdated(address indexed builder, bool blacklisted);
    event PosterBlacklistUpdated(address indexed poster, bool blacklisted);
    event OwnerUpdated(address indexed oldOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    // ---------------------------------------------------------------------
    // Posting and claiming
    // ---------------------------------------------------------------------

    /// @notice Post a new bounty. No funds are collected — the reward is paid off-platform once
    ///         the poster approves the submitted work.
    function postBounty(
        string calldata title,
        string calldata briefLink,
        string calldata rewardLabel,
        string calldata category,
        uint64 deadline
    ) external returns (uint256 id) {
        require(!posterBlacklisted[msg.sender], "poster blacklisted");
        require(bytes(title).length > 0 && bytes(title).length <= MAX_TITLE_LEN, "bad title");
        require(bytes(briefLink).length <= MAX_LINK_LEN, "brief link too long");
        require(deadline > block.timestamp, "deadline already passed");

        id = bountyCount++;
        bounties[id] = Bounty({
            poster: msg.sender,
            builder: address(0),
            title: title,
            briefLink: briefLink,
            rewardLabel: rewardLabel,
            category: category,
            deadline: deadline,
            status: Status.Open,
            proofLink: ""
        });

        _fsiAppend(NS_BOUNTY, id, 0, msg.sender, address(0), title);
        emit BountyPosted(id, msg.sender, title);
    }

    /// @notice Withdraw a bounty that nobody has claimed yet.
    function cancelBounty(uint256 id) external {
        Bounty storage b = bounties[id];
        require(b.poster == msg.sender, "not your bounty");
        require(b.status == Status.Open, "not open");

        b.status = Status.Cancelled;
        _fsiAppend(NS_BOUNTY, id, 1, msg.sender, address(0), "cancelled");
        emit BountyCancelled(id, msg.sender);
    }

    /// @notice Claim an open bounty. Contact details are exchanged off-platform from here.
    function claimBounty(uint256 id) external {
        Bounty storage b = bounties[id];
        require(b.poster != address(0), "no such bounty");
        require(b.status == Status.Open, "not open");
        require(block.timestamp < b.deadline, "deadline passed");
        require(!builderBlacklisted[msg.sender], "builder blacklisted");
        require(msg.sender != b.poster, "cannot claim your own bounty");

        b.builder = msg.sender;
        b.status = Status.Claimed;

        _fsiAppend(NS_BOUNTY, id, 2, msg.sender, b.poster, "claimed");
        emit BountyClaimed(id, msg.sender);
    }

    // ---------------------------------------------------------------------
    // Proof, approval, and the deadline strike
    // ---------------------------------------------------------------------

    /// @notice Submit a link to the finished work — a GitHub PR, an X post, whatever fits the
    ///         category. The contract never stores the work itself, only where to find it.
    function submitProof(uint256 id, string calldata proofLink) external {
        Bounty storage b = bounties[id];
        require(b.builder == msg.sender, "not your claim");
        require(b.status == Status.Claimed, "not claimed");
        require(bytes(proofLink).length > 0 && bytes(proofLink).length <= MAX_LINK_LEN, "bad link");

        b.proofLink = proofLink;
        b.status = Status.Submitted;

        _fsiAppend(NS_BOUNTY, id, 3, msg.sender, b.poster, proofLink);
        emit BountySubmitted(id, msg.sender, proofLink);
    }

    /// @notice Poster approves the submitted work. Banks the builder's points; payment itself
    ///         happens off-platform, same as everywhere else in this contract.
    function approveBounty(uint256 id) external {
        Bounty storage b = bounties[id];
        require(b.poster == msg.sender, "not your bounty");
        require(b.status == Status.Submitted, "not submitted");

        b.status = Status.Approved;

        builderPoints[b.builder] += POINTS_PER_BOUNTY;
        buildersCompleted[b.builder] += 1;
        _fsiSetAddr(NS_BUILDER_POINTS, b.builder, builderPoints[b.builder]);

        _fsiAppend(NS_BOUNTY, id, 4, msg.sender, b.builder, "approved");
        _fsiLog(NS_ACTIVITY, id, b.builder, b.poster, POINTS_PER_BOUNTY, 0);
        emit BountyApproved(id, msg.sender, b.builder);
    }

    /// @notice Anyone can call this once a bounty's deadline has passed without approval. If it
    ///         was claimed, the builder takes a strike — automatic, since the deadline itself is
    ///         the only referee needed here. Three strikes auto-blacklists them from claiming more.
    function markExpired(uint256 id) external {
        Bounty storage b = bounties[id];
        require(b.poster != address(0), "no such bounty");
        require(block.timestamp >= b.deadline, "not past deadline yet");
        require(
            b.status == Status.Open || b.status == Status.Claimed || b.status == Status.Submitted,
            "already finalized"
        );

        address missedBuilder = b.builder;
        b.status = Status.Expired;

        if (missedBuilder != address(0)) {
            builderMissedStrikes[missedBuilder] += 1;
            if (builderMissedStrikes[missedBuilder] >= STRIKES_TO_AUTO_BLACKLIST && !builderBlacklisted[missedBuilder]) {
                builderBlacklisted[missedBuilder] = true;
                emit BuilderBlacklistUpdated(missedBuilder, true);
            }
        }

        _fsiAppend(NS_BOUNTY, id, 5, msg.sender, missedBuilder, "expired");
        emit BountyExpired(id, missedBuilder);
    }

    /// @notice A builder reports that an approved bounty was never paid off-platform. This is a
    ///         claim, not proof — we have no way to see the payment either way — so it never
    ///         auto-blacklists anyone. It's logged permanently and publicly; blacklisting a poster
    ///         is a deliberate, reviewed call via `setPosterBlacklisted`.
    function reportNonPayment(uint256 id) external {
        Bounty storage b = bounties[id];
        require(b.builder == msg.sender, "not your claim");
        require(b.status == Status.Approved, "bounty not approved");

        posterNonPaymentReports[b.poster] += 1;
        _fsiLog(NS_ACTIVITY, id, msg.sender, b.poster, 0, 1); // extra = 1 marks "non-payment report"
        emit NonPaymentReported(id, b.poster, msg.sender);
    }

    // ---------------------------------------------------------------------
    // Owner moderation — a deliberate human check, not an auto-penalty, for anything that isn't
    // objectively provable on-chain (non-payment reports, spam, abuse). Deadline strikes above are
    // the one penalty that stays fully automatic, because the chain itself can verify them.
    // ---------------------------------------------------------------------

    function setBuilderBlacklisted(address builder, bool blacklisted) external onlyOwner {
        builderBlacklisted[builder] = blacklisted;
        emit BuilderBlacklistUpdated(builder, blacklisted);
    }

    function setPosterBlacklisted(address poster, bool blacklisted) external onlyOwner {
        posterBlacklisted[poster] = blacklisted;
        emit PosterBlacklistUpdated(poster, blacklisted);
    }

    function setOwner(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero address");
        emit OwnerUpdated(owner, newOwner);
        owner = newOwner;
    }
}
