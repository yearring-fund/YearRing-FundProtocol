/**
 * redeploy_with_permit.ts — Full V2 redeploy with EIP-2612 Permit support
 *
 * Redeploys the following contracts (all have immutable vault/ledger references):
 *   FundVaultV01         — now inherits ERC20Permit
 *   LockLedgerV02        — vaultShares immutable → new vault
 *   LockBenefitV02       — ledger immutable → new ledger
 *   LockRewardManagerV02 — vault+ledger immutable + lockWithPermit
 *   BeneficiaryModuleV02 — ledger immutable → new ledger
 *   UserStateEngineV02   — ledger immutable → new ledger
 *   MetricsLayerV02      — vault+ledger immutable → both new
 *
 * Preserved (no vault/ledger immutable):
 *   USDC, RewardToken, AaveV3StrategyV01, GovernanceSignalV02,
 *   ProtocolTimelockV02, ClaimLedger, StrategyManagerV01 (updated via setVault)
 *
 * Post-deploy setup (all-in-one):
 *   - FundVaultV01: setModules, setLockLedger, setMgmtFeeBpsPerMonth, setReserveRatioBps, addToAllowlist
 *   - LockLedgerV02: grant OPERATOR_ROLE to LockRewardManagerV02 + BeneficiaryModuleV02
 *   - Treasury: approve fbUSDC + RWT to new LockRewardManagerV02
 *   - StrategyManagerV01: setVault(newVaultAddress)
 *
 * Allowlist: admin is always added. Set EXTRA_ALLOWLIST in .env (comma-separated) for more.
 *   e.g. EXTRA_ALLOWLIST=0xabc...,0xdef...
 *
 * Usage:
 *   npx hardhat run scripts/v2/redeploy_with_permit.ts --network base
 */

import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const SEP = () => console.log("-".repeat(62));
const HDR = (s: string) => { SEP(); console.log("  " + s); SEP(); };

