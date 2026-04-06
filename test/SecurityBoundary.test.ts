import { expect } from "chai";
import { ethers } from "hardhat";
import { FundVaultV01, MockUSDC, StrategyManagerV01, DummyStrategy } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("SecurityBoundary", function () {
  let vault: FundVaultV01;
  let usdc: MockUSDC;
  let manager: StrategyManagerV01;
  let strategy: DummyStrategy;
  let admin: SignerWithAddress;
  let treasury: SignerWithAddress;
  let alice: SignerWithAddress;

  const D6 = (n: number) => ethers.parseUnits(String(n), 6);
  const DEPOSIT = D6(1000);

  beforeEach(async function () {
    [, admin, treasury, alice] = await ethers.getSigners();

    usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
    vault = await (await ethers.getContractFactory("FundVaultV01")).deploy(
      await usdc.getAddress(),
      "fbUSDC", "fbUSDC",
      treasury.address, admin.address
    );
    manager = await (await ethers.getContractFactory("StrategyManagerV01")).deploy(
      await usdc.getAddress(),
      await vault.getAddress(),
      admin.address
    );
    strategy = await (await ethers.getContractFactory("DummyStrategy")).deploy(
      await usdc.getAddress()
    );

    await manager.connect(admin).pause();
    await manager.connect(admin).setStrategy(await strategy.getAddress());
    await manager.connect(admin).unpause();
    await vault.connect(admin).setModules(await manager.getAddress());

    await usdc.mint(alice.address, DEPOSIT);
    await usdc.connect(alice).approve(await vault.getAddress(), ethers.MaxUint256);
    await vault.connect(admin).addToAllowlist(alice.address);
    await vault.connect(alice).deposit(DEPOSIT, alice.address);
  });

  // -------------------------------------------------------------------------
  // Dangerous mint/burn interfaces must not exist
  // -------------------------------------------------------------------------
  it("FundVaultV01 has no adminMintShares function", async function () {
    expect((vault as any).adminMintShares).to.be.undefined;
  });

  it("FundVaultV01 has no adminBurnUserShares function", async function () {
    expect((vault as any).adminBurnUserShares).to.be.undefined;
  });

  // -------------------------------------------------------------------------
  // transferToStrategyManager only transfers to strategyManager (no `to` param)
  // -------------------------------------------------------------------------
  it("FundVaultV01 transferToStrategyManager always goes to strategyManager, never arbitrary address", async function () {
    // The function signature is transferToStrategyManager(uint256) — no `to` address param.
    // We verify by calling it and confirming funds go to the registered strategyManager, not anywhere else.
    await vault.connect(admin).setExternalTransfersEnabled(true);
    await vault.connect(admin).setReserveRatioBps(3000);

    const managerAddr = await manager.getAddress();
    const managerBefore = await usdc.balanceOf(managerAddr);

    // ABI check: function has exactly 1 argument (amount), not 2
    const fragment = vault.interface.getFunction("transferToStrategyManager");
    expect(fragment!.inputs.length).to.equal(1);
    expect(fragment!.inputs[0].type).to.equal("uint256");

    const toTransfer = DEPOSIT * 70n / 100n; // max 70% per V3 spec
    await vault.connect(admin).transferToStrategyManager(toTransfer);
    expect(await usdc.balanceOf(managerAddr)).to.equal(managerBefore + toTransfer);
  });

  // -------------------------------------------------------------------------
  // emergencyExit always sends to vault
  // -------------------------------------------------------------------------
  it("StrategyManager emergencyExit always sends to vault", async function () {
    await vault.connect(admin).setExternalTransfersEnabled(true);
    await vault.connect(admin).setReserveRatioBps(3000);
    const deployed = DEPOSIT * 70n / 100n; // 70%
    await vault.connect(admin).transferToStrategyManager(deployed);
    await manager.connect(admin).invest(deployed);

    const vaultAddr = await vault.getAddress();
    const vaultBefore = await usdc.balanceOf(vaultAddr);

    await manager.connect(admin).emergencyExit();

    // Deployed funds returned to vault
    expect(await usdc.balanceOf(vaultAddr)).to.equal(vaultBefore + deployed);
    // Manager has zero idle
    expect(await usdc.balanceOf(await manager.getAddress())).to.equal(0);
  });

  // -------------------------------------------------------------------------
  // No direct NAV/PPS manipulation functions
  // -------------------------------------------------------------------------
  it("admin cannot set Vault's totalAssets directly", async function () {
    expect((vault as any).setTotalAssets).to.be.undefined;
  });

  it("admin cannot set Vault's PPS directly", async function () {
    expect((vault as any).setPps).to.be.undefined;
    expect((vault as any).setPricePerShare).to.be.undefined;
  });

  // -------------------------------------------------------------------------
  // No arbitrary exit target
  // -------------------------------------------------------------------------
  it("FundVaultV01 has no exitTo(address) function", async function () {
    expect((vault as any).exitTo).to.be.undefined;
  });

  // -------------------------------------------------------------------------
  // Not upgradeable (no proxy pattern)
  // -------------------------------------------------------------------------
  it("DEFAULT_ADMIN_ROLE holder cannot upgrade core logic", async function () {
    // FundVaultV01 is not upgradeable — verify no upgradeTo or upgradeToAndCall function
    expect((vault as any).upgradeTo).to.be.undefined;
    expect((vault as any).upgradeToAndCall).to.be.undefined;

    // Also confirm there is no implementation() or _implementation() proxy slot function
    expect((vault as any).implementation).to.be.undefined;
  });
});
