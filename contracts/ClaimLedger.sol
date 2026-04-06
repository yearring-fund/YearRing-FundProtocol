// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";

/// @title ClaimLedger
/// @notice Non-transferable, non-pledgeable claim certificates for Exit mode asset delivery.
///         Only records entitlements — does not hold assets.
///         Issuance and settlement are restricted to VAULT_ROLE.
contract ClaimLedger is AccessControl {
    bytes32 public constant VAULT_ROLE = keccak256("VAULT_ROLE");

    error ZeroAmount();
    error ZeroAddress();
    error AlreadySettled();
    error NotFound();
    error WrongBeneficiary(address expected, address provided);

    struct ClaimRecord {
        uint256 roundId;
        address assetType;      // token address (e.g. USDC)
        uint256 nominalAmount;  // nominal units owed
        address beneficiary;    // recipient recorded at issuance
        bool settled;
    }

    mapping(uint256 => ClaimRecord) public claims;
    mapping(address => uint256[]) private _userClaimIds;
    uint256 public nextClaimId;

    event ClaimIssued(uint256 indexed claimId, address indexed beneficiary, uint256 roundId, address assetType, uint256 nominalAmount);
    event ClaimSettled(uint256 indexed claimId, address indexed beneficiary);

    constructor(address admin_) {
        if (admin_ == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
    }

    function issueClaim(
        address beneficiary,
        uint256 roundId,
        address assetType,
        uint256 nominalAmount
    ) external onlyRole(VAULT_ROLE) returns (uint256 claimId) {
        if (nominalAmount == 0) revert ZeroAmount();
        if (beneficiary == address(0)) revert ZeroAddress();
        claimId = nextClaimId++;
        claims[claimId] = ClaimRecord(roundId, assetType, nominalAmount, beneficiary, false);
        _userClaimIds[beneficiary].push(claimId);
        emit ClaimIssued(claimId, beneficiary, roundId, assetType, nominalAmount);
    }

    function settleClaim(uint256 claimId, address beneficiary) external onlyRole(VAULT_ROLE) {
        ClaimRecord storage c = claims[claimId];
        if (c.nominalAmount == 0) revert NotFound();
        if (c.settled) revert AlreadySettled();
        if (c.beneficiary != beneficiary) revert WrongBeneficiary(c.beneficiary, beneficiary);
        c.settled = true;
        emit ClaimSettled(claimId, beneficiary);
    }

    function userClaimIds(address user) external view returns (uint256[] memory) {
        return _userClaimIds[user];
    }
}
