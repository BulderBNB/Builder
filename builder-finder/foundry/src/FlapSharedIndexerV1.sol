// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Vendored verbatim from the Flap Apps draft spec (docs.utter.cash/en/docs/mini-app-spec).
// Dependency-free base contract — inherit it to emit Flap Shared Indexer (FSI) events.
abstract contract FlapSharedIndexerV1 {
    event FlapSharedIndexerAddrUint(bytes32 ns, address key, uint256 value, string data);
    event FlapSharedIndexerUintAddrUint(bytes32 ns, uint256 round, address account, uint256 value, string data);
    event FlapSharedIndexerFeed(
        bytes32 ns, uint256 id, uint256 seq, address actor, address related, uint256 value, string data
    );
    event FlapSharedIndexerLog(
        bytes32 ns, uint256 id, address actor, address related, uint256 amount, uint256 extra
    );

    function flapSharedIndexerSpecVersion() public pure virtual returns (string memory) {
        return "fsi-v1";
    }

    /// Template A: absolute value for one address.
    function _fsiSetAddr(bytes32 ns, address key, uint256 absoluteValue) internal {
        emit FlapSharedIndexerAddrUint(ns, key, absoluteValue, "");
    }

    /// Template B: absolute value for one user in one round. Pass account = address(0) for pure round stats.
    function _fsiSetRound(bytes32 ns, uint256 round, address account, uint256 absoluteValue) internal {
        emit FlapSharedIndexerUintAddrUint(ns, round, account, absoluteValue, "");
    }

    /// Template L: seq is unique under the same (ns, id). 0 is the first record. value is block.timestamp.
    function _fsiAppend(bytes32 ns, uint256 id, uint256 seq, address actor, address related, string memory data)
        internal
    {
        emit FlapSharedIndexerFeed(ns, id, seq, actor, related, block.timestamp, data);
    }

    /// Template G: no sequence number required; the contract stores no counter.
    function _fsiLog(bytes32 ns, uint256 id, address actor, address related, uint256 amount, uint256 extra)
        internal
    {
        emit FlapSharedIndexerLog(ns, id, actor, related, amount, extra);
    }
}
