// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {FlapSharedIndexerV1} from "./FlapSharedIndexerV1.sol";

/// @title BuilderBounties
/// @notice An on-chain bounty board and builder reputation ledger. Payment and communication
///         happen off-platform (X, Telegram, a direct wallet transfer) — this contract never
///         holds funds. It only records the lifecycle of a bounty (posted, applied to, selected,
///         proof submitted, approved) and turns that into points, a leaderboard, and a
///         strike/blacklist record, via the Flap Shared Indexer (FSI).
/// @dev Trust model:
///      - Deadline misses are objective (block.timestamp vs. a stored deadline), so missing one
///        auto-strikes the builder, and repeated strikes auto-blacklist them. No dispute needed —
///        the chain itself is the referee.
///      - Non-payment is NOT objective — we never see money move, so a report is just one wallet's
///        claim about another. One report per bounty, logged permanently and publicly, but never
///        auto-blacklists a poster; that's an owner-reviewed action (see `setPosterBlacklisted`),
///        so one bad-faith report can't unilaterally destroy someone's reputation.
///      - Claiming is apply-then-select, not first-come-first-served: any interested builder can
///        apply for free (no commitment), the poster picks one from the list. A selected builder
///        can voluntarily release the claim back to Open with no penalty if the deal falls through.
contract BuilderBounties is FlapSharedIndexerV1 {
    bytes32 constant NS_BUILDER_POINTS = "builderPoints"; // Template A -> top-builders leaderboard
    bytes32 constant NS_BOUNTY = "bounty";                // Template L -> full lifecycle feed per bounty
    bytes32 constant NS_ACTIVITY = "activity";            // Template G -> flat activity log

    enum Status { Open, Claimed, Submitted, Approved, Expired, Cancelled }

    struct Bounty {
        address poster;
        address builder;          // zero until selected
        string title;             // short, on-chain
        string briefLink;         // link to the full brief (X post, doc, wherever) — optional
        string rewardLabel;       // free text, e.g. "0.5 BNB" — payment itself is off-platform
        string category;          // free text, e.g. "dev", "design", "content", "community"
        uint64 deadline;
        Status status;
        string proofLink;         // set by the builder when they submit
        bool nonPaymentReported;  // one-shot guard — a builder can only report this bounty once
    }

    uint256 public constant POINTS_PER_BOUNTY = 100;
    uint256 public constant STRIKES_TO_AUTO_BLACKLIST = 3;
    uint256 public constant MAX_TITLE_LEN = 120;
    uint256 public constant MAX_LINK_LEN = 300;
    uint256 public constant MAX_PROFILE_FIELD_LEN = 160;
    uint256 public constant MAX_BOUNTY_DURATION = 30 days;
    uint256 public constant MAX_APPLICANTS = 30;

    address public owner;

    uint256 public bountyCount;
    mapping(uint256 => Bounty) public bounties;

    mapping(uint256 => address[]) private _applicants;
    mapping(uint256 => mapping(address => bool)) public hasApplied;

    mapping(address => uint256) public builderPoints;
    mapping(address => uint256) public buildersCompleted;
    mapping(address => uint256) public builderMissedStrikes;
    mapping(address => bool) public builderBlacklisted;

    mapping(address => uint256) public posterNonPaymentReports;
    mapping(address => bool) public posterBlacklisted;

    /// @notice Self-reported, unverified — same trust tier as a bounty's own reward label.
    ///         Not a guarantee of availability, rate, or identity, just a listing. Any address can
    ///         set its own profile, whether it's acting as a poster, a builder, or both.
    mapping(address => bool) public openForWork;
    mapping(address => string) public rateLabel;      // free text, e.g. "0.3-1 BNB per gig"
    mapping(address => string) public skillsLabel;    // free text, e.g. "Dev, Solidity"
    mapping(address => string) public xHandle;        // e.g. "@handle" — display only
    mapping(address => string) public tgHandle;       // e.g. "@handle" — display only
    mapping(address => string) public githubHandle;   // e.g. "octocat" — display only
    mapping(address => string) public portfolioLink;  // free text link — display only

    /// @notice Every address that has ever called setProfile, in first-call order — lets a
    ///         frontend list registered builders the same way it already lists bounties
    ///         (count + indexed getter), without needing an off-chain indexer.
    address[] private _registeredBuilders;
    mapping(address => bool) public isRegistered;

    /// @notice Posting, applying, and being selected all require this — nobody should be able to
    ///         act on a bounty while staying a bare, unreachable address. Checked live against
    ///         the real fields, not a one-time "did you ever call setProfile" flag, so clearing a
    ///         contact later (via `clearProfile`) re-blocks them too.
    function _hasContact(address who) private view returns (bool) {
        return bytes(xHandle[who]).length > 0 || bytes(tgHandle[who]).length > 0;
    }

    event BountyPosted(uint256 indexed id, address indexed poster, string title);
    event BountyApplied(uint256 indexed id, address indexed applicant);
    event BountySelected(uint256 indexed id, address indexed poster, address indexed builder);
    event BountyReleased(uint256 indexed id, address indexed builder);
    event BountySubmitted(uint256 indexed id, address indexed builder, string proofLink);
    event BountyApproved(uint256 indexed id, address indexed poster, address indexed builder);
    event BountyCancelled(uint256 indexed id, address indexed poster);
    event BountyRemoved(uint256 indexed id, address indexed owner);
    event BountyExpired(uint256 indexed id, address indexed builder);
    event NonPaymentReported(uint256 indexed id, address indexed poster, address indexed builder);
    event BuilderBlacklistUpdated(address indexed builder, bool blacklisted);
    event PosterBlacklistUpdated(address indexed poster, bool blacklisted);
    event OwnerUpdated(address indexed oldOwner, address indexed newOwner);
    /// @dev Kept lean (no string payload) to avoid stack-depth limits with setProfile's many
    ///      parameters — the fields themselves are read from storage via the public getters, not
    ///      from this event.
    event ProfileUpdated(address indexed who, bool openForWork);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    // ---------------------------------------------------------------------
    // Posting, applying, and selecting
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
        require(_hasContact(msg.sender), "set your X or Telegram first");
        require(bytes(title).length > 0 && bytes(title).length <= MAX_TITLE_LEN, "bad title");
        require(bytes(briefLink).length <= MAX_LINK_LEN, "brief link too long");
        require(deadline > block.timestamp, "deadline already passed");
        require(deadline <= block.timestamp + MAX_BOUNTY_DURATION, "deadline too far out");

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
            proofLink: "",
            nonPaymentReported: false
        });

        _fsiAppend(NS_BOUNTY, id, 0, msg.sender, address(0), title);
        emit BountyPosted(id, msg.sender, title);
    }

    /// @notice Withdraw a bounty that's still open — before anyone's been selected.
    function cancelBounty(uint256 id) external {
        Bounty storage b = bounties[id];
        require(b.poster == msg.sender, "not your bounty");
        require(b.status == Status.Open, "not open");

        b.status = Status.Cancelled;
        _fsiAppend(NS_BOUNTY, id, 1, msg.sender, address(0), "cancelled");
        emit BountyCancelled(id, msg.sender);
    }

    /// @notice Signal interest in an open bounty. Free of commitment on both sides — the poster
    ///         reviews whoever's applied and picks one via `selectBuilder`. Capped so the list
    ///         stays readable and bounded.
    function applyToBounty(uint256 id) external {
        Bounty storage b = bounties[id];
        require(b.poster != address(0), "no such bounty");
        require(b.status == Status.Open, "not open");
        require(block.timestamp < b.deadline, "deadline passed");
        require(!builderBlacklisted[msg.sender], "builder blacklisted");
        require(_hasContact(msg.sender), "set your X or Telegram first");
        require(msg.sender != b.poster, "cannot apply to your own bounty");
        require(!hasApplied[id][msg.sender], "already applied");
        require(_applicants[id].length < MAX_APPLICANTS, "too many applicants");

        hasApplied[id][msg.sender] = true;
        _applicants[id].push(msg.sender);

        emit BountyApplied(id, msg.sender);
    }

    /// @notice Read the list of addresses that applied to a bounty.
    function getApplicants(uint256 id) external view returns (address[] memory) {
        return _applicants[id];
    }

    /// @notice Poster picks who gets the job. The chosen address doesn't have to be someone who
    ///         called `applyToBounty` — the poster can assign it directly to anyone eligible.
    ///         Contact details are exchanged off-platform from here.
    function selectBuilder(uint256 id, address builder) external {
        Bounty storage b = bounties[id];
        require(b.poster == msg.sender, "not your bounty");
        require(b.status == Status.Open, "not open");
        require(block.timestamp < b.deadline, "deadline passed");
        require(builder != address(0) && builder != msg.sender, "bad builder");
        require(!builderBlacklisted[builder], "builder blacklisted");
        require(_hasContact(builder), "builder has no contact info set");

        b.builder = builder;
        b.status = Status.Claimed;

        _fsiAppend(NS_BOUNTY, id, 2, builder, b.poster, "selected");
        emit BountySelected(id, msg.sender, builder);
    }

    /// @notice The selected builder can hand the bounty back if the deal falls through — no
    ///         penalty, no strike. Reopens it for the poster to select someone else.
    function releaseBounty(uint256 id) external {
        Bounty storage b = bounties[id];
        require(b.builder == msg.sender, "not your claim");
        require(b.status == Status.Claimed, "not claimed");

        address released = b.builder;
        b.builder = address(0);
        b.status = Status.Open;

        _fsiAppend(NS_BOUNTY, id, 7, released, b.poster, "released");
        emit BountyReleased(id, released);
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
    ///         the only referee needed here. Three strikes auto-blacklists them from being
    ///         selected again.
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
    ///         auto-blacklists anyone, and it can only be filed once per bounty. It's logged
    ///         permanently and publicly; blacklisting a poster is a deliberate, reviewed call via
    ///         `setPosterBlacklisted`.
    function reportNonPayment(uint256 id) external {
        Bounty storage b = bounties[id];
        require(b.builder == msg.sender, "not your claim");
        require(b.status == Status.Approved, "bounty not approved");
        require(!b.nonPaymentReported, "already reported");

        b.nonPaymentReported = true;
        posterNonPaymentReports[b.poster] += 1;
        _fsiLog(NS_ACTIVITY, id, msg.sender, b.poster, 0, 1); // extra = 1 marks "non-payment report"
        emit NonPaymentReported(id, b.poster, msg.sender);
    }

    // ---------------------------------------------------------------------
    // Profile — forward-looking info (availability, rate, skills, contact) that can't be derived
    // from past bounty history, so it needs its own storage. Self-set, unverified, same trust
    // tier as a bounty's own reward label: a listing, not a guarantee. Any address can call this —
    // it's not restricted to addresses that have ever claimed a bounty.
    // ---------------------------------------------------------------------

    /// @dev A single struct parameter (not 7 separate ones) — keeps this under Solidity's
    ///      stack-depth limit for the legacy codegen, so no special compiler flags are needed.
    struct ProfileInput {
        bool available;
        string rate;
        string skills;
        string x;
        string tg;
        string github;
        string portfolio;
    }

    function setProfile(ProfileInput calldata input) external {
        require(bytes(input.rate).length <= MAX_PROFILE_FIELD_LEN, "rate too long");
        require(bytes(input.skills).length <= MAX_PROFILE_FIELD_LEN, "skills too long");
        require(bytes(input.x).length <= MAX_PROFILE_FIELD_LEN, "x handle too long");
        require(bytes(input.tg).length <= MAX_PROFILE_FIELD_LEN, "tg handle too long");
        require(bytes(input.github).length <= MAX_PROFILE_FIELD_LEN, "github handle too long");
        require(bytes(input.portfolio).length <= MAX_PROFILE_FIELD_LEN, "portfolio link too long");

        if (!isRegistered[msg.sender]) {
            isRegistered[msg.sender] = true;
            _registeredBuilders.push(msg.sender);
        }

        openForWork[msg.sender] = input.available;
        rateLabel[msg.sender] = input.rate;
        skillsLabel[msg.sender] = input.skills;
        xHandle[msg.sender] = input.x;
        tgHandle[msg.sender] = input.tg;
        githubHandle[msg.sender] = input.github;
        portfolioLink[msg.sender] = input.portfolio;

        emit ProfileUpdated(msg.sender, input.available);
    }

    function registeredBuilderCount() external view returns (uint256) {
        return _registeredBuilders.length;
    }

    /// @notice Indexed like `bounties` — read 0..registeredBuilderCount()-1 to list everyone.
    function registeredBuilderAt(uint256 index) external view returns (address) {
        return _registeredBuilders[index];
    }

    // ---------------------------------------------------------------------
    // Owner moderation — a deliberate human check, not an auto-penalty, for anything that isn't
    // objectively provable on-chain (non-payment reports, spam, abuse, fraudulent content).
    // Deadline strikes above are the one penalty that stays fully automatic, because the chain
    // itself can verify them. These are not exposed in the app's wallet policy — the owner calls
    // them directly (e.g. via a block explorer's "Write Contract" page), on purpose, to keep the
    // public-facing app free of any admin surface.
    // ---------------------------------------------------------------------

    function setBuilderBlacklisted(address builder, bool blacklisted) external onlyOwner {
        builderBlacklisted[builder] = blacklisted;
        emit BuilderBlacklistUpdated(builder, blacklisted);
    }

    function setPosterBlacklisted(address poster, bool blacklisted) external onlyOwner {
        posterBlacklisted[poster] = blacklisted;
        emit PosterBlacklistUpdated(poster, blacklisted);
    }

    /// @notice Force a bounty out of circulation regardless of its current state — for fraudulent
    ///         or abusive listings. Doesn't claw back points already awarded; it only stops the
    ///         listing from being shown as active going forward.
    function removeBounty(uint256 id) external onlyOwner {
        Bounty storage b = bounties[id];
        require(b.poster != address(0), "no such bounty");

        b.status = Status.Cancelled;
        _fsiAppend(NS_BOUNTY, id, 8, msg.sender, b.poster, "removed");
        emit BountyRemoved(id, msg.sender);
    }

    /// @notice Wipe an address's profile — for abusive bios or fraudulent contact info.
    function clearProfile(address who) external onlyOwner {
        openForWork[who] = false;
        rateLabel[who] = "";
        skillsLabel[who] = "";
        xHandle[who] = "";
        tgHandle[who] = "";
        githubHandle[who] = "";
        portfolioLink[who] = "";
        emit ProfileUpdated(who, false);
    }

    function setOwner(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero address");
        emit OwnerUpdated(owner, newOwner);
        owner = newOwner;
    }
}