async function main() {
  const signers    = await ethers.getSigners();
  const deployer   = signers[0];

  // ── Load deployment JSON ─────────────────────────────────────────────────
  const deploymentsPath = path.join(__dirname, `../../deployments/${network.name}.json`);
  if (!fs.existsSync(deploymentsPath)) {
    throw new Error(`No deployment file at ${deploymentsPath}.`);
  }
  const dep = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
  const c   = dep.contracts;

  const adminAddr    = dep.config?.admin    || deployer.address;
  const treasuryAddr = dep.config?.treasury || deployer.address;
  const guardianAddr = dep.config?.guardian || deployer.address;

  // Validate signer is admin
  if (deployer.address.toLowerCase() !== adminAddr.toLowerCase()) {
    throw new Error(
      `Signer mismatch.\n  Signer : ${deployer.address}\n  Admin  : ${adminAddr}\n` +
      `Use the private key matching the admin address.`
    );
  }

  // Locate treasury signer
  const treasurySigner = signers.find(
    s => s.address.toLowerCase() === treasuryAddr.toLowerCase()
  );
  if (!treasurySigner) {
    throw new Error(
      `Treasury signer not found.\n  Expected: ${treasuryAddr}\n` +
      `  Available: ${signers.map(s => s.address).join(", ")}\n` +
      `Ensure TREASURY_PRIVATE_KEY is set in .env.`
    );
  }

  // Preserved addresses (not redeployed)
  const usdcAddress         = c.USDC;
  const rewardTokenAddress  = c.RewardToken;
  const strategyMgrAddress  = c.StrategyManagerV01;
  const aaveStratAddress    = c.AaveV3StrategyV01;
  const governanceAddress   = c.GovernanceSignalV02;
  const timelockAddress     = c.ProtocolTimelockV02;
  const claimLedgerAddress  = c.ClaimLedger;

  console.log("\n" + "=".repeat(62));
  console.log("  FinancialBase — Full Redeploy with EIP-2612 Permit");
  console.log("=".repeat(62));
  console.log("Network    :", network.name);
  console.log("Deployer   :", deployer.address);
  console.log("Admin      :", adminAddr);
  console.log("Treasury   :", treasuryAddr);
  console.log("Guardian   :", guardianAddr);
  console.log("StratMgr   :", strategyMgrAddress, "(preserved, setVault will be called)");
  console.log("RewardToken:", rewardTokenAddress, "(preserved)");

  function save() {
    fs.writeFileSync(deploymentsPath, JSON.stringify(dep, null, 2));
  }

  // ── 1. FundVaultV01 (ERC20Permit) ────────────────────────────────────────
  HDR("1 / 7   FundVaultV01 (new — ERC20Permit)");
  const vault = await (await ethers.getContractFactory("FundVaultV01")).deploy(
    usdcAddress,
    "FinancialBase Fund",
    "fbUSDC",
    treasuryAddr,
    adminAddr
  );
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();
  console.log("  FundVaultV01 :", vaultAddress);
  c.FundVaultV01 = vaultAddress;
  save();

  // ── 2. LockLedgerV02 ─────────────────────────────────────────────────────
  HDR("2 / 7   LockLedgerV02");
  const ledger = await (await ethers.getContractFactory("LockLedgerV02")).deploy(
    vaultAddress, adminAddr, guardianAddr
  );
  await ledger.waitForDeployment();
  const ledgerAddress = await ledger.getAddress();
  console.log("  LockLedgerV02 :", ledgerAddress);
  c.LockLedgerV02 = ledgerAddress;
  save();

  // ── 3. LockBenefitV02 ────────────────────────────────────────────────────
  HDR("3 / 7   LockBenefitV02");
  const benefit = await (await ethers.getContractFactory("LockBenefitV02")).deploy(ledgerAddress);
  await benefit.waitForDeployment();
  const benefitAddress = await benefit.getAddress();
  console.log("  LockBenefitV02 :", benefitAddress);
  c.LockBenefitV02 = benefitAddress;
  save();

  // ── 4. LockRewardManagerV02 (lockWithPermit) ─────────────────────────────
  HDR("4 / 7   LockRewardManagerV02 (new — lockWithPermit)");
  const lockMgr = await (await ethers.getContractFactory("LockRewardManagerV02")).deploy(
    ledgerAddress, benefitAddress, rewardTokenAddress,
    vaultAddress,  // vaultShares_
    vaultAddress,  // vault_ (fee reading)
    treasuryAddr, adminAddr, guardianAddr
  );
  await lockMgr.waitForDeployment();
  const lockMgrAddress = await lockMgr.getAddress();
  console.log("  LockRewardManagerV02 :", lockMgrAddress);
  c.LockRewardManagerV02 = lockMgrAddress;
  save();

  // ── 5. BeneficiaryModuleV02 ──────────────────────────────────────────────
  HDR("5 / 7   BeneficiaryModuleV02");
  const benModule = await (await ethers.getContractFactory("BeneficiaryModuleV02")).deploy(
    ledgerAddress, adminAddr
  );
  await benModule.waitForDeployment();
  const benModuleAddress = await benModule.getAddress();
  console.log("  BeneficiaryModuleV02 :", benModuleAddress);
  c.BeneficiaryModuleV02 = benModuleAddress;
  save();

  // ── 6. View modules ───────────────────────────────────────────────────────
  HDR("6 / 7   UserStateEngineV02 + MetricsLayerV02");
  const engine = await (await ethers.getContractFactory("UserStateEngineV02")).deploy(ledgerAddress);
  await engine.waitForDeployment();
  const engineAddress = await engine.getAddress();
  console.log("  UserStateEngineV02 :", engineAddress);
  c.UserStateEngineV02 = engineAddress;
  save();

  const metrics = await (await ethers.getContractFactory("MetricsLayerV02")).deploy(
    vaultAddress, ledgerAddress
  );
  await metrics.waitForDeployment();
  const metricsAddress = await metrics.getAddress();
  console.log("  MetricsLayerV02 :", metricsAddress);
  c.MetricsLayerV02 = metricsAddress;
  save();

  // ── 7. Post-deploy setup ──────────────────────────────────────────────────
  HDR("7 / 7   Post-deploy setup");

  // 7a. FundVaultV01: setModules
  console.log("  7a. vault.setModules(strategyManager)");
  await (await vault.setModules(strategyMgrAddress)).wait();
  console.log("      strategyManager set ✓");

  // 7b. FundVaultV01: setLockLedger
  console.log("  7b. vault.setLockLedger(lockLedger)");
  await (await vault.setLockLedger(ledgerAddress)).wait();
  console.log("      lockLedger set ✓");

  // 7c. FundVaultV01: mgmtFee = 9 bps/month (~1%/year)
  console.log("  7c. vault.setMgmtFeeBpsPerMonth(9)");
  await (await vault.setMgmtFeeBpsPerMonth(9)).wait();
  console.log("      mgmtFeeBpsPerMonth = 9 ✓");

  // 7d. FundVaultV01: reserveRatio = 30%
  console.log("  7d. vault.setReserveRatioBps(3000)");
  await (await vault.setReserveRatioBps(3000)).wait();
  console.log("      reserveRatioBps = 3000 ✓");

  // 7e. Allowlist: admin always added; extra addresses via EXTRA_ALLOWLIST env
  console.log("  7e. Allowlist setup");
  const extraAddresses = (process.env.EXTRA_ALLOWLIST || "")
    .split(",")
    .map(a => a.trim())
    .filter(a => a.length > 0 && ethers.isAddress(a));
  const allowlistAddresses = [adminAddr, ...extraAddresses];
  for (const addr of allowlistAddresses) {
    await (await vault.addToAllowlist(addr)).wait();
    console.log(`      addToAllowlist(${addr}) ✓`);
  }

  // 7f. LockLedger: OPERATOR_ROLE
  console.log("  7f. LockLedger OPERATOR_ROLE grants");
  const OPERATOR_ROLE = await ledger.OPERATOR_ROLE();
  await (await ledger.grantRole(OPERATOR_ROLE, lockMgrAddress)).wait();
  console.log(`      OPERATOR_ROLE → LockRewardManagerV02 ✓`);
  await (await ledger.grantRole(OPERATOR_ROLE, benModuleAddress)).wait();
  console.log(`      OPERATOR_ROLE → BeneficiaryModuleV02 ✓`);

  // 7g. Treasury approvals
  console.log("  7g. Treasury approvals");
  const vaultAsToken  = await ethers.getContractAt("FundVaultV01", vaultAddress);
  const rewardToken   = await ethers.getContractAt("RewardToken",  rewardTokenAddress);

  await (await vaultAsToken.connect(treasurySigner).approve(lockMgrAddress, ethers.MaxUint256)).wait();
  console.log("      fbUSDC → LockRewardManagerV02: MaxUint256 ✓");

  await (await rewardToken.connect(treasurySigner).approve(lockMgrAddress, ethers.MaxUint256)).wait();
  console.log("      RWT   → LockRewardManagerV02: MaxUint256 ✓");

  // 7h. StrategyManagerV01: update vault address
  if (strategyMgrAddress) {
    console.log("  7h. StrategyManagerV01.setVault(newVault)");
    const stratMgr = await ethers.getContractAt("StrategyManagerV01", strategyMgrAddress);
    await (await stratMgr.setVault(vaultAddress)).wait();
    console.log("      vault updated on StrategyManagerV01 ✓");
  }

  // ── Update deployment metadata ────────────────────────────────────────────
  dep.v2 = {
    mode:                   "demo-minimal",
    optionalModulesDeployed: false,
    deployedAt:              new Date().toISOString(),
    deployedBy:              deployer.address,
  };
  dep.v2Setup = {
    completedAt:         new Date().toISOString(),
    completedBy:         deployer.address,
    fbUSDCApproved:      true,
    rwtApproved:         true,
    mgmtFeeBpsPerMonth:  9,
    treasuryApprovalAt:  new Date().toISOString(),
  };
  save();

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(62));
  console.log("  Redeploy complete.");
  console.log("=".repeat(62));
  console.log("FundVaultV01        :", vaultAddress);
  console.log("LockLedgerV02       :", ledgerAddress);
  console.log("LockBenefitV02      :", benefitAddress);
  console.log("LockRewardManagerV02:", lockMgrAddress);
  console.log("BeneficiaryModuleV02:", benModuleAddress);
  console.log("UserStateEngineV02  :", engineAddress);
  console.log("MetricsLayerV02     :", metricsAddress);
  console.log("-".repeat(62));
  console.log("Preserved:");
  console.log("  USDC              :", usdcAddress);
  console.log("  RewardToken       :", rewardTokenAddress);
  console.log("  StrategyManagerV01:", strategyMgrAddress, "(setVault updated)");
  console.log("  AaveV3StrategyV01 :", aaveStratAddress);
  console.log("=".repeat(62));
  console.log("\nNext: update docs/v02/index.html ADDR with new addresses above.");
  console.log("      Allowlist re-added:", allowlistAddresses.join(", "));
  if (extraAddresses.length === 0) {
    console.log("      To add more: EXTRA_ALLOWLIST=0xABC,0xDEF npx hardhat run ...");
  }
  console.log("=".repeat(62));
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
