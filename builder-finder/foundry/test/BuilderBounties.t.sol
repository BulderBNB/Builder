// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {BuilderBounties} from "../src/BuilderBounties.sol";

/// @dev Minimal stand-in "next version" used only to prove an upgrade actually swaps the
///      implementation and preserves storage — not a real proposed V2.
contract BuilderBountiesV2Mock is BuilderBounties {
    function version() external pure returns (string memory) {
        return "v2-mock";
    }
}

contract BuilderBountiesTest is Test {
    BuilderBounties bounties;
    address implementation;

    address constant GUARDIAN = 0x9e27098dcD8844bcc6287a557E0b4D09C86B8a4b;

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
    // test contract can `emit` the expected shape for vm.expectEmit.
    event FlapSharedIndexerAddrUint(bytes32 ns, address key, uint256 value, string data);
    event FlapSharedIndexerFeed(
        bytes32 ns, uint256 id, uint256 seq, address actor, address related, uint256 value, string data
    );
    event FlapSharedIndexerLog(bytes32 ns, uint256 id, address actor, address related, uint256 amount, uint256 extra);

    function setUp() public {
        BuilderBounties impl = new BuilderBounties();
        implementation = address(impl);
        bytes memory initData = abi.encodeWithSelector(BuilderBounties.initialize.selector, owner);
        ERC1967Proxy proxy = new ERC1967Proxy(implementation, initData);
        bounties = BuilderBounties(address(proxy));

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

    uint64 constant DEFAULT_DEADLINE_OFFSET = 2 days;

    function _defaultDeadline() internal view returns (uint64) {
        return uint64(block.timestamp) + DEFAULT_DEADLINE_OFFSET;
    }

    function _repeat(string memory ch, uint256 n) internal pure returns (string memory) {
        bytes memory out = new bytes(n);
        bytes memory c = bytes(ch);
        for (uint256 i = 0; i < n; i++) {
            out[i] = c[0];
        }
        return string(out);
    }

    // =========================================================================================
    // A: Upgradeability / Guardian
    // =========================================================================================

    function test_initialize_setsOwner() public view {
        assertEq(bounties.owner(), owner);
    }

    function test_initialize_revertsOnZeroOwner() public {
        BuilderBounties impl = new BuilderBounties();
        bytes memory initData = abi.encodeWithSelector(BuilderBounties.initialize.selector, address(0));
        vm.expectRevert(bytes("zero address"));
        new ERC1967Proxy(address(impl), initData);
    }

    function test_initialize_cannotBeCalledTwice() public {
        vm.expectRevert();
        bounties.initialize(stranger);
    }

    function test_implementation_cannotBeInitializedDirectly() public {
        BuilderBounties freshImpl = new BuilderBounties();
        vm.expectRevert();
        freshImpl.initialize(owner);
    }

    function test_guardian_isHardcodedConstant() public view {
        assertEq(bounties.GUARDIAN(), GUARDIAN);
    }

    function test_guardian_canCallEveryModerationFunction() public {
        uint256 id = _postBounty(poster, _defaultDeadline());

        vm.startPrank(GUARDIAN);
        bounties.setBuilderBlacklisted(builder, true);
        bounties.setBuilderBlacklisted(builder, false);
        bounties.setPosterBlacklisted(poster, true);
        bounties.setPosterBlacklisted(poster, false);
        bounties.clearProfile(builder3);
        bounties.removeBounty(id);
        vm.stopPrank();

        (, , , , , , , , BuilderBounties.Status status, , ) = bounties.bounties(id);
        assertEq(uint8(status), uint8(BuilderBounties.Status.Cancelled));
    }

    function test_guardian_canRevokeAndReplaceOwner() public {
        vm.prank(GUARDIAN);
        bounties.setOwner(stranger);
        assertEq(bounties.owner(), stranger);

        vm.prank(GUARDIAN);
        bounties.revokeOwner();
        assertEq(bounties.owner(), address(0));

        // A revoked owner's calls now revert.
        vm.prank(stranger);
        vm.expectRevert(bytes("not authorized"));
        bounties.setBuilderBlacklisted(builder, true);
    }

    function test_setOwner_revertsForNonGuardian() public {
        vm.expectRevert(bytes("not guardian"));
        bounties.setOwner(stranger); // called as `owner`, which is not Guardian
    }

    function test_revokeOwner_revertsForNonGuardian() public {
        vm.prank(poster);
        vm.expectRevert(bytes("not guardian"));
        bounties.revokeOwner();
    }

    function test_owner_canSelfTransferInTwoSteps() public {
        bounties.transferOwnership(stranger);
        assertEq(bounties.owner(), owner); // not yet changed
        assertEq(bounties.pendingOwner(), stranger);

        vm.prank(stranger);
        bounties.acceptOwnership();
        assertEq(bounties.owner(), stranger);
        assertEq(bounties.pendingOwner(), address(0));
    }

    function test_acceptOwnership_revertsForWrongCaller() public {
        bounties.transferOwnership(stranger);
        vm.prank(builder);
        vm.expectRevert(bytes("not pending owner"));
        bounties.acceptOwnership();
    }

    function test_guardian_canOverridePendingSelfTransfer() public {
        bounties.transferOwnership(stranger);
        vm.prank(GUARDIAN);
        bounties.setOwner(builder3);
        assertEq(bounties.owner(), builder3);
        assertEq(bounties.pendingOwner(), address(0));

        // The old pending transfer is dead — stranger can no longer accept.
        vm.prank(stranger);
        vm.expectRevert(bytes("not pending owner"));
        bounties.acceptOwnership();
    }

    function test_upgrade_revertsForNonGuardian() public {
        BuilderBountiesV2Mock newImpl = new BuilderBountiesV2Mock();
        vm.expectRevert(bytes("not guardian")); // called as `owner`
        bounties.upgradeToAndCall(address(newImpl), "");

        vm.prank(stranger);
        vm.expectRevert(bytes("not guardian"));
        bounties.upgradeToAndCall(address(newImpl), "");
    }

    function test_upgrade_byGuardianPreservesState() public {
        // Build up some real state before upgrading.
        uint256 id = _approved(_defaultDeadline());
        assertEq(bounties.builderPoints(builder), 100);
        assertEq(bounties.registeredBuilderCount(), 4);

        BuilderBountiesV2Mock newImpl = new BuilderBountiesV2Mock();
        vm.prank(GUARDIAN);
        bounties.upgradeToAndCall(address(newImpl), "");

        // Storage survived the upgrade.
        assertEq(bounties.builderPoints(builder), 100);
        assertEq(bounties.registeredBuilderCount(), 4);
        (, , , , , , , , BuilderBounties.Status status, , ) = bounties.bounties(id);
        assertEq(uint8(status), uint8(BuilderBounties.Status.Approved));

        // The new implementation's own function is now callable through the same proxy address.
        assertEq(BuilderBountiesV2Mock(address(bounties)).version(), "v2-mock");
    }

    // =========================================================================================
    // postBounty
    // =========================================================================================

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
            ,
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

    function test_postBounty_revertsAtOldMinimumDuration() public {
        // The posting minimum (48h) is deliberately longer than the selection lead time (24h) —
        // otherwise a bounty posted at exactly 24h could never actually be selected.
        vm.prank(poster);
        vm.expectRevert(bytes("deadline too soon"));
        bounties.postBounty("Old minimum", "", "", "dev", uint64(block.timestamp + 24 hours));
    }

    function test_postBounty_atMinimumDuration_isActuallySelectable() public {
        uint64 deadline = uint64(block.timestamp) + 48 hours;
        uint256 id = _postBounty(poster, deadline);
        vm.prank(builder);
        bounties.applyToBounty(id);

        vm.warp(block.timestamp + 23 hours);
        vm.prank(poster);
        bounties.selectBuilder(id, builder);

        (, address bBuilder, , , , , , , BuilderBounties.Status status, , ) = bounties.bounties(id);
        assertEq(bBuilder, builder);
        assertEq(uint8(status), uint8(BuilderBounties.Status.Claimed));
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

    // =========================================================================================
    // cancelBounty
    // =========================================================================================

    function test_cancelBounty_success() public {
        uint256 id = _postBounty(poster, _defaultDeadline());
        vm.prank(poster);
        bounties.cancelBounty(id);
        (, , , , , , , , BuilderBounties.Status status, , ) = bounties.bounties(id);
        assertEq(uint8(status), uint8(BuilderBounties.Status.Cancelled));
    }

    function test_cancelBounty_revertsIfNotPoster() public {
        uint256 id = _postBounty(poster, _defaultDeadline());
        vm.prank(stranger);
        vm.expectRevert(bytes("not your bounty"));
        bounties.cancelBounty(id);
    }

    // =========================================================================================
    // applyToBounty / withdrawApplication / removeApplicant / purgeBlacklistedApplicant
    // =========================================================================================

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

    function test_applyToBounty_revertsIfPosterBlacklisted() public {
        // C4 fix: a poster blacklisted after posting can't receive new applicants either.
        uint256 id = _postBounty(poster, _defaultDeadline());
        bounties.setPosterBlacklisted(poster, true);
        vm.prank(builder);
        vm.expectRevert(bytes("poster blacklisted"));
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

    function test_withdrawApplication_freesSlotForAnother() public {
        // B2 fix: an applicant list is no longer a one-way, ever-growing list.
        uint256 id = _postBounty(poster, _defaultDeadline());
        for (uint256 i = 0; i < 30; i++) {
            address applicant = address(uint160(0x9000 + i));
            _setContact(applicant, "applicant_x", "");
            vm.prank(applicant);
            bounties.applyToBounty(id);
        }
        address toLeave = address(uint160(0x9000));
        vm.prank(toLeave);
        bounties.withdrawApplication(id);

        assertFalse(bounties.hasApplied(id, toLeave));
        assertEq(bounties.getApplicants(id).length, 29);

        address newApplicant = address(uint160(0xA111));
        _setContact(newApplicant, "new_x", "");
        vm.prank(newApplicant);
        bounties.applyToBounty(id); // no longer reverts "too many applicants"
        assertEq(bounties.getApplicants(id).length, 30);
    }

    function test_withdrawApplication_revertsIfNotApplied() public {
        uint256 id = _postBounty(poster, _defaultDeadline());
        vm.prank(builder);
        vm.expectRevert(bytes("not an applicant"));
        bounties.withdrawApplication(id);
    }

    function test_withdrawApplication_revertsIfAlreadySelected() public {
        uint256 id = _selected(_defaultDeadline());
        vm.prank(builder);
        vm.expectRevert(bytes("already selected, use releaseBounty"));
        bounties.withdrawApplication(id);
    }

    function test_removeApplicant_byPoster() public {
        uint256 id = _postBounty(poster, _defaultDeadline());
        vm.prank(builder);
        bounties.applyToBounty(id);

        vm.prank(poster);
        bounties.removeApplicant(id, builder);

        assertFalse(bounties.hasApplied(id, builder));
        assertEq(bounties.getApplicants(id).length, 0);
    }

    function test_removeApplicant_revertsIfNotPoster() public {
        uint256 id = _postBounty(poster, _defaultDeadline());
        vm.prank(builder);
        bounties.applyToBounty(id);

        vm.prank(stranger);
        vm.expectRevert(bytes("not your bounty"));
        bounties.removeApplicant(id, builder);
    }

    function test_purgeBlacklistedApplicant_byOwnerOrGuardian() public {
        uint256 id = _postBounty(poster, _defaultDeadline());
        vm.prank(builder);
        bounties.applyToBounty(id);
        bounties.setBuilderBlacklisted(builder, true);

        bounties.purgeBlacklistedApplicant(id, builder);

        assertFalse(bounties.hasApplied(id, builder));
        assertEq(bounties.getApplicants(id).length, 0);
    }

    function test_purgeBlacklistedApplicant_revertsIfNotBlacklisted() public {
        uint256 id = _postBounty(poster, _defaultDeadline());
        vm.prank(builder);
        bounties.applyToBounty(id);

        vm.expectRevert(bytes("not blacklisted"));
        bounties.purgeBlacklistedApplicant(id, builder);
    }

    function test_purgeBlacklistedApplicant_revertsForNonOwnerNonGuardian() public {
        uint256 id = _postBounty(poster, _defaultDeadline());
        vm.prank(builder);
        bounties.applyToBounty(id);
        bounties.setBuilderBlacklisted(builder, true);

        vm.prank(stranger);
        vm.expectRevert(bytes("not authorized"));
        bounties.purgeBlacklistedApplicant(id, builder);
    }

    // =========================================================================================
    // selectBuilder / releaseBounty
    // =========================================================================================

    function test_selectBuilder_success() public {
        uint256 id = _postBounty(poster, _defaultDeadline());
        vm.prank(builder);
        bounties.applyToBounty(id);
        vm.prank(poster);
        bounties.selectBuilder(id, builder);

        (, address bBuilder, , , , , , , BuilderBounties.Status status, , ) = bounties.bounties(id);
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
        uint256 id = _postBounty(poster, _defaultDeadline());
        vm.prank(poster);
        vm.expectRevert(bytes("builder must apply first"));
        bounties.selectBuilder(id, builder);
    }

    function test_selectBuilder_revertsIfBuilderHasNoContact() public {
        uint256 id = _postBounty(poster, _defaultDeadline());
        vm.prank(builder);
        bounties.applyToBounty(id);
        bounties.clearProfile(builder);
        vm.prank(poster);
        vm.expectRevert(bytes("builder has no contact info set"));
        bounties.selectBuilder(id, builder);
    }

    function test_selectBuilder_revertsIfNotEnoughTimeLeft() public {
        uint64 deadline = _defaultDeadline();
        uint256 id = _postBounty(poster, deadline);
        vm.prank(builder);
        bounties.applyToBounty(id);
        vm.warp(deadline - 1);
        vm.prank(poster);
        vm.expectRevert(bytes("not enough time left to select"));
        bounties.selectBuilder(id, builder);
    }

    function test_griefBlacklist_noLongerPossible() public {
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

        (, address bBuilder, , , , , , , BuilderBounties.Status status, , ) = bounties.bounties(id);
        assertEq(bBuilder, address(0));
        assertEq(uint8(status), uint8(BuilderBounties.Status.Open));

        vm.prank(builder2);
        bounties.applyToBounty(id);
        vm.prank(poster);
        bounties.selectBuilder(id, builder2);

        (, address bBuilder2, , , , , , , BuilderBounties.Status status2, , ) = bounties.bounties(id);
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

    function test_releaseBounty_revertsIfTooCloseToDeadline() public {
        // B3 fix: releasing must leave the same lead time selecting does, so a builder can't dodge
        // the strike markExpired would give them by releasing at the last second.
        uint64 deadline = _defaultDeadline();
        uint256 id = _selected(deadline);
        vm.warp(deadline - 1);
        vm.prank(builder);
        vm.expectRevert(bytes("too close to deadline to release"));
        bounties.releaseBounty(id);
    }

    function test_releaseBounty_clearsApplicationSoReselectionNeedsConsentAgain() public {
        uint256 id = _postBounty(poster, _defaultDeadline());
        vm.prank(builder);
        bounties.applyToBounty(id);
        vm.prank(poster);
        bounties.selectBuilder(id, builder);

        vm.prank(builder);
        bounties.releaseBounty(id);

        assertFalse(bounties.hasApplied(id, builder));
        assertEq(bounties.getApplicants(id).length, 0);

        vm.prank(poster);
        vm.expectRevert(bytes("builder must apply first"));
        bounties.selectBuilder(id, builder);
    }

    // =========================================================================================
    // submitProof / approveBounty / claimAbandonedSubmission
    // =========================================================================================

    function test_submitProof_success() public {
        uint256 id = _selected(_defaultDeadline());
        vm.prank(builder);
        bounties.submitProof(id, "https://github.com/example/pr/1");

        (, , , , , , , , BuilderBounties.Status status, string memory proofLink, ) = bounties.bounties(id);
        assertEq(uint8(status), uint8(BuilderBounties.Status.Submitted));
        assertEq(proofLink, "https://github.com/example/pr/1");
    }

    function test_submitProof_revertsIfNotClaimant() public {
        uint256 id = _selected(_defaultDeadline());
        vm.prank(builder2);
        vm.expectRevert(bytes("not your claim"));
        bounties.submitProof(id, "https://example.com/proof");
    }

    function test_submitProof_revertsAfterDeadline() public {
        // C1 fix: submitting after the deadline would otherwise dodge the markExpired strike.
        uint64 deadline = _defaultDeadline();
        uint256 id = _selected(deadline);
        vm.warp(deadline + 1);
        vm.prank(builder);
        vm.expectRevert(bytes("deadline passed"));
        bounties.submitProof(id, "https://example.com/proof");
    }

    function test_submitProof_allowedEvenIfBuilderLaterBlacklisted() public {
        // C3 fix: blacklist gates entry points (apply/select), not work already in progress.
        uint256 id = _selected(_defaultDeadline());
        bounties.setBuilderBlacklisted(builder, true);

        vm.prank(builder);
        bounties.submitProof(id, "https://example.com/proof");

        (, , , , , , , , BuilderBounties.Status status, , ) = bounties.bounties(id);
        assertEq(uint8(status), uint8(BuilderBounties.Status.Submitted));
    }

    function test_approveBounty_awardsPointsAndCompletion() public {
        uint256 id = _selected(_defaultDeadline());
        vm.prank(builder);
        bounties.submitProof(id, "https://example.com/proof");
        vm.prank(poster);
        bounties.approveBounty(id);

        (, , , , , , , , BuilderBounties.Status status, , ) = bounties.bounties(id);
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

    function test_approveBounty_succeedsEvenIfPosterLaterBlacklisted() public {
        // C3 fix.
        uint256 id = _selected(_defaultDeadline());
        vm.prank(builder);
        bounties.submitProof(id, "https://example.com/proof");
        bounties.setPosterBlacklisted(poster, true);

        vm.prank(poster);
        bounties.approveBounty(id);

        assertEq(bounties.builderPoints(builder), 100);
    }

    function test_approveBounty_succeedsEvenIfBuilderLaterBlacklisted() public {
        // C3 fix.
        uint256 id = _selected(_defaultDeadline());
        vm.prank(builder);
        bounties.submitProof(id, "https://example.com/proof");
        bounties.setBuilderBlacklisted(builder, true);

        vm.prank(poster);
        bounties.approveBounty(id);

        assertEq(bounties.builderPoints(builder), 100);
    }

    function test_approveBounty_succeedsLongAfterDeadline() public {
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

    function test_claimAbandonedSubmission_afterTimeout() public {
        uint256 id = _selected(_defaultDeadline());
        vm.prank(builder);
        bounties.submitProof(id, "https://example.com/proof");

        vm.warp(block.timestamp + bounties.REVIEW_TIMEOUT());

        vm.prank(builder);
        bounties.claimAbandonedSubmission(id);

        (, , , , , , , , BuilderBounties.Status status, , ) = bounties.bounties(id);
        assertEq(uint8(status), uint8(BuilderBounties.Status.Approved));
        assertEq(bounties.builderPoints(builder), 100);
    }

    function test_claimAbandonedSubmission_revertsBeforeTimeout() public {
        uint256 id = _selected(_defaultDeadline());
        vm.prank(builder);
        bounties.submitProof(id, "https://example.com/proof");

        vm.warp(block.timestamp + bounties.REVIEW_TIMEOUT() - 1);
        vm.prank(builder);
        vm.expectRevert(bytes("review window still open"));
        bounties.claimAbandonedSubmission(id);
    }

    function test_claimAbandonedSubmission_revertsIfNotClaimant() public {
        uint256 id = _selected(_defaultDeadline());
        vm.prank(builder);
        bounties.submitProof(id, "https://example.com/proof");
        vm.warp(block.timestamp + bounties.REVIEW_TIMEOUT());

        vm.prank(builder2);
        vm.expectRevert(bytes("not your claim"));
        bounties.claimAbandonedSubmission(id);
    }

    function test_claimAbandonedSubmission_blockedByTimelyApproval() public {
        uint256 id = _selected(_defaultDeadline());
        vm.prank(builder);
        bounties.submitProof(id, "https://example.com/proof");
        vm.prank(poster);
        bounties.approveBounty(id);

        vm.warp(block.timestamp + bounties.REVIEW_TIMEOUT());
        vm.prank(builder);
        vm.expectRevert(bytes("not submitted"));
        bounties.claimAbandonedSubmission(id);
    }

    // =========================================================================================
    // rejectProof
    // =========================================================================================

    function test_rejectProof_reopensWithNoStrike() public {
        uint256 id = _selected(_defaultDeadline());
        vm.prank(builder);
        bounties.submitProof(id, "https://example.com/junk-link");

        vm.prank(poster);
        bounties.rejectProof(id);

        (, address bBuilder, , , , , , , BuilderBounties.Status status, string memory proofLink, ) = bounties.bounties(id);
        assertEq(bBuilder, address(0));
        assertEq(uint8(status), uint8(BuilderBounties.Status.Open));
        assertEq(proofLink, "");
        assertFalse(bounties.hasApplied(id, builder));
        assertEq(bounties.builderMissedStrikes(builder), 0);
        assertFalse(bounties.builderBlacklisted(builder));
    }

    function test_rejectProof_allowsSelectingSomeoneElse() public {
        uint256 id = _selected(_defaultDeadline());
        vm.prank(builder);
        bounties.submitProof(id, "https://example.com/junk-link");
        vm.prank(poster);
        bounties.rejectProof(id);

        vm.prank(builder2);
        bounties.applyToBounty(id);
        vm.prank(poster);
        bounties.selectBuilder(id, builder2);

        (, address bBuilder, , , , , , , BuilderBounties.Status status, , ) = bounties.bounties(id);
        assertEq(bBuilder, builder2);
        assertEq(uint8(status), uint8(BuilderBounties.Status.Claimed));
    }

    function test_rejectProof_goesToExpiredPastDeadline() public {
        // C2 fix: reopening to Open past the deadline would leave a bounty nobody could ever be
        // selected for.
        uint64 deadline = _defaultDeadline();
        uint256 id = _selected(deadline);
        vm.prank(builder);
        bounties.submitProof(id, "https://example.com/proof");

        vm.warp(deadline + 1);
        vm.prank(poster);
        bounties.rejectProof(id);

        (, address bBuilder, , , , , , , BuilderBounties.Status status, , ) = bounties.bounties(id);
        assertEq(bBuilder, address(0));
        assertEq(uint8(status), uint8(BuilderBounties.Status.Expired));
        assertEq(bounties.builderMissedStrikes(builder), 0);
    }

    function test_rejectProof_revertsIfNotPoster() public {
        uint256 id = _selected(_defaultDeadline());
        vm.prank(builder);
        bounties.submitProof(id, "https://example.com/junk-link");
        vm.prank(stranger);
        vm.expectRevert(bytes("not your bounty"));
        bounties.rejectProof(id);
    }

    function test_rejectProof_revertsIfNotSubmitted() public {
        uint256 id = _selected(_defaultDeadline());
        vm.prank(poster);
        vm.expectRevert(bytes("not submitted"));
        bounties.rejectProof(id);
    }

    // =========================================================================================
    // markExpired
    // =========================================================================================

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

        (, , , , , , , , BuilderBounties.Status status, , ) = bounties.bounties(id);
        assertEq(uint8(status), uint8(BuilderBounties.Status.Expired));
        assertEq(bounties.builderMissedStrikes(builder), 1);
        assertFalse(bounties.builderBlacklisted(builder));
    }

    function test_markExpired_openBountyExpiresWithNoStrike() public {
        uint64 deadline = _defaultDeadline();
        uint256 id = _postBounty(poster, deadline);
        vm.warp(deadline + 1);
        bounties.markExpired(id);

        (, , , , , , , , BuilderBounties.Status status, , ) = bounties.bounties(id);
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
        uint64 deadline = _defaultDeadline();
        uint256 id = _selected(deadline);
        vm.prank(builder);
        bounties.submitProof(id, "https://example.com/proof");

        vm.warp(deadline + 1);
        vm.expectRevert(bytes("already finalized"));
        bounties.markExpired(id);

        assertEq(bounties.builderMissedStrikes(builder), 0);
        assertFalse(bounties.builderBlacklisted(builder));
    }

    function test_markExpired_cannotFrontrunALateApproval() public {
        uint64 deadline = _defaultDeadline();
        uint256 id = _selected(deadline);
        vm.prank(builder);
        bounties.submitProof(id, "https://example.com/proof");

        vm.warp(deadline + 1);
        vm.expectRevert(bytes("already finalized"));
        bounties.markExpired(id);

        vm.prank(poster);
        bounties.approveBounty(id);

        (, , , , , , , , BuilderBounties.Status status, , ) = bounties.bounties(id);
        assertEq(uint8(status), uint8(BuilderBounties.Status.Approved));
    }

    function test_unblacklist_resetsStrikes() public {
        // C7 fix: otherwise the very next missed deadline immediately re-blacklists them off a
        // strike count from before the review.
        for (uint256 i = 0; i < 3; i++) {
            uint64 deadline = _defaultDeadline();
            uint256 id = _selected(deadline);
            vm.warp(deadline + 1);
            bounties.markExpired(id);
        }
        assertTrue(bounties.builderBlacklisted(builder));

        bounties.setBuilderBlacklisted(builder, false);
        assertEq(bounties.builderMissedStrikes(builder), 0);
    }

    // =========================================================================================
    // reportNonPayment
    // =========================================================================================

    function test_reportNonPayment_success() public {
        uint256 id = _approved(_defaultDeadline());
        vm.prank(builder);
        bounties.reportNonPayment(id);

        (, , , , , , , , , , bool reported) = bounties.bounties(id);
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

    // =========================================================================================
    // setProfile / builder registry
    // =========================================================================================

    function test_setProfile_registersBuilderOnlyOnce() public {
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
            BuilderBounties.ProfileInput({available: true, rate: tooLong, skills: "", x: "", tg: "", github: "", portfolio: ""})
        );
    }

    function test_setProfile_revertsIfBuilderBlacklisted() public {
        bounties.setBuilderBlacklisted(builder, true);
        vm.prank(builder);
        vm.expectRevert(bytes("blacklisted"));
        bounties.setProfile(
            BuilderBounties.ProfileInput({available: true, rate: "", skills: "", x: "new_handle", tg: "", github: "", portfolio: ""})
        );
    }

    function test_setProfile_revertsIfPosterBlacklisted() public {
        bounties.setPosterBlacklisted(poster, true);
        vm.prank(poster);
        vm.expectRevert(bytes("blacklisted"));
        bounties.setProfile(
            BuilderBounties.ProfileInput({available: true, rate: "", skills: "", x: "new_handle", tg: "", github: "", portfolio: ""})
        );
    }

    function test_clearProfile_doesNotBypassBlacklistForReprofiling() public {
        bounties.setBuilderBlacklisted(builder, true);
        bounties.clearProfile(builder);
        vm.prank(builder);
        vm.expectRevert(bytes("blacklisted"));
        bounties.setProfile(
            BuilderBounties.ProfileInput({available: true, rate: "", skills: "", x: "back_again", tg: "", github: "", portfolio: ""})
        );
    }

    // =========================================================================================
    // Owner / Guardian moderation
    // =========================================================================================

    function test_onlyOwnerOrGuardian_revertsForStranger() public {
        vm.startPrank(stranger);
        vm.expectRevert(bytes("not authorized"));
        bounties.setBuilderBlacklisted(builder, true);
        vm.expectRevert(bytes("not authorized"));
        bounties.setPosterBlacklisted(poster, true);
        vm.expectRevert(bytes("not authorized"));
        bounties.removeBounty(0);
        vm.expectRevert(bytes("not authorized"));
        bounties.clearProfile(builder);
        vm.stopPrank();
    }

    function test_removeBounty_forceCancelsRegardlessOfStatus() public {
        uint256 id = _selected(_defaultDeadline());
        bounties.removeBounty(id);
        (, , , , , , , , BuilderBounties.Status status, , ) = bounties.bounties(id);
        assertEq(uint8(status), uint8(BuilderBounties.Status.Cancelled));
    }

    function test_removeBounty_revertsOnDoubleRemoval() public {
        uint256 id = _postBounty(poster, _defaultDeadline());
        bounties.removeBounty(id);
        vm.expectRevert(bytes("already cancelled"));
        bounties.removeBounty(id);
    }

    function test_removeBounty_revertsIfApproved() public {
        uint256 id = _approved(_defaultDeadline());
        vm.expectRevert(bytes("cannot remove an approved bounty"));
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

    // =========================================================================================
    // FSI sequence uniqueness
    // =========================================================================================

    function test_seqNumbersAreUniquePerBounty() public {
        uint256 id = _postBounty(poster, _defaultDeadline());

        vm.recordLogs();

        vm.prank(builder);
        bounties.applyToBounty(id);
        vm.prank(poster);
        bounties.selectBuilder(id, builder);
        vm.prank(builder);
        bounties.releaseBounty(id);

        vm.prank(builder2);
        bounties.applyToBounty(id);
        vm.prank(poster);
        bounties.selectBuilder(id, builder2);
        vm.prank(builder2);
        bounties.releaseBounty(id);

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
        uint256 id = _postBounty(poster, _defaultDeadline());
        bounties.removeBounty(id);
        vm.expectRevert(bytes("already cancelled"));
        bounties.removeBounty(id);
    }
}
