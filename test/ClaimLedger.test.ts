import { expect } from "chai";
import { ethers } from "hardhat";
import { ClaimLedger, MockUSDC } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("ClaimLedger", function () {
  let ledger: ClaimLedger;
  let usdc: MockUSDC;
  let admin: SignerWithAddress;
  let vaultSigner: SignerWithAddress;
  let alice: SignerWithAddress;
  let other: SignerWithAddress;

  const D6 = (n: number) => ethers.parseUnits(String(n), 6);

  beforeEach(async function () {
    [, admin, vaultSigner, alice, other] = await ethers.getSigners();

    usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
    ledger = await (await ethers.getContractFactory("ClaimLedger")).deploy(admin.address);

    // Grant VAULT_ROLE to vaultSigner so it can issue/settle claims
    const VAULT_ROLE = await ledger.VAULT_ROLE();
    await ledger.connect(admin).grantRole(VAULT_ROLE, vaultSigner.address);
  });

  // -------------------------------------------------------------------------
  // issueClaim access control
  // -------------------------------------------------------------------------
  it("issueClaim requires VAULT_ROLE", async function () {
    await expect(
      ledger.connect(other).issueClaim(alice.address, 1, await usdc.getAddress(), D6(100))
    ).to.be.reverted;
  });

  // -------------------------------------------------------------------------
  // issueClaim records claim correctly
  // -------------------------------------------------------------------------
  it("issueClaim records claim correctly", async function () {
    const usdcAddr = await usdc.getAddress();
    const roundId = 1;
    const amount = D6(250);

    await ledger.connect(vaultSigner).issueClaim(alice.address, roundId, usdcAddr, amount);

    const claim = await ledger.claims(0);
    expect(claim.roundId).to.equal(roundId);
    expect(claim.assetType).to.equal(usdcAddr);
    expect(claim.nominalAmount).to.equal(amount);
    expect(claim.settled).to.equal(false);
  });

  // -------------------------------------------------------------------------
  // userClaimIds returns correct ids
  // -------------------------------------------------------------------------
  it("userClaimIds returns correct ids for user", async function () {
    const usdcAddr = await usdc.getAddress();

    await ledger.connect(vaultSigner).issueClaim(alice.address, 1, usdcAddr, D6(100));
    await ledger.connect(vaultSigner).issueClaim(alice.address, 2, usdcAddr, D6(200));
    await ledger.connect(vaultSigner).issueClaim(other.address, 3, usdcAddr, D6(300));

    const aliceIds = await ledger.userClaimIds(alice.address);
    expect(aliceIds.length).to.equal(2);
    expect(aliceIds[0]).to.equal(0);
    expect(aliceIds[1]).to.equal(1);

    const otherIds = await ledger.userClaimIds(other.address);
    expect(otherIds.length).to.equal(1);
    expect(otherIds[0]).to.equal(2);
  });

  // -------------------------------------------------------------------------
  // settleClaim marks settled=true and emits ClaimSettled
  // -------------------------------------------------------------------------
  it("settleClaim marks settled=true", async function () {
    const usdcAddr = await usdc.getAddress();
    await ledger.connect(vaultSigner).issueClaim(alice.address, 1, usdcAddr, D6(100));

    await expect(ledger.connect(vaultSigner).settleClaim(0, alice.address))
      .to.emit(ledger, "ClaimSettled")
      .withArgs(0, alice.address);

    const claim = await ledger.claims(0);
    expect(claim.settled).to.equal(true);
  });

  // -------------------------------------------------------------------------
  // settleClaim access control
  // -------------------------------------------------------------------------
  it("settleClaim requires VAULT_ROLE", async function () {
    const usdcAddr = await usdc.getAddress();
    await ledger.connect(vaultSigner).issueClaim(alice.address, 1, usdcAddr, D6(100));

    await expect(
      ledger.connect(other).settleClaim(0, alice.address)
    ).to.be.reverted;
  });

  // -------------------------------------------------------------------------
  // Cannot settle already settled claim
  // -------------------------------------------------------------------------
  it("cannot settle already settled claim", async function () {
    const usdcAddr = await usdc.getAddress();
    await ledger.connect(vaultSigner).issueClaim(alice.address, 1, usdcAddr, D6(100));

    await ledger.connect(vaultSigner).settleClaim(0, alice.address);

    await expect(
      ledger.connect(vaultSigner).settleClaim(0, alice.address)
    ).to.be.revertedWithCustomError(ledger, "AlreadySettled");
  });

  // -------------------------------------------------------------------------
  // ClaimLedger has no ERC20 transfer mechanism
  // -------------------------------------------------------------------------
  it("ClaimLedger has no transfer function", async function () {
    // ClaimLedger should NOT inherit ERC20 — verify it has no transfer(address,uint256) method
    // The contract's ABI should not contain a standard ERC20 transfer function
    const ledgerAny = ledger as any;
    // ERC20 transfer(address, uint256) returning bool should not exist
    expect(typeof ledgerAny.transfer).to.equal("undefined");
    // ERC20 transferFrom should not exist
    expect(typeof ledgerAny.transferFrom).to.equal("undefined");
    // ERC20 balanceOf(address) should not exist
    expect(typeof ledgerAny.balanceOf).to.equal("undefined");
  });

  // -------------------------------------------------------------------------
  // issueClaim reverts on zero amount
  // -------------------------------------------------------------------------
  it("issueClaim reverts on zero amount", async function () {
    await expect(
      ledger.connect(vaultSigner).issueClaim(alice.address, 1, await usdc.getAddress(), 0)
    ).to.be.revertedWithCustomError(ledger, "ZeroAmount");
  });

  // -------------------------------------------------------------------------
  // issueClaim reverts on zero address beneficiary
  // -------------------------------------------------------------------------
  it("issueClaim reverts on zero address beneficiary", async function () {
    await expect(
      ledger.connect(vaultSigner).issueClaim(ethers.ZeroAddress, 1, await usdc.getAddress(), D6(100))
    ).to.be.revertedWithCustomError(ledger, "ZeroAddress");
  });
});
