// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {BuilderBounties} from "../src/BuilderBounties.sol";

contract BuilderBountiesTest is Test {
    BuilderBounties bounties;

    address owner = address(this);
    address poster = address(0xA11CE);
    address builder = address(0xB0B);
    address builder2 = address(0xB0B2);
    address builder3 = address(0xB0B3);
    address stranger = address(0x5717A116E);

    bytes32 constant NS_BUILDER_POINTS = "builderPoints";
    bytes32 constant NS_BOUNTY = "bounty";
    bytes32 constant NS_ACTIVITY = "activity";

    // Re-declared locally (same name/types/indexed-ness as FlapSharedIndexerV1's events) so this
    // test contract can `emit` the expected shape for vm.expectEmit — log matching is by the
    // event's signature hash and data bytes, not by which contract declared it.
    event FlapSharedIndexerAddrUint(bytes32 ns, address key, uint256 value, string data);
    event FlapSharedIndexerFeed(
        bytes32 ns, uint256 id, uint256 seq, address actor, address related, uint256 value, string data
    );
    event FlapSharedIndexerLog(bytes32 ns, uint256 id, address actor, address related, uint256 amount, uint256 extra);

    function setUp() public {
        bounties = new BuilderBounties();

        _setContact(poster, "poster_x", "");
        _setContact(builder, "builder_x", "");
        _setContact(builder2, "builder2_x", "");
        _setContact(builder3, "builder3_x", "");
    }

    function _setContact(address who, string memory x, string memory tg) internal {
        vm.prank(who);
        bounties.setProfile(
            BuilderBounties.ProfileInput({
                available: true,
                rate: "",
                skills: "",
                x: x,
                tg: tg,
                github: "",
                portfolio: ""
            })
        );
    }

    function _postBounty(address from, uint64 deadline) internal returns (uint256 id) {
        vm.prank(from);
        id = bounties.postBounty("Build a widget", "https://example.com/brief", "0.5 BNB", "dev", deadline);
    }

    /// @dev Select flow now requires the builder to have applied first (R1 fix) — this helper
    ///      does both steps so existing call sites don't have to repeat it.
    function _selected(uint64 deadline) internal returns (uint256 id) {
        id = _postBounty(poster, deadline);
        vm.prank(builder);
        bounties.applyToBounty(id);
        vm.prank(poster);
        bounties.selectBuilder(id, builder);
    }

    function _approved(uint64 deadline) internal returns (uint256 id) {
        id = _selected(deadline);
        vm.prank(builder);
        bounties.submitProof(id, "https://example.com/proof");
        vm.prank(poster);
        bounties.approveBounty(id);
    }

    uint64 constant DEFAULT_DEADLINE_OFFSET = 1 days;

    function _defaultDeadline() internal view returns (uint64) {
        return uint64(block.timestamp) + DEFAULT_DEADLINE_OFFSET;
    }

    // ---------------------------------------------------------------------
    // postBounty
    // ---------------------------------------------------------------------

    function test_postBounty_success() public {
        uint64 deadline = _defaultDeadline();
        uint256 id = _postBounty(poster, deadline);

        assertEq(id, 0);
        assertEq(bounties.bountyCount(), 1);

        (
            address bPoster,
            address bBuilder,
            string memory title,
            ,
            ,
            ,
            uint64 bDeadline,
            BuilderBounties.Status status,
            ,
            bool reported
        ) = bounties.bounties(id);

        assertEq(bPoster, poster);
        assertEq(bBuilder, address(0));
        assertEq(title, "Build a widget");
        assertEq(bDeadline, deadline);
        assertEq(uint8(status), uint8(BuilderBounties.Status.Open));
        assertFalse(reported);
    }

    function test_postBounty_revertsWithoutContact() public {
        vm.prank(stranger);
        vm.expectRevert(bytes("set your X or Telegram first"));
        bounties.postBounty("No contact", "", "", "dev", _defaultDeadline());
    }

    function test_postBounty_revertsIfPosterBlacklisted() public {
        bounties.setPosterBlacklisted(poster, true);

        vm.prank(poster);
        vm.expectRevert(bytes("poster blacklisted"));
        bounties.postBounty("Blocked", "", "", "dev", _defaultDeadline());
    }

    function test_postBounty_revertsOnEmptyTitle() public {
        vm.prank(poster);
        vm.expectRevert(bytes("bad title"));
        bounties.postBounty("", "", "", "dev", _defaultDeadline());
    }

    function test_postBounty_revertsOnPastDeadline() public {
        vm.warp(1_000_000);
        vm.prank(poster);
        vm.expectRevert(bytes("deadline too soon"));
        bounties.postBounty("Too late", "", "", "dev", uint64(block.timestamp - 1));
    }

    function test_postBounty_revertsOnDeadlineTooSoon() public {
        // R1 fix: a deadline under 24h is rejected outright, even for a willing applicant.
        vm.prank(poster);
        vm.expectRevert(bytes("deadline too soon"));
        bounties.postBounty("Too soon", "", "", "dev", uint64(block.timestamp + 1 hours));
    }

    function test_postBounty_revertsOnDeadlineTooFarOut() public {
        vm.prank(poster);
        vm.expectRevert(bytes("deadline too far out"));
        bounties.postBounty("Too far", "", "", "dev", uint64(block.timestamp + 31 days));
    }

    function test_postBounty_revertsOnRewardLabelTooLong() public {
        string memory tooLong = _repeat("a", 81);

        vm.prank(poster);
        vm.expectRevert(bytes("reward text too long"));
        bounties.postBounty("Title", "", tooLong, "dev", _defaultDeadline());
    }

    function test_postBounty_revertsOnCategoryTooLong() public {
        string memory tooLong = _repeat("a", 81);

        vm.prank(poster);
        vm.expectRevert(bytes("category too long"));
        bounties.postBounty("Title", "", "0.5 BNB", tooLong, _defaultDeadline());
    }

    function test_postBounty_emitsFsiFeedEvent() public {
        vm.expectEmit(false, false, false, true);
        emit FlapSharedIndexerFeed(NS_BOUNTY, 0, 0, poster, address(0), block.timestamp, "Build a widget");

        _postBounty(poster, _defaultDeadline());
    }

    // ---------------------------------------------------------------------
    // cancelBounty
    // ---------------------------------------------------------------------

    function test_cancelBounty_success() public {
        uint256 id = _postBounty(poster, _defaultDeadline());

        vm.prank(poster);
        bounties.cancelBounty(id);

        (, , , , , , , BuilderBounties.Status status, , ) = bounties.bounties(id);
        assertEq(uint8(status), uint8(BuilderBounties.Status.Cancelled));
    }

    function test_cancelBounty_revertsIfNotPoster() public {
        uint256 id = _postBounty(poster, _defaultDeadline());

        vm.prank(stranger);
        vm.expectRevert(bytes("not your bounty"));
        bounties.cancelBounty(id);
    }

    // ---------------------------------------------------------------------
    // applyToBounty / getApplicants
    // ---------------------------------------------------------------------

    function test_applyToBounty_success() public {
        uint256 id = _postBounty(poster, _defaultDeadline());

        vm.prank(builder);
        bounties.applyToBounty(id);

        assertTrue(bounties.hasApplied(id, builder));
        address[] memory applicants = bounties.getApplicants(id);
        assertEq(applicants.length, 1);
        assertEq(applicants[0], builder);
    }

    function test_applyToBounty_revertsIfAlreadyApplied() public {
        uint256 id = _postBounty(poster, _defaultDeadline());

        vm.prank(builder);
        bounties.applyToBounty(id);

        vm.prank(builder);
        vm.expectRevert(bytes("already applied"));
        bounties.applyToBounty(id);
    }

    function test_applyToBounty_revertsForPosterOwnBounty() public {
        uint256 id = _postBounty(poster, _defaultDeadline());

        vm.prank(poster);
        vm.expectRevert(bytes("cannot apply to your own bounty"));
        bounties.applyToBounty(id);
    }

    function test_applyToBounty_revertsIfBuilderBlacklisted() public {
        uint256 id = _postBounty(poster, _defaultDeadline());
        bounties.setBuilderBlacklisted(builder, true);

        vm.prank(builder);
        vm.expectRevert(bytes("builder blacklisted"));
        bounties.applyToBounty(id);
    }

    function test_applyToBounty_revertsWithoutContact() public {
        uint256 id = _postBounty(poster, _defaultDeadline());

        vm.prank(stranger);
        vm.expectRevert(bytes("set your X or Telegram first"));
        bounties.applyToBounty(id);
    }

    function test_applyToBounty_revertsAfterDeadline() public {
        uint64 deadline = _defaultDeadline();
        uint256 id = _postBounty(poster, deadline);

        vm.warp(deadline + 1);
        vm.prank(builder);
        vm.expectRevert(bytes("deadline passed"));
        bounties.applyToBounty(id);
    }

    function test_applyToBounty_revertsWhenNotOpen() public {
        uint256 id = _postBounty(poster, _defaultDeadline());
        vm.prank(poster);
        bounties.cancelBounty(id);

        vm.prank(builder);
        vm.expectRevert(bytes("not open"));
        bounties.applyToBounty(id);
    }

    function test_applyToBounty_revertsOnTooManyApplicants() public {
        uint256 id = _postBounty(poster, _defaultDeadline());

        for (uint256 i = 0; i < 30; i++) {
            address applicant = address(uint160(0x9000 + i));
            _setContact(applicant, "applicant_x", "");
            vm.prank(applicant);
            bounties.applyToBounty(id);
        }

        address overflowApplicant = address(uint160(0xA000));
        _setContact(overflowApplicant, "overflow_x", "");
        vm.prank(overflowApplicant);
        vm.expectRevert(bytes("too many applicants"));
        bounties.applyToBounty(id);
    }

    // ---------------------------------------------------------------------
    // selectBuilder / releaseBounty
    // ---------------------------------------------------------------------

    function test_selectBuilder_success() public {
        uint256 id = _postBounty(poster, _defaultDeadline());

        vm.prank(builder);
        bounties.applyToBounty(id);

        vm.prank(poster);
        bounties.selectBuilder(id, builder);

        (, address bBuilder, , , , , , BuilderBounties.Status status, , ) = bounties.bounties(id);
        assertEq(bBuilder, builder);
        assertEq(uint8(status), uint8(BuilderBounties.Status.Claimed));
    }

    function test_selectBuilder_revertsIfNotPoster() public {
        uint256 id = _postBounty(poster, _defaultDeadline());

        vm.prank(stranger);
        vm.expectRevert(bytes("not your bounty"));
        bounties.selectBuilder(id, builder);
    }

    function test_selectBuilder_revertsForSelfSelect() public {
        uint256 id = _postBounty(poster, _defaultDeadline());

        vm.prank(poster);
        vm.expectRevert(bytes("bad builder"));
        bounties.selectBuilder(id, poster);
    }

    function test_selectBuilder_revertsIfPosterBlacklisted() public {
        // O3 fix: a poster blacklisted after posting can't select on a bounty they already hold.
        uint256 id = _postBounty(poster, _defaultDeadline());
        vm.prank(builder);
        bounties.applyToBounty(id);

        bounties.setPosterBlacklisted(poster, true);

        vm.prank(poster);
        vm.expectRevert(bytes("poster blacklisted"));
        bounties.selectBuilder(id, builder);
    }

    function test_selectBuilder_revertsIfBuilderBlacklisted() public {
        uint256 id = _postBounty(poster, _defaultDeadline());
        bounties.setBuilderBlacklisted(builder, true);

        vm.prank(poster);
        vm.expectRevert(bytes("builder blacklisted"));
        bounties.selectBuilder(id, builder);
    }

    function test_selectBuilder_revertsIfBuilderNeverApplied() public {
        // R1 fix: having contact info is not enough — the builder must have applied.
        uint256 id = _postBounty(poster, _defaultDeadline());

        vm.prank(poster);
        vm.expectRevert(bytes("builder must apply first"));
        bounties.selectBuilder(id, builder);
    }

    function test_selectBuilder_revertsIfBuilderHasNoContact() public {
        // Builder applied (so had contact at the time), then the owner wiped it — selection
        // must still be blocked because _hasContact is checked live, not just at apply time.
        uint256 id = _postBounty(poster, _defaultDeadline());
        vm.prank(builder);
        bounties.applyToBounty(id);
        bounties.clearProfile(builder);

        vm.prank(poster);
        vm.expectRevert(bytes("builder has no contact info set"));
        bounties.selectBuilder(id, builder);
    }

    function test_griefBlacklist_noLongerPossible() public {
        // R1: the original attack — select a victim who never applied, let a short deadline
        // expire, repeat to rack up strikes with no consent from the victim at all. Confirm the
        // very first step is now rejected.
        uint256 id = _postBounty(poster, _defaultDeadline());

        vm.prank(poster);
        vm.expectRevert(bytes("builder must apply first"));
        bounties.selectBuilder(id, builder);

        assertEq(bounties.builderMissedStrikes(builder), 0);
        assertFalse(bounties.builderBlacklisted(builder));
    }

    function test_releaseBounty_reopensForAnotherSelection() public {
        uint256 id = _postBounty(poster, _defaultDeadline());
        vm.prank(builder);
        bounties.applyToBounty(id);
        vm.prank(poster);
        bounties.selectBuilder(id, builder);

        vm.prank(builder);
        bounties.releaseBounty(id);

        (, address bBuilder, , , , , , BuilderBounties.Status status, , ) = bounties.bounties(id);
        assertEq(bBuilder, address(0));
        assertEq(uint8(status), uint8(BuilderBounties.Status.Open));

        vm.prank(builder2);
        bounties.applyToBounty(id);
        vm.prank(poster);
        bounties.selectBuilder(id, builder2);

        (, address bBuilder2, , , , , , BuilderBounties.Status status2, , ) = bounties.bounties(id);
        assertEq(bBuilder2, builder2);
        assertEq(uint8(status2), uint8(BuilderBounties.Status.Claimed));
    }

    function test_releaseBounty_revertsIfNotTheClaimant() public {
        uint256 id = _postBounty(poster, _defaultDeadline());
        vm.prank(builder);
        bounties.applyToBounty(id);
        vm.prank(poster);
        bounties.selectBuilder(id, builder);

        vm.prank(builder2);
        vm.expectRevert(bytes("not your claim"));
        bounties.releaseBounty(id);
    }

    // ---------------------------------------------------------------------
    // submitProof / approveBounty
    // ---------------------------------------------------------------------

    function test_submitProof_success() public {
        uint256 id = _selected(_defaultDeadline());

        vm.prank(builder);
        bounties.submitProof(id, "https://github.com/example/pr/1");

        (, , , , , , , BuilderBounties.Status status, string memory proofLink, ) = bounties.bounties(id);
        assertEq(uint8(status), uint8(BuilderBounties.Status.Submitted));
        assertEq(proofLink, "https://github.com/example/pr/1");
    }

    function test_submitProof_revertsIfNotClaimant() public {
        uint256 id = _selected(_defaultDeadline());

        vm.prank(builder2);
        vm.expectRevert(bytes("not your claim"));
        bounties.submitProof(id, "https://example.com/proof");
    }

    function test_submitProof_revertsIfBuilderBlacklisted() public {
        // O3 fix: a builder blacklisted after being selected can't advance the bounty further.
        uint256 id = _selected(_defaultDeadline());
        bounties.setBuilderBlacklisted(builder, true);

        vm.prank(builder);
        vm.expectRevert(bytes("builder blacklisted"));
        bounties.submitProof(id, "https://example.com/proof");
    }

    function test_approveBounty_awardsPointsAndCompletion() public {
        uint256 id = _selected(_defaultDeadline());

        vm.prank(builder);
        bounties.submitProof(id, "https://example.com/proof");

        vm.prank(poster);
        bounties.approveBounty(id);

        (, , , , , , , BuilderBounties.Status status, , ) = bounties.bounties(id);
        assertEq(uint8(status), uint8(BuilderBounties.Status.Approved));
        assertEq(bounties.builderPoints(builder), bounties.POINTS_PER_BOUNTY());
        assertEq(bounties.buildersCompleted(builder), 1);
    }

    function test_approveBounty_revertsIfNotSubmitted() public {
        uint256 id = _selected(_defaultDeadline());

        vm.prank(poster);
        vm.expectRevert(bytes("not submitted"));
        bounties.approveBounty(id);
    }

    function test_approveBounty_revertsIfPosterBlacklisted() public {
        uint256 id = _selected(_defaultDeadline());
        vm.prank(builder);
        bounties.submitProof(id, "https://example.com/proof");

        bounties.setPosterBlacklisted(poster, true);

        vm.prank(poster);
        vm.expectRevert(bytes("poster blacklisted"));
        bounties.approveBounty(id);
    }

    function test_approveBounty_revertsIfBuilderBlacklisted() public {
        uint256 id = _selected(_defaultDeadline());
        vm.prank(builder);
        bounties.submitProof(id, "https://example.com/proof");

        bounties.setBuilderBlacklisted(builder, true);

        vm.prank(poster);
        vm.expectRevert(bytes("builder blacklisted"));
        bounties.approveBounty(id);
    }

    function test_approveBounty_succeedsLongAfterDeadline() public {
        // O1: approveBounty has no deadline cutoff — the poster keeps unlimited time to review a
        // Submitted bounty, since markExpired can no longer touch it.
        uint64 deadline = _defaultDeadline();
        uint256 id = _selected(deadline);
        vm.prank(builder);
        bounties.submitProof(id, "https://example.com/proof");

        vm.warp(deadline + 365 days);

        vm.prank(poster);
        bounties.approveBounty(id);

        assertEq(bounties.builderPoints(builder), bounties.POINTS_PER_BOUNTY());
        assertEq(bounties.builderMissedStrikes(builder), 0);
    }

    function test_approveBounty_emitsFsiPointsAndActivity() public {
        uint256 id = _selected(_defaultDeadline());
        vm.prank(builder);
        bounties.submitProof(id, "https://example.com/proof");

        vm.expectEmit(false, false, false, true);
        emit FlapSharedIndexerAddrUint(NS_BUILDER_POINTS, builder, bounties.POINTS_PER_BOUNTY(), "");

        vm.prank(poster);
        bounties.approveBounty(id);
    }

    // ---------------------------------------------------------------------
    // markExpired — the deadline strike / auto-blacklist path
    // ---------------------------------------------------------------------

    function test_markExpired_revertsBeforeDeadline() public {
        uint256 id = _postBounty(poster, _defaultDeadline());

        vm.expectRevert(bytes("not past deadline yet"));
        bounties.markExpired(id);
    }

    function test_markExpired_claimedBuilderTakesAStrike() public {
        uint64 deadline = _defaultDeadline();
        uint256 id = _selected(deadline);

        vm.warp(deadline + 1);
        bounties.markExpired(id);

        (, , , , , , , BuilderBounties.Status status, , ) = bounties.bounties(id);
        assertEq(uint8(status), uint8(BuilderBounties.Status.Expired));
        assertEq(bounties.builderMissedStrikes(builder), 1);
        assertFalse(bounties.builderBlacklisted(builder));
    }

    function test_markExpired_openBountyExpiresWithNoStrike() public {
        uint64 deadline = _defaultDeadline();
        uint256 id = _postBounty(poster, deadline);

        vm.warp(deadline + 1);
        bounties.markExpired(id);

        (, , , , , , , BuilderBounties.Status status, , ) = bounties.bounties(id);
        assertEq(uint8(status), uint8(BuilderBounties.Status.Expired));
    }

    function test_markExpired_threeStrikesAutoBlacklists() public {
        for (uint256 i = 0; i < 3; i++) {
            uint64 deadline = _defaultDeadline();
            uint256 id = _selected(deadline);
            vm.warp(deadline + 1);
            bounties.markExpired(id);
        }

        assertEq(bounties.builderMissedStrikes(builder), 3);
        assertTrue(bounties.builderBlacklisted(builder));
    }

    function test_markExpired_revertsIfAlreadyFinalized() public {
        uint64 deadline = _defaultDeadline();
        uint256 id = _postBounty(poster, deadline);

        vm.prank(poster);
        bounties.cancelBounty(id);

        vm.warp(deadline + 1);
        vm.expectRevert(bytes("already finalized"));
        bounties.markExpired(id);
    }

    function test_markExpired_submittedBountyNeverStrikes() public {
        // O1 fix: the builder delivered on time; a poster who sits on the approval must not be
        // able to turn that into a strike by calling markExpired once the deadline passes.
        uint64 deadline = _defaultDeadline();
        uint256 id = _selected(deadline);
        vm.prank(builder);
        bounties.submitProof(id, "https://example.com/proof");

        vm.warp(deadline + 1);
        vm.expectRevert(bytes("already finalized"));
        bounties.markExpired(id);

        (, , , , , , , BuilderBounties.Status status, , ) = bounties.bounties(id);
        assertEq(uint8(status), uint8(BuilderBounties.Status.Submitted));
        assertEq(bounties.builderMissedStrikes(builder), 0);
        assertFalse(bounties.builderBlacklisted(builder));
    }

    function test_markExpired_cannotFrontrunALateApproval() public {
        // O1 fix: proves the frontrun the auditor described no longer works — racing markExpired
        // against a late approveBounty can no longer make the approval fail.
        uint64 deadline = _defaultDeadline();
        uint256 id = _selected(deadline);
        vm.prank(builder);
        bounties.submitProof(id, "https://example.com/proof");

        vm.warp(deadline + 1);
        vm.expectRevert(bytes("already finalized"));
        bounties.markExpired(id);

        vm.prank(poster);
        bounties.approveBounty(id);

        (, , , , , , , BuilderBounties.Status status, , ) = bounties.bounties(id);
        assertEq(uint8(status), uint8(BuilderBounties.Status.Approved));
    }

    // ---------------------------------------------------------------------
    // reportNonPayment — one-shot replay guard
    // ---------------------------------------------------------------------

    function test_reportNonPayment_success() public {
        uint256 id = _approved(_defaultDeadline());

        vm.prank(builder);
        bounties.reportNonPayment(id);

        (, , , , , , , , , bool reported) = bounties.bounties(id);
        assertTrue(reported);
        assertEq(bounties.posterNonPaymentReports(poster), 1);
    }

    function test_reportNonPayment_revertsOnReplay() public {
        uint256 id = _approved(_defaultDeadline());

        vm.prank(builder);
        bounties.reportNonPayment(id);

        vm.prank(builder);
        vm.expectRevert(bytes("already reported"));
        bounties.reportNonPayment(id);
    }

    function test_reportNonPayment_revertsIfNotApproved() public {
        uint256 id = _selected(_defaultDeadline());

        vm.prank(builder);
        vm.expectRevert(bytes("bounty not approved"));
        bounties.reportNonPayment(id);
    }

    function test_reportNonPayment_revertsIfNotClaimant() public {
        uint256 id = _approved(_defaultDeadline());

        vm.prank(builder2);
        vm.expectRevert(bytes("not your claim"));
        bounties.reportNonPayment(id);
    }

    function test_reportNonPayment_emitsFsiActivityLog() public {
        uint256 id = _approved(_defaultDeadline());

        vm.expectEmit(false, false, false, true);
        emit FlapSharedIndexerLog(NS_ACTIVITY, id, builder, poster, 0, 1);

        vm.prank(builder);
        bounties.reportNonPayment(id);
    }

    // ---------------------------------------------------------------------
    // setProfile / builder registry
    // ---------------------------------------------------------------------

    function test_setProfile_registersBuilderOnlyOnce() public {
        // setUp() already registered poster, builder, builder2, builder3.
        assertEq(bounties.registeredBuilderCount(), 4);

        _setContact(builder, "builder_x_updated", "builder_tg");
        assertEq(bounties.registeredBuilderCount(), 4);

        assertEq(bounties.xHandle(builder), "builder_x_updated");
        assertEq(bounties.tgHandle(builder), "builder_tg");
        assertTrue(bounties.openForWork(builder));
    }

    function test_registeredBuilderAt_listsInFirstCallOrder() public view {
        assertEq(bounties.registeredBuilderAt(0), poster);
        assertEq(bounties.registeredBuilderAt(1), builder);
        assertEq(bounties.registeredBuilderAt(2), builder2);
        assertEq(bounties.registeredBuilderAt(3), builder3);
    }

    function test_setProfile_revertsOnOverlongField() public {
        string memory tooLong = _repeat("a", 161);

        vm.prank(stranger);
        vm.expectRevert(bytes("rate too long"));
        bounties.setProfile(
            BuilderBounties.ProfileInput({
                available: true,
                rate: tooLong,
                skills: "",
                x: "",
                tg: "",
                github: "",
                portfolio: ""
            })
        );
    }

    function test_setProfile_revertsIfBuilderBlacklisted() public {
        bounties.setBuilderBlacklisted(builder, true);

        vm.prank(builder);
        vm.expectRevert(bytes("blacklisted"));
        bounties.setProfile(
            BuilderBounties.ProfileInput({
                available: true,
                rate: "",
                skills: "",
                x: "new_handle",
                tg: "",
                github: "",
                portfolio: ""
            })
        );
    }

    function test_setProfile_revertsIfPosterBlacklisted() public {
        bounties.setPosterBlacklisted(poster, true);

        vm.prank(poster);
        vm.expectRevert(bytes("blacklisted"));
        bounties.setProfile(
            BuilderBounties.ProfileInput({
                available: true,
                rate: "",
                skills: "",
                x: "new_handle",
                tg: "",
                github: "",
                portfolio: ""
            })
        );
    }

    function test_clearProfile_doesNotBypassBlacklistForReprofiling() public {
        // O3 fix: clearing a blacklisted address's profile must not let them immediately refill
        // it — setProfile itself now checks the blacklist, independent of clearProfile.
        bounties.setBuilderBlacklisted(builder, true);
        bounties.clearProfile(builder);

        vm.prank(builder);
        vm.expectRevert(bytes("blacklisted"));
        bounties.setProfile(
            BuilderBounties.ProfileInput({
                available: true,
                rate: "",
                skills: "",
                x: "back_again",
                tg: "",
                github: "",
                portfolio: ""
            })
        );
    }

    function _repeat(string memory ch, uint256 n) internal pure returns (string memory) {
        bytes memory out = new bytes(n);
        bytes memory c = bytes(ch);
        for (uint256 i = 0; i < n; i++) {
            out[i] = c[0];
        }
        return string(out);
    }

    // ---------------------------------------------------------------------
    // Owner moderation
    // ---------------------------------------------------------------------

    function test_onlyOwner_revertsForNonOwnerCalls() public {
        vm.startPrank(stranger);

        vm.expectRevert(bytes("not owner"));
        bounties.setBuilderBlacklisted(builder, true);

        vm.expectRevert(bytes("not owner"));
        bounties.setPosterBlacklisted(poster, true);

        vm.expectRevert(bytes("not owner"));
        bounties.removeBounty(0);

        vm.expectRevert(bytes("not owner"));
        bounties.clearProfile(builder);

        vm.expectRevert(bytes("not owner"));
        bounties.setOwner(stranger);

        vm.stopPrank();
    }

    function test_removeBounty_forceCancelsRegardlessOfStatus() public {
        uint256 id = _selected(_defaultDeadline());

        bounties.removeBounty(id);

        (, , , , , , , BuilderBounties.Status status, , ) = bounties.bounties(id);
        assertEq(uint8(status), uint8(BuilderBounties.Status.Cancelled));
    }

    function test_removeBounty_revertsOnDoubleRemoval() public {
        // O2 fix: calling removeBounty twice must not be possible (it would otherwise reuse the
        // same FSI seq number for two different events).
        uint256 id = _postBounty(poster, _defaultDeadline());

        bounties.removeBounty(id);

        vm.expectRevert(bytes("already cancelled"));
        bounties.removeBounty(id);
    }

    function test_clearProfile_wipesContactAndBlocksFurtherActions() public {
        uint256 id = _postBounty(poster, _defaultDeadline());

        bounties.clearProfile(builder);

        assertEq(bounties.xHandle(builder), "");
        assertEq(bounties.tgHandle(builder), "");
        assertFalse(bounties.openForWork(builder));

        vm.prank(builder);
        vm.expectRevert(bytes("set your X or Telegram first"));
        bounties.applyToBounty(id);
    }

    function test_setOwner_transfersOwnership() public {
        bounties.setOwner(stranger);
        assertEq(bounties.owner(), stranger);

        vm.expectRevert(bytes("not owner"));
        bounties.setBuilderBlacklisted(builder, true);

        vm.prank(stranger);
        bounties.setBuilderBlacklisted(builder, true);
        assertTrue(bounties.builderBlacklisted(builder));
    }

    function test_setOwner_revertsOnZeroAddress() public {
        vm.expectRevert(bytes("zero address"));
        bounties.setOwner(address(0));
    }

    // ---------------------------------------------------------------------
    // FSI sequence uniqueness (O2 fix)
    // ---------------------------------------------------------------------

    function test_seqNumbersAreUniquePerBounty() public {
        uint256 id = _postBounty(poster, _defaultDeadline());

        vm.recordLogs();

        vm.prank(builder);
        bounties.applyToBounty(id);
        vm.prank(poster);
        bounties.selectBuilder(id, builder); // seq 1 (seq 0 was postBounty, outside the recorder)
        vm.prank(builder);
        bounties.releaseBounty(id); // seq 2

        vm.prank(builder2);
        bounties.applyToBounty(id);
        vm.prank(poster);
        bounties.selectBuilder(id, builder2); // seq 3 — previously this repeated seq 2
        vm.prank(builder2);
        bounties.releaseBounty(id); // seq 4 — previously this repeated seq 7

        bytes32 feedSig = keccak256("FlapSharedIndexerFeed(bytes32,uint256,uint256,address,address,uint256,string)");
        Vm.Log[] memory entries = vm.getRecordedLogs();

        uint256[] memory seen = new uint256[](entries.length);
        uint256 count = 0;
        for (uint256 i = 0; i < entries.length; i++) {
            if (entries[i].topics.length > 0 && entries[i].topics[0] == feedSig) {
                (, , uint256 seq, , , , ) =
                    abi.decode(entries[i].data, (bytes32, uint256, uint256, address, address, uint256, string));
                for (uint256 j = 0; j < count; j++) {
                    assertTrue(seen[j] != seq, "duplicate seq found for the same bounty id");
                }
                seen[count] = seq;
                count++;
            }
        }

        assertEq(count, 4, "expected 4 FSI feed events (select, release, select, release)");
    }

    function test_seqNumbersAreUniqueAcrossRepeatedRemoval() public {
        // Covers the second half of O2: removeBounty can no longer fire twice, so it can no
        // longer emit the same seq value twice either (enforced via the revert tested above).
        uint256 id = _postBounty(poster, _defaultDeadline());
        bounties.removeBounty(id);

        vm.expectRevert(bytes("already cancelled"));
        bounties.removeBounty(id);
    }
}
