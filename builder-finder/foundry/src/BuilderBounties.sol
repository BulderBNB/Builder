// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {FlapSharedIndexerV1} from "./FlapSharedIndexerV1.sol";

/// @title BuilderBounties
/// @notice An on-chain bounty board and builder reputation ledger. Payment and communication
///         happen off-platform (X, Telegram, a direct wallet transfer) — this contract never
///         holds funds. It only records the lifecycle of a bounty (posted, applied to, selected,
///         proof submitted, approved) and turns that into points, a leaderboard, and a
///         strike/blacklist record, via the Flap Shared Indexer (FSI).
/// @dev Upgradeable (UUPS) behind a proxy, per Flap's platform requirement. The Flap Guardian is a
///      hardcoded constant — there is no setter, it cannot be passed as a constructor/initializer
///      argument, and nothing (including the owner) can remove or replace it. The Guardian can call
///      every owner-moderation function, is the only caller that can reassign or revoke the owner
///      role, and is the only caller that can authorize an upgrade. The owner can still hand off its
///      own role voluntarily via a two-step transferOwnership/acceptOwnership, which the Guardian can
///      always override.
/// @dev Trust model (unchanged from the non-upgradeable version):
///      - Deadline misses are objective (block.timestamp vs. a stored deadline), so missing one
///        auto-strikes the builder, and repeated strikes auto-blacklist them. This only applies
///        while a bounty is still Open or Claimed — once a builder has submitted proof on time, a
///        strike would punish the wrong side, so `markExpired` can never touch a Submitted bounty.
///      - A Submitted bounty does not stay in limbo forever if the poster goes silent:
///        `claimAbandonedSubmission` lets the builder claim approval themselves after
///        REVIEW_TIMEOUT has passed with no response.
///      - Non-payment is NOT objective — we never see money move, so a report is just one wallet's
///        claim about another. One report per bounty, logged permanently and publicly, but never
///        auto-blacklists a poster; that's a reviewed moderation action.
///      - Claiming is apply-then-select: a builder must apply before they can be selected, and
///        selecting/releasing both require at least MIN_SELECT_LEAD_TIME left before the deadline,
///        so nobody can be struck for a bounty they never had a real chance to act on.
///      - Blacklisting gates entry points (post, apply, select, setProfile) but does not retroactively
///        block approving or finishing work already in progress — a builder who delivered keeps that
///        credit even if a moderation action happens against either party mid-job.
///      - The 30-applicant cap counts only active applicants: withdrawing, being released, being
///        rejected, or being purged as a blacklisted applicant all free the slot back up.
contract BuilderBounties is UUPSUpgradeable, FlapSharedIndexerV1 {
    /// @notice The official Flap Guardian on BSC. Hardcoded on purpose — no setter exists, it is
    ///         never accepted as a constructor or initializer argument, and no function (including
    ///         any owner function) can change it.
    address public constant GUARDIAN = 0x9e27098dcD8844bcc6287a557E0b4D09C86B8a4b;

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
        uint64 submittedAt;       // 0 until submitProof; feeds the claimAbandonedSubmission timeout
        Status status;
        string proofLink;         // set by the builder when they submit
        bool nonPaymentReported;  // one-shot guard — a builder can only report this bounty once
    }

    uint256 public constant POINTS_PER_BOUNTY = 100;
    uint256 public constant STRIKES_TO_AUTO_BLACKLIST = 3;
    uint256 public constant MAX_TITLE_LEN = 120;
    uint256 public constant MAX_LINK_LEN = 300;
    uint256 public constant MAX_REWARD_LABEL_LEN = 80;
    uint256 public constant MAX_CATEGORY_LEN = 80;
    uint256 public constant MAX_PROFILE_FIELD_LEN = 160;
    /// @dev Kept strictly longer than MIN_SELECT_LEAD_TIME: if the two were equal, a bounty posted
    ///      at exactly the minimum could only ever be selected in the same block it was posted in.
    uint256 public constant MIN_POST_DURATION = 48 hours;
    uint256 public constant MIN_SELECT_LEAD_TIME = 24 hours;
    uint256 public constant MAX_BOUNTY_DURATION = 30 days;
    uint256 public constant MAX_APPLICANTS = 30;
    /// @notice How long a Submitted bounty can sit unreviewed before the builder can claim approval
    ///         themselves via `claimAbandonedSubmission`.
    uint256 public constant REVIEW_TIMEOUT = 14 days;

    address public owner;
    /// @notice Set by the owner's own `transferOwnership`; the two-step handover completes only
    ///         when this address calls `acceptOwnership`. The Guardian's `setOwner`/`revokeOwner`
    ///         bypass this entirely and clear any pending transfer.
    address public pendingOwner;

    uint256 public bountyCount;
    mapping(uint256 => Bounty) public bounties;

    mapping(uint256 => address[]) private _applicants;
    /// @dev 1-based index of an address within `_applicants[id]`; 0 means "not currently in the
    ///      list". Lets `_removeApplicant` do an O(1) swap-and-pop instead of a linear scan.
    mapping(uint256 => mapping(address => uint256)) private _applicantIndex;
    mapping(uint256 => mapping(address => bool)) public hasApplied;

    /// @notice Per-bounty FSI (Template L) sequence counter — every `_fsiAppend` call for a given
    ///         bounty id must use a value that's never been used before for that id.
    mapping(uint256 => uint256) private _bountySeq;

    function _nextSeq(uint256 id) private returns (uint256) {
        return _bountySeq[id]++;
    }

    mapping(address => uint256) public builderPoints;
    mapping(address => uint256) public buildersCompleted;
    mapping(address => uint256) public builderMissedStrikes;
    mapping(address => bool) public builderBlacklisted;

    mapping(address => uint256) public posterNonPaymentReports;
    mapping(address => bool) public posterBlacklisted;

    /// @notice Self-reported, unverified — same trust tier as a bounty's own reward label.
    mapping(address => bool) public openForWork;
    mapping(address => string) public rateLabel;      // free text, e.g. "0.3-1 BNB per gig"
    mapping(address => string) public skillsLabel;    // free text, e.g. "Dev, Solidity"
    mapping(address => string) public xHandle;        // e.g. "@handle" — display only
    mapping(address => string) public tgHandle;       // e.g. "@handle" — display only
    mapping(address => string) public githubHandle;   // e.g. "octocat" — display only
    mapping(address => string) public portfolioLink;  // free text link — display only

    /// @notice Every address that has ever called setProfile, in first-call order.
    address[] private _registeredBuilders;
    mapping(address => bool) public isRegistered;

    /// @notice Posting, applying, and being selected all require this. Checked live against the
    ///         real fields, so clearing a contact later (via `clearProfile`) re-blocks them too.
    function _hasContact(address who) private view returns (bool) {
        return bytes(xHandle[who]).length > 0 || bytes(tgHandle[who]).length > 0;
    }

    event BountyPosted(uint256 indexed id, address indexed poster, string title);
    event BountyApplied(uint256 indexed id, address indexed applicant);
    event ApplicationWithdrawn(uint256 indexed id, address indexed applicant);
    event ApplicantRemoved(uint256 indexed id, address indexed applicant, address indexed by);
    event BountySelected(uint256 indexed id, address indexed poster, address indexed builder);
    event BountyReleased(uint256 indexed id, address indexed builder);
    event BountySubmitted(uint256 indexed id, address indexed builder, string proofLink);
    event BountyApproved(uint256 indexed id, address indexed poster, address indexed builder);
    event BountyAutoApproved(uint256 indexed id, address indexed builder);
    event BountyProofRejected(uint256 indexed id, address indexed poster, address indexed builder);
    event BountyCancelled(uint256 indexed id, address indexed poster);
    event BountyRemoved(uint256 indexed id, address indexed remover);
    event BountyExpired(uint256 indexed id, address indexed builder);
    event NonPaymentReported(uint256 indexed id, address indexed poster, address indexed builder);
    event BuilderBlacklistUpdated(address indexed builder, bool blacklisted);
    event PosterBlacklistUpdated(address indexed poster, bool blacklisted);
    event OwnerUpdated(address indexed oldOwner, address indexed newOwner);
    event OwnershipTransferStarted(address indexed oldOwner, address indexed pendingOwner);
    /// @dev Kept lean (no string payload) to avoid stack-depth limits with setProfile's many
    ///      parameters — the fields themselves are read from storage via the public getters.
    event ProfileUpdated(address indexed who, bool openForWork);

    modifier onlyOwnerOrGuardian() {
        require(msg.sender == owner || msg.sender == GUARDIAN, "not authorized");
        _;
    }

    modifier onlyGuardian() {
        require(msg.sender == GUARDIAN, "not guardian");
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address initialOwner) external initializer {
        require(initialOwner != address(0), "zero address");
        owner = initialOwner;
    }

    function _authorizeUpgrade(address) internal view override onlyGuardian {}

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
        require(bytes(rewardLabel).length <= MAX_REWARD_LABEL_LEN, "reward text too long");
        require(bytes(category).length <= MAX_CATEGORY_LEN, "category too long");
        require(deadline >= block.timestamp + MIN_POST_DURATION, "deadline too soon");
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
            submittedAt: 0,
            status: Status.Open,
            proofLink: "",
            nonPaymentReported: false
        });

        _fsiAppend(NS_BOUNTY, id, _nextSeq(id), msg.sender, address(0), title);
        emit BountyPosted(id, msg.sender, title);
    }

    /// @notice Withdraw a bounty that's still open — before anyone's been selected.
    function cancelBounty(uint256 id) external {
        Bounty storage b = bounties[id];
        require(b.poster == msg.sender, "not your bounty");
        require(b.status == Status.Open, "not open");

        b.status = Status.Cancelled;
        _fsiAppend(NS_BOUNTY, id, _nextSeq(id), msg.sender, address(0), "cancelled");
        emit BountyCancelled(id, msg.sender);
    }

    /// @notice Signal interest in an open bounty. Free of commitment on both sides — the poster
    ///         reviews whoever's applied and picks one via `selectBuilder`. Capped at MAX_APPLICANTS
    ///         active applicants; withdrawing, being released, rejected, or purged all free a slot.
    function applyToBounty(uint256 id) external {
        Bounty storage b = bounties[id];
        require(b.poster != address(0), "no such bounty");
        require(b.status == Status.Open, "not open");
        require(block.timestamp < b.deadline, "deadline passed");
        require(!builderBlacklisted[msg.sender], "builder blacklisted");
        require(!posterBlacklisted[b.poster], "poster blacklisted");
        require(_hasContact(msg.sender), "set your X or Telegram first");
        require(msg.sender != b.poster, "cannot apply to your own bounty");
        require(!hasApplied[id][msg.sender], "already applied");
        require(_applicants[id].length < MAX_APPLICANTS, "too many applicants");

        hasApplied[id][msg.sender] = true;
        _applicants[id].push(msg.sender);
        _applicantIndex[id][msg.sender] = _applicants[id].length;

        emit BountyApplied(id, msg.sender);
    }

    /// @notice A builder can withdraw their own application any time before being selected,
    ///         freeing their slot back up.
    function withdrawApplication(uint256 id) external {
        require(hasApplied[id][msg.sender], "not an applicant");
        require(bounties[id].builder != msg.sender, "already selected, use releaseBounty");
        _removeApplicant(id, msg.sender);
        emit ApplicationWithdrawn(id, msg.sender);
    }

    /// @notice The poster can remove a specific applicant while the bounty is still Open — the only
    ///         way to clear spam out of a full applicant list before selecting someone.
    function removeApplicant(uint256 id, address who) external {
        Bounty storage b = bounties[id];
        require(b.poster == msg.sender, "not your bounty");
        require(b.status == Status.Open, "not open");
        require(hasApplied[id][who], "not an applicant");
        _removeApplicant(id, who);
        emit ApplicantRemoved(id, who, msg.sender);
    }

    /// @notice Owner/Guardian cleanup: drop a now-blacklisted builder from one bounty's applicant
    ///         list. Bounded to a single bounty per call since a builder could be listed on many.
    function purgeBlacklistedApplicant(uint256 id, address who) external onlyOwnerOrGuardian {
        require(builderBlacklisted[who], "not blacklisted");
        require(hasApplied[id][who], "not an applicant");
        _removeApplicant(id, who);
        emit ApplicantRemoved(id, who, msg.sender);
    }

    function _removeApplicant(uint256 id, address who) private {
        uint256 idx = _applicantIndex[id][who];
        uint256 len = _applicants[id].length;
        address last = _applicants[id][len - 1];
        _applicants[id][idx - 1] = last;
        _applicantIndex[id][last] = idx;
        _applicants[id].pop();
        delete _applicantIndex[id][who];
        hasApplied[id][who] = false;
    }

    /// @notice Read the list of addresses currently applied to a bounty. Order is not preserved
    ///         across removals (a removal swaps the last entry into the removed slot).
    function getApplicants(uint256 id) external view returns (address[] memory) {
        return _applicants[id];
    }

    /// @notice Poster picks who gets the job, from among the addresses that applied. Requires at
    ///         least MIN_SELECT_LEAD_TIME left before the deadline, so the builder always has a
    ///         real window to act once selected. Contact details are exchanged off-platform from
    ///         here.
    function selectBuilder(uint256 id, address builder) external {
        Bounty storage b = bounties[id];
        require(b.poster == msg.sender, "not your bounty");
        require(!posterBlacklisted[msg.sender], "poster blacklisted");
        require(b.status == Status.Open, "not open");
        require(b.deadline >= block.timestamp + MIN_SELECT_LEAD_TIME, "not enough time left to select");
        require(builder != address(0) && builder != msg.sender, "bad builder");
        require(!builderBlacklisted[builder], "builder blacklisted");
        require(hasApplied[id][builder], "builder must apply first");
        require(_hasContact(builder), "builder has no contact info set");

        b.builder = builder;
        b.status = Status.Claimed;

        _fsiAppend(NS_BOUNTY, id, _nextSeq(id), builder, b.poster, "selected");
        emit BountySelected(id, msg.sender, builder);
    }

    /// @notice The selected builder can hand the bounty back if the deal falls through — no
    ///         penalty, no strike. Requires the same MIN_SELECT_LEAD_TIME lead time as selecting,
    ///         so a builder can't release at the last second to dodge the strike `markExpired`
    ///         would otherwise give them while leaving the poster no time to pick someone else.
    ///         Clears the released builder's application too, so a stale "yes" can't be reused to
    ///         select (and strike) them again without a fresh, deliberate re-application.
    function releaseBounty(uint256 id) external {
        Bounty storage b = bounties[id];
        require(b.builder == msg.sender, "not your claim");
        require(b.status == Status.Claimed, "not claimed");
        require(b.deadline >= block.timestamp + MIN_SELECT_LEAD_TIME, "too close to deadline to release");

        address released = b.builder;
        b.builder = address(0);
        b.status = Status.Open;
        if (hasApplied[id][released]) {
            _removeApplicant(id, released);
        }

        _fsiAppend(NS_BOUNTY, id, _nextSeq(id), released, b.poster, "released");
        emit BountyReleased(id, released);
    }

    // ---------------------------------------------------------------------
    // Proof, approval, and the deadline strike
    // ---------------------------------------------------------------------

    /// @notice Submit a link to the finished work. Must happen before the deadline — submitting
    ///         after it has passed would otherwise let a builder dodge a strike just by beating
    ///         whoever calls `markExpired` to the punch.
    function submitProof(uint256 id, string calldata proofLink) external {
        Bounty storage b = bounties[id];
        require(b.builder == msg.sender, "not your claim");
        require(b.status == Status.Claimed, "not claimed");
        require(block.timestamp < b.deadline, "deadline passed");
        require(bytes(proofLink).length > 0 && bytes(proofLink).length <= MAX_LINK_LEN, "bad link");

        b.proofLink = proofLink;
        b.status = Status.Submitted;
        b.submittedAt = uint64(block.timestamp);

        _fsiAppend(NS_BOUNTY, id, _nextSeq(id), msg.sender, b.poster, proofLink);
        emit BountySubmitted(id, msg.sender, proofLink);
    }

    /// @notice Poster approves the submitted work. Banks the builder's points; payment itself
    ///         happens off-platform. Not gated by either party's blacklist status — a moderation
    ///         action taken mid-job must not be able to erase credit for work already delivered.
    function approveBounty(uint256 id) external {
        Bounty storage b = bounties[id];
        require(b.poster == msg.sender, "not your bounty");
        require(b.status == Status.Submitted, "not submitted");

        b.status = Status.Approved;
        _awardPoints(id, b);
    }

    /// @notice If a poster never reviews a Submitted bounty, the builder isn't stuck forever: once
    ///         REVIEW_TIMEOUT has passed with no approval or rejection, the builder can claim the
    ///         approval themselves.
    function claimAbandonedSubmission(uint256 id) external {
        Bounty storage b = bounties[id];
        require(b.builder == msg.sender, "not your claim");
        require(b.status == Status.Submitted, "not submitted");
        require(block.timestamp >= b.submittedAt + REVIEW_TIMEOUT, "review window still open");

        b.status = Status.Approved;
        _awardPoints(id, b);
        emit BountyAutoApproved(id, msg.sender);
    }

    function _awardPoints(uint256 id, Bounty storage b) private {
        builderPoints[b.builder] += POINTS_PER_BOUNTY;
        buildersCompleted[b.builder] += 1;
        _fsiSetAddr(NS_BUILDER_POINTS, b.builder, builderPoints[b.builder]);

        _fsiAppend(NS_BOUNTY, id, _nextSeq(id), b.poster, b.builder, "approved");
        _fsiLog(NS_ACTIVITY, id, b.builder, b.poster, POINTS_PER_BOUNTY, 0);
        emit BountyApproved(id, b.poster, b.builder);
    }

    /// @notice Poster rejects submitted work instead of approving it — no strike, since a rejection
    ///         isn't an objective, chain-verifiable fact the way a missed deadline is. If there's
    ///         still enough time left, the bounty reopens (clearing the rejected builder's
    ///         application) so the poster can pick someone else; if the deadline has already
    ///         passed, it goes straight to Expired instead of reopening to a bounty nobody could
    ///         ever be selected for.
    function rejectProof(uint256 id) external {
        Bounty storage b = bounties[id];
        require(b.poster == msg.sender, "not your bounty");
        require(b.status == Status.Submitted, "not submitted");

        address rejected = b.builder;
        bool pastDeadline = block.timestamp >= b.deadline;

        b.builder = address(0);
        b.proofLink = "";
        b.submittedAt = 0;
        b.status = pastDeadline ? Status.Expired : Status.Open;

        if (!pastDeadline && hasApplied[id][rejected]) {
            _removeApplicant(id, rejected);
        }

        _fsiAppend(NS_BOUNTY, id, _nextSeq(id), rejected, b.poster, pastDeadline ? "rejected-expired" : "rejected");
        emit BountyProofRejected(id, msg.sender, rejected);
    }

    /// @notice Anyone can call this once a bounty's deadline has passed without approval, as long
    ///         as it's still Open or Claimed. If it was Claimed, the builder takes a strike —
    ///         automatic, since the deadline itself is the only referee needed here. Three strikes
    ///         auto-blacklists them from being selected again. A Submitted bounty is deliberately
    ///         excluded: the builder already delivered on time, so a strike there would punish the
    ///         wrong side; `approveBounty`/`rejectProof`/`claimAbandonedSubmission` cover that case.
    function markExpired(uint256 id) external {
        Bounty storage b = bounties[id];
        require(b.poster != address(0), "no such bounty");
        require(block.timestamp >= b.deadline, "not past deadline yet");
        require(b.status == Status.Open || b.status == Status.Claimed, "already finalized");

        address missedBuilder = b.builder;
        b.status = Status.Expired;

        if (missedBuilder != address(0)) {
            builderMissedStrikes[missedBuilder] += 1;
            if (builderMissedStrikes[missedBuilder] >= STRIKES_TO_AUTO_BLACKLIST && !builderBlacklisted[missedBuilder]) {
                builderBlacklisted[missedBuilder] = true;
                emit BuilderBlacklistUpdated(missedBuilder, true);
            }
        }

        _fsiAppend(NS_BOUNTY, id, _nextSeq(id), msg.sender, missedBuilder, "expired");
        emit BountyExpired(id, missedBuilder);
    }

    /// @notice A builder reports that an approved bounty was never paid off-platform. This is a
    ///         claim, not proof, so it never auto-blacklists anyone, and can only be filed once
    ///         per bounty. Blacklisting a poster is a deliberate, reviewed moderation action.
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
    // from past bounty history. Self-set, unverified, same trust tier as a bounty's own reward
    // label: a listing, not a guarantee.
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
        require(!builderBlacklisted[msg.sender] && !posterBlacklisted[msg.sender], "blacklisted");
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
    // Owner / Guardian moderation — the Guardian can call everything below that the owner can,
    // plus reassign or revoke the owner outright. Nothing here can touch funds; the contract holds
    // none. Moderation functions are not exposed in the app's wallet policy — the owner/Guardian
    // calls them directly, on purpose, to keep the public-facing app free of any admin surface.
    // ---------------------------------------------------------------------

    function setBuilderBlacklisted(address builder, bool blacklisted) external onlyOwnerOrGuardian {
        builderBlacklisted[builder] = blacklisted;
        if (!blacklisted) {
            // A clean slate on unblacklisting — otherwise one more missed deadline would
            // immediately re-blacklist them off a strike count from before the review.
            builderMissedStrikes[builder] = 0;
        }
        emit BuilderBlacklistUpdated(builder, blacklisted);
    }

    function setPosterBlacklisted(address poster, bool blacklisted) external onlyOwnerOrGuardian {
        posterBlacklisted[poster] = blacklisted;
        emit PosterBlacklistUpdated(poster, blacklisted);
    }

    /// @notice Force a bounty out of circulation regardless of its current state — for fraudulent
    ///         or abusive listings. Doesn't claw back points already awarded; it only stops the
    ///         listing from being shown as active going forward. Can't touch an Approved bounty:
    ///         that would silently strip the builder's one remaining avenue (`reportNonPayment`)
    ///         for legitimate, completed work.
    function removeBounty(uint256 id) external onlyOwnerOrGuardian {
        Bounty storage b = bounties[id];
        require(b.poster != address(0), "no such bounty");
        require(b.status != Status.Cancelled, "already cancelled");
        require(b.status != Status.Approved, "cannot remove an approved bounty");

        b.status = Status.Cancelled;
        _fsiAppend(NS_BOUNTY, id, _nextSeq(id), msg.sender, b.poster, "removed");
        emit BountyRemoved(id, msg.sender);
    }

    /// @notice Wipe an address's profile — for abusive bios or fraudulent contact info.
    function clearProfile(address who) external onlyOwnerOrGuardian {
        openForWork[who] = false;
        rateLabel[who] = "";
        skillsLabel[who] = "";
        xHandle[who] = "";
        tgHandle[who] = "";
        githubHandle[who] = "";
        portfolioLink[who] = "";
        emit ProfileUpdated(who, false);
    }

    /// @notice Guardian-only: reassign the owner outright, bypassing the owner's own two-step
    ///         handover and clearing any pending transfer. This is how the Guardian replaces a
    ///         compromised or unresponsive owner.
    function setOwner(address newOwner) external onlyGuardian {
        require(newOwner != address(0), "zero address");
        emit OwnerUpdated(owner, newOwner);
        owner = newOwner;
        pendingOwner = address(0);
    }

    /// @notice Guardian-only: remove the owner entirely, leaving only the Guardian privileged.
    function revokeOwner() external onlyGuardian {
        emit OwnerUpdated(owner, address(0));
        owner = address(0);
        pendingOwner = address(0);
    }

    /// @notice Step 1 of the owner's own voluntary handover — only takes effect once the new
    ///         address calls `acceptOwnership`. The Guardian can override this at any time via
    ///         `setOwner`/`revokeOwner`.
    function transferOwnership(address newOwner) external {
        require(msg.sender == owner, "not owner");
        require(newOwner != address(0), "zero address");
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    /// @notice Step 2 of the owner's own voluntary handover.
    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "not pending owner");
        emit OwnerUpdated(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }

    /// @dev Reserved storage so future upgrades can add new state without shifting the layout of
    ///      everything declared after this contract's own storage (there's nothing after it today,
    ///      but this is the standard guard for every upgradeable contract regardless).
    uint256[50] private __gap;
}
