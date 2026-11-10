// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {BuilderBounties} from "../src/BuilderBounties.sol";

contract BuilderBountiesTest is Test {
    BuilderBounties bounties;

    address owner = address(this);
    address poster = address(0xA11CE);
    address builder = address(0xB0B);
    address builder2 = address(0xB0B2);
    address builder3 = address(0xB0B3);
    address stranger = address(0x5717A116E);

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

    // ---------------------------------------------------------------------
    // postBounty
    // ---------------------------------------------------------------------

    function test_postBounty_success() public {
        uint64 deadline = uint64(block.timestamp + 1 days);
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
        bounties.postBounty("No contact", "", "", "dev", uint64(block.timestamp + 1 days));
    }

    function test_postBounty_revertsIfPosterBlacklisted() public {
        bounties.setPosterBlacklisted(poster, true);

        vm.prank(poster);
        vm.expectRevert(bytes("poster blacklisted"));
        bounties.postBounty("Blocked", "", "", "dev", uint64(block.timestamp + 1 days));
    }

    function test_postBounty_revertsOnEmptyTitle() public {
        vm.prank(poster);
        vm.expectRevert(bytes("bad title"));
        bounties.postBounty("", "", "", "dev", uint64(block.timestamp + 1 days));
    }

    function test_postBounty_revertsOnPastDeadline() public {
        vm.warp(1000);
        vm.prank(poster);
        vm.expectRevert(bytes("deadline already passed"));
        bounties.postBounty("Too late", "", "", "dev", uint64(block.timestamp - 1));
    }

    function test_postBounty_revertsOnDeadlineTooFarOut() public {
        vm.prank(poster);
        vm.expectRevert(bytes("deadline too far out"));
        bounties.postBounty("Too far", "", "", "dev", uint64(block.timestamp + 31 days));
    }

    // ---------------------------------------------------------------------
    // cancelBounty
    // ---------------------------------------------------------------------

    function test_cancelBounty_success() public {
        uint256 id = _postBounty(poster, uint64(block.timestamp + 1 days));

        vm.prank(poster);
        bounties.cancelBounty(id);

        (, , , , , , , BuilderBounties.Status status, , ) = bounties.bounties(id);
        assertEq(uint8(status), uint8(BuilderBounties.Status.Cancelled));
    }

    function test_cancelBounty_revertsIfNotPoster() public {
        uint256 id = _postBounty(poster, uint64(block.timestamp + 1 days));

        vm.prank(stranger);
        vm.expectRevert(bytes("not your bounty"));
        bounties.cancelBounty(id);
    }

    // ---------------------------------------------------------------------
    // applyToBounty / getApplicants
    // ---------------------------------------------------------------------

    function test_applyToBounty_success() public {
        uint256 id = _postBounty(poster, uint64(block.timestamp + 1 days));

        vm.prank(builder);
        bounties.applyToBounty(id);

        assertTrue(bounties.hasApplied(id, builder));
        address[] memory applicants = bounties.getApplicants(id);
        assertEq(applicants.length, 1);
        assertEq(applicants[0], builder);
    }

    function test_applyToBounty_revertsIfAlreadyApplied() public {
        uint256 id = _postBounty(poster, uint64(block.timestamp + 1 days));

        vm.prank(builder);
        bounties.applyToBounty(id);

        vm.prank(builder);
        vm.expectRevert(bytes("already applied"));
        bounties.applyToBounty(id);
    }

    function test_applyToBounty_revertsForPosterOwnBounty() public {
        uint256 id = _postBounty(poster, uint64(block.timestamp + 1 days));

        vm.prank(poster);
        vm.expectRevert(bytes("cannot apply to your own bounty"));
        bounties.applyToBounty(id);
    }

    function test_applyToBounty_revertsIfBuilderBlacklisted() public {
        uint256 id = _postBounty(poster, uint64(block.timestamp + 1 days));
        bounties.setBuilderBlacklisted(builder, true);

        vm.prank(builder);
        vm.expectRevert(bytes("builder blacklisted"));
        bounties.applyToBounty(id);
    }

    function test_applyToBounty_revertsWithoutContact() public {
        uint256 id = _postBounty(poster, uint64(block.timestamp + 1 days));

        vm.prank(stranger);
        vm.expectRevert(bytes("set your X or Telegram first"));
        bounties.applyToBounty(id);
    }

    function test_applyToBounty_revertsAfterDeadline() public {
        uint64 deadline = uint64(block.timestamp + 1 days);
        uint256 id = _postBounty(poster, deadline);

        vm.warp(deadline + 1);
        vm.prank(builder);
        vm.expectRevert(bytes("deadline passed"));
        bounties.applyToBounty(id);
    }

    function test_applyToBounty_revertsWhenNotOpen() public {
        uint256 id = _postBounty(poster, uint64(block.timestamp + 1 days));
        vm.prank(poster);
        bounties.cancelBounty(id);

        vm.prank(builder);
        vm.expectRevert(bytes("not open"));
        bounties.applyToBounty(id);
    }

    function test_applyToBounty_revertsOnTooManyApplicants() public {
        uint256 id = _postBounty(poster, uint64(block.timestamp + 1 days));

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
        uint256 id = _postBounty(poster, uint64(block.timestamp + 1 days));

        vm.prank(builder);
        bounties.applyToBounty(id);

        vm.prank(poster);
        bounties.selectBuilder(id, builder);

        (, address bBuilder, , , , , , BuilderBounties.Status status, , ) = bounties.bounties(id);
        assertEq(bBuilder, builder);
        assertEq(uint8(status), uint8(BuilderBounties.Status.Claimed));
    }

    function test_selectBuilder_revertsIfNotPoster() public {
        uint256 id = _postBounty(poster, uint64(block.timestamp + 1 days));

        vm.prank(stranger);
        vm.expectRevert(bytes("not your bounty"));
        bounties.selectBuilder(id, builder);
    }

    function test_selectBuilder_revertsForSelfSelect() public {
        uint256 id = _postBounty(poster, uint64(block.timestamp + 1 days));

        vm.prank(poster);
        vm.expectRevert(bytes("bad builder"));
        bounties.selectBuilder(id, poster);
    }

    function test_selectBuilder_revertsIfBuilderBlacklisted() public {
        uint256 id = _postBounty(poster, uint64(block.timestamp + 1 days));
        bounties.setBuilderBlacklisted(builder, true);

        vm.prank(poster);
        vm.expectRevert(bytes("builder blacklisted"));
        bounties.selectBuilder(id, builder);
    }

    function test_selectBuilder_revertsIfBuilderHasNoContact() public {
        uint256 id = _postBounty(poster, uint64(block.timestamp + 1 days));

        vm.prank(poster);
        vm.expectRevert(bytes("builder has no contact info set"));
        bounties.selectBuilder(id, stranger);
    }

    function test_releaseBounty_reopensForAnotherSelection() public {
        uint256 id = _postBounty(poster, uint64(block.timestamp + 1 days));

        vm.prank(poster);
        bounties.selectBuilder(id, builder);

        vm.prank(builder);
        bounties.releaseBounty(id);

        (, address bBuilder, , , , , , BuilderBounties.Status status, , ) = bounties.bounties(id);
        assertEq(bBuilder, address(0));
        assertEq(uint8(status), uint8(BuilderBounties.Status.Open));

        vm.prank(poster);
        bounties.selectBuilder(id, builder2);
        (, address bBuilder2, , , , , , BuilderBounties.Status status2, , ) = bounties.bounties(id);
        assertEq(bBuilder2, builder2);
        assertEq(uint8(status2), uint8(BuilderBounties.Status.Claimed));
    }

    function test_releaseBounty_revertsIfNotTheClaimant() public {
        uint256 id = _postBounty(poster, uint64(block.timestamp + 1 days));

        vm.prank(poster);
        bounties.selectBuilder(id, builder);

        vm.prank(builder2);
        vm.expectRevert(bytes("not your claim"));
        bounties.releaseBounty(id);
    }

    // ---------------------------------------------------------------------
    // submitProof / approveBounty
    // ---------------------------------------------------------------------

    function _selected(uint64 deadline) internal returns (uint256 id) {
        id = _postBounty(poster, deadline);
        vm.prank(poster);
        bounties.selectBuilder(id, builder);
    }

    function test_submitProof_success() public {
        uint256 id = _selected(uint64(block.timestamp + 1 days));

        vm.prank(builder);
        bounties.submitProof(id, "https://github.com/example/pr/1");

        (, , , , , , , BuilderBounties.Status status, string memory proofLink, ) = bounties.bounties(id);
        assertEq(uint8(status), uint8(BuilderBounties.Status.Submitted));
        assertEq(proofLink, "https://github.com/example/pr/1");
    }

    function test_submitProof_revertsIfNotClaimant() public {
        uint256 id = _selected(uint64(block.timestamp + 1 days));

        vm.prank(builder2);
        vm.expectRevert(bytes("not your claim"));
        bounties.submitProof(id, "https://example.com/proof");
    }

    function test_approveBounty_awardsPointsAndCompletion() public {
        uint256 id = _selected(uint64(block.timestamp + 1 days));

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
        uint256 id = _selected(uint64(block.timestamp + 1 days));

        vm.prank(poster);
        vm.expectRevert(bytes("not submitted"));
        bounties.approveBounty(id);
    }

    // ---------------------------------------------------------------------
    // markExpired — the deadline strike / auto-blacklist path
    // ---------------------------------------------------------------------

    function test_markExpired_revertsBeforeDeadline() public {
        uint256 id = _postBounty(poster, uint64(block.timestamp + 1 days));

        vm.expectRevert(bytes("not past deadline yet"));
        bounties.markExpired(id);
    }

    function test_markExpired_claimedBuilderTakesAStrike() public {
        uint64 deadline = uint64(block.timestamp + 1 days);
        uint256 id = _selected(deadline);

        vm.warp(deadline + 1);
        bounties.markExpired(id);

        (, , , , , , , BuilderBounties.Status status, , ) = bounties.bounties(id);
        assertEq(uint8(status), uint8(BuilderBounties.Status.Expired));
        assertEq(bounties.builderMissedStrikes(builder), 1);
        assertFalse(bounties.builderBlacklisted(builder));
    }

    function test_markExpired_openBountyExpiresWithNoStrike() public {
        uint64 deadline = uint64(block.timestamp + 1 days);
        uint256 id = _postBounty(poster, deadline);

        vm.warp(deadline + 1);
        bounties.markExpired(id);

        (, , , , , , , BuilderBounties.Status status, , ) = bounties.bounties(id);
        assertEq(uint8(status), uint8(BuilderBounties.Status.Expired));
    }

    function test_markExpired_threeStrikesAutoBlacklists() public {
        for (uint256 i = 0; i < 3; i++) {
            uint64 deadline = uint64(block.timestamp + 1 days);
            uint256 id = _selected(deadline);
            vm.warp(deadline + 1);
            bounties.markExpired(id);
        }

        assertEq(bounties.builderMissedStrikes(builder), 3);
        assertTrue(bounties.builderBlacklisted(builder));
    }

    function test_markExpired_revertsIfAlreadyFinalized() public {
        uint64 deadline = uint64(block.timestamp + 1 days);
        uint256 id = _postBounty(poster, deadline);

        vm.prank(poster);
        bounties.cancelBounty(id);

        vm.warp(deadline + 1);
        vm.expectRevert(bytes("already finalized"));
        bounties.markExpired(id);
    }

    // ---------------------------------------------------------------------
    // reportNonPayment — one-shot replay guard
    // ---------------------------------------------------------------------

    function _approved(uint64 deadline) internal returns (uint256 id) {
        id = _selected(deadline);
        vm.prank(builder);
        bounties.submitProof(id, "https://example.com/proof");
        vm.prank(poster);
        bounties.approveBounty(id);
    }

    function test_reportNonPayment_success() public {
        uint256 id = _approved(uint64(block.timestamp + 1 days));

        vm.prank(builder);
        bounties.reportNonPayment(id);

        (, , , , , , , , , bool reported) = bounties.bounties(id);
        assertTrue(reported);
        assertEq(bounties.posterNonPaymentReports(poster), 1);
    }

    function test_reportNonPayment_revertsOnReplay() public {
        uint256 id = _approved(uint64(block.timestamp + 1 days));

        vm.prank(builder);
        bounties.reportNonPayment(id);

        vm.prank(builder);
        vm.expectRevert(bytes("already reported"));
        bounties.reportNonPayment(id);
    }

    function test_reportNonPayment_revertsIfNotApproved() public {
        uint256 id = _selected(uint64(block.timestamp + 1 days));

        vm.prank(builder);
        vm.expectRevert(bytes("bounty not approved"));
        bounties.reportNonPayment(id);
    }

    function test_reportNonPayment_revertsIfNotClaimant() public {
        uint256 id = _approved(uint64(block.timestamp + 1 days));

        vm.prank(builder2);
        vm.expectRevert(bytes("not your claim"));
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
        uint256 id = _selected(uint64(block.timestamp + 1 days));

        bounties.removeBounty(id);

        (, , , , , , , BuilderBounties.Status status, , ) = bounties.bounties(id);
        assertEq(uint8(status), uint8(BuilderBounties.Status.Cancelled));
    }

    function test_clearProfile_wipesContactAndBlocksFurtherActions() public {
        uint256 id = _postBounty(poster, uint64(block.timestamp + 1 days));

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
}
