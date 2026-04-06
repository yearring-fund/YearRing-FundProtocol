import { expect } from "chai";
import { ethers } from "hardhat";
import { FundVaultV01, MockUSDC, StrategyManagerV01 } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

/**
 * Phase5_Allowlist.test.ts
 *
 * Verifies the V3 C-minimal invite-only allowlist:
 *   - Allowlist controls entry (deposit receiver) — not exit (redeem / claimExitAssets)
 *   - Removal from allowlist blocks new deposits but never freezes existing holdings
 *
 * Patch1 required test cases (6 items from step1p5patch1.md):
 *   1. Non-allowlisted address deposit fails
 *   2. Allowlisted address deposit succeeds
 *   3. Allowlisted caller → non-allowlisted receiver deposit fails
 *   4. Remove from allowlist → cannot deposit
 *   5. Remove from allowlist → can still redeem
 *   6. Remove from allowlist → can still claimExitAssets
 */
describe("Phase5: Allowlist — invite-only deposit control", function () {
  let vault:   FundVaultV01;
  let manager: StrategyManagerV01;
  let usdc:    MockUSDC;

  let admin:    SignerWithAddress;
  let treasury: SignerWithAddress;
  let alice:    SignerWithAddress;
  let bob:      SignerWithAddress;
  let carol:    SignerWithAddress;

  const D6     = (n: number) => ethers.parseUnits(String(n), 6);
  const AMOUNT = D6(1_000);

  beforeEach(async function () {
    [, admin, treasury, alice, bob, carol] = await ethers.getSigners();

    usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
    vault = await (await ethers.getContractFactory("FundVaultV01")).deploy(
      await usdc.getAddress(), "fbUSDC", "fbUSDC",
      treasury.address, admin.address
    );
    manager = await (await ethers.getContractFactory("StrategyManagerV01")).deploy(
      await usdc.getAddress(), await vault.getAddress(), admin.address
    );
    await vault.connect(admin).setModules(await manager.getAddress());

    // Fund test accounts
    await usdc.mint(alice.address, AMOUNT);
    await usdc.mint(bob.address,   AMOUNT);
    await usdc.connect(alice).approve(await vault.getAddress(), ethers.MaxUint256);
    await usdc.connect(bob).approve(await vault.getAddress(),   ethers.MaxUint256);
  });

  // ── Allowlist management ─────────────────────────────────────────────────

  describe("allowlist management", function () {
    it("isAllowed defaults to false for all addresses", async function () {
      expect(await vault.isAllowed(alice.address)).to.be.false;
      expect(await vault.isAllowed(bob.address)).to.be.false;
    });

    it("addToAllowlist sets isAllowed true and emits AllowlistAdded", async function () {
      await expect(vault.connect(admin).addToAllowlist(alice.address))
        .to.emit(vault, "AllowlistAdded")
        .withArgs(alice.address);
      expect(await vault.isAllowed(alice.address)).to.be.true;
    });

    it("removeFromAllowlist sets isAllowed false and emits AllowlistRemoved", async function () {
      await vault.connect(admin).addToAllowlist(alice.address);
      await expect(vault.connect(admin).removeFromAllowlist(alice.address))
        .to.emit(vault, "AllowlistRemoved")
        .withArgs(alice.address);
      expect(await vault.isAllowed(alice.address)).to.be.false;
    });

    it("addToAllowlist reverts on zero address", async function () {
      await expect(vault.connect(admin).addToAllowlist(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(vault, "ZeroAddress");
    });

    it("only DEFAULT_ADMIN_ROLE can addToAllowlist", async function () {
      await expect(vault.connect(alice).addToAllowlist(alice.address))
        .to.be.revertedWith(/AccessControl/);
    });

    it("only DEFAULT_ADMIN_ROLE can removeFromAllowlist", async function () {
      await vault.connect(admin).addToAllowlist(alice.address);
      await expect(vault.connect(alice).removeFromAllowlist(alice.address))
        .to.be.revertedWith(/AccessControl/);
    });
  });

  // ── Patch1 required test cases ───────────────────────────────────────────

  // Case 1: 非白名单地址存款失败
  it("[C1] non-allowlisted address deposit fails with NotAllowed", async function () {
    await expect(vault.connect(alice).deposit(AMOUNT, alice.address))
      .to.be.revertedWithCustomError(vault, "NotAllowed");
  });

  // Case 2: 白名单地址存款成功
  it("[C2] allowlisted address deposit succeeds", async function () {
    await vault.connect(admin).addToAllowlist(alice.address);
    await expect(vault.connect(alice).deposit(AMOUNT, alice.address))
      .to.not.be.reverted;
    expect(await vault.balanceOf(alice.address)).to.be.gt(0n);
  });

  // Case 3: 白名单 caller → 非白名单 receiver 存款失败
  it("[C3] allowlisted caller depositing to non-allowlisted receiver fails", async function () {
    await vault.connect(admin).addToAllowlist(alice.address); // caller allowlisted
    // bob (receiver) is NOT allowlisted
    await expect(vault.connect(alice).deposit(AMOUNT, bob.address))
      .to.be.revertedWithCustomError(vault, "NotAllowed");
  });

  // Case 4: 移除白名单后，用户不能新增存款
  it("[C4] removed address cannot deposit again", async function () {
    await vault.connect(admin).addToAllowlist(alice.address);
    await vault.connect(alice).deposit(AMOUNT, alice.address); // first deposit OK

    await vault.connect(admin).removeFromAllowlist(alice.address);

    // Mint more USDC for second deposit attempt
    await usdc.mint(alice.address, AMOUNT);
    await expect(vault.connect(alice).deposit(AMOUNT, alice.address))
      .to.be.revertedWithCustomError(vault, "NotAllowed");
  });

  // Case 5: 移除白名单后，用户仍可正常 redeem
  it("[C5] removed address can still redeem existing shares", async function () {
    await vault.connect(admin).addToAllowlist(alice.address);
    await vault.connect(alice).deposit(AMOUNT, alice.address);
    const shares = await vault.balanceOf(alice.address);

    await vault.connect(admin).removeFromAllowlist(alice.address);

    // Redeem should succeed — allowlist does not freeze existing holdings
    const usdcBefore = await usdc.balanceOf(alice.address);
    await expect(vault.connect(alice).redeem(shares, alice.address, alice.address))
      .to.not.be.reverted;
    expect(await usdc.balanceOf(alice.address)).to.be.gt(usdcBefore);
    expect(await vault.balanceOf(alice.address)).to.equal(0n);
  });

  // Case 6: 移除白名单后，用户仍可 claimExitAssets
  it("[C6] removed address can still claimExitAssets in EmergencyExit mode", async function () {
    await vault.connect(admin).addToAllowlist(alice.address);
    await vault.connect(alice).deposit(AMOUNT, alice.address);
    const shares = await vault.balanceOf(alice.address);

    // Remove from allowlist
    await vault.connect(admin).removeFromAllowlist(alice.address);

    // Enter EmergencyExit and open an exit round
    await vault.connect(admin).setMode(2 /* EmergencyExit */);
    await vault.connect(alice).approve(await vault.getAddress(), shares);
    await vault.connect(admin).openExitModeRound(AMOUNT);

    // claimExitAssets should succeed even though alice is off the allowlist
    const usdcBefore = await usdc.balanceOf(alice.address);
    await expect(vault.connect(alice).claimExitAssets(1, shares))
      .to.not.be.reverted;
    expect(await usdc.balanceOf(alice.address)).to.be.gt(usdcBefore);
  });

  // ── Additional boundary checks ───────────────────────────────────────────

  it("allowlist check is on receiver, not caller — non-allowlisted caller to allowlisted receiver succeeds", async function () {
    // alice (caller) not allowlisted; bob (receiver) is allowlisted
    await vault.connect(admin).addToAllowlist(bob.address);
    // alice deposits but directs shares to bob
    await expect(vault.connect(alice).deposit(AMOUNT, bob.address))
      .to.not.be.reverted;
    expect(await vault.balanceOf(bob.address)).to.be.gt(0n);
  });

  it("multiple users can be allowlisted independently", async function () {
    await vault.connect(admin).addToAllowlist(alice.address);
    await vault.connect(admin).addToAllowlist(bob.address);

    await expect(vault.connect(alice).deposit(AMOUNT, alice.address)).to.not.be.reverted;
    await expect(vault.connect(bob).deposit(AMOUNT, bob.address)).to.not.be.reverted;

    expect(await vault.balanceOf(alice.address)).to.be.gt(0n);
    expect(await vault.balanceOf(bob.address)).to.be.gt(0n);
  });
});
