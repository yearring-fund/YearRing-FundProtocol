// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/governance/TimelockController.sol";

/// @title ProtocolTimelockV02
/// @notice 24-hour timelock guard for non-emergency protocol governance actions.
///
/// Role layout (inherited from OZ TimelockController):
///   TIMELOCK_ADMIN_ROLE — manages timelock roles; should be renounced post-setup
///   PROPOSER_ROLE       — can schedule operations (multisig / governance address)
///   EXECUTOR_ROLE       — can execute after delay (pass address(0) for permissionless)
///   CANCELLER_ROLE      — can cancel pending ops (auto-granted to proposers)
///
/// Deployment + setup flow:
///   1. Deploy ProtocolTimelockV02(proposers=[multisig], executors=[address(0)], admin=deployer)
///   2. grantRole(DEFAULT_ADMIN_ROLE, timelockAddress) on every protocol contract
///   3. revokeRole(DEFAULT_ADMIN_ROLE, deployer) on every protocol contract
///   4. Optionally: deployer renounces TIMELOCK_ADMIN_ROLE (leaves timelock self-governed)
///
/// After setup, any non-emergency operation must be:
///   schedule() by a PROPOSER → wait MIN_DELAY (24h) → execute() by anyone
///
/// Emergency operations (pause, setMode(Paused)) remain directly callable by EMERGENCY_ROLE
/// holders on each protocol contract — they do NOT go through this timelock.
contract ProtocolTimelockV02 is TimelockController {

    /// @notice Minimum scheduling delay — 24 hours
    uint256 public constant MIN_DELAY = 24 hours;

    /// @param proposers_  Addresses authorised to schedule operations (multisig)
    /// @param executors_  Addresses authorised to execute after delay; use address(0) for anyone
    /// @param admin_      Initial TIMELOCK_ADMIN_ROLE holder; may renounce after setup
    constructor(
        address[] memory proposers_,
        address[] memory executors_,
        address          admin_
    ) TimelockController(MIN_DELAY, proposers_, executors_, admin_) {}
}
