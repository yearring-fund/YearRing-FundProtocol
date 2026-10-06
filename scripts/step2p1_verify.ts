/**
 * step2p1_verify.ts — Step2 Phase 1 on-chain parameter & permission verification
 * Read-only. No state changes.
 */
import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const EXPECTED = {
  chainId:   8453,
  usdc:      "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  aavePool:  "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
  aUsdc:     "0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB",
  admin:     "0x087ea7F67d9282f0bdC43627b855F79789C6824C",
  guardian:  "0xC8052cF447d429f63E890385a6924464B85c5834",
  treasury:  "0x9d16Eb6A6143A3347f8fA5854B5AA675101Fb705",
};

function check(label: string, actual: string, expected: string) {
  const ok = actual.toLowerCase() === expected.toLowerCase();
  console.log(`  [${ok ? "✓" : "✗"}] ${label}`);
  console.log(`       expected: ${expected}`);
  if (!ok) console.log(`       actual  : ${actual}`);
  return ok;
}

function checkBool(label: string, actual: boolean, expected: boolean) {
  const ok = actual === expected;
  console.log(`  [${ok ? "✓" : "✗"}] ${label}: ${actual}`);
  return ok;
}

async function main() {
  // Load deployment
  const depPath = path.join(__dirname, "../deployments/base.json");
  const dep = JSON.parse(fs.readFileSync(depPath, "utf8"));

  const VAULT_ADDR    = dep.contracts.FundVaultV01;
  const MANAGER_ADDR  = dep.contracts.StrategyManagerV01;
  const STRATEGY_ADDR = dep.contracts.AaveV3StrategyV01;

  console.log("=".repeat(60));
  console.log("Step2 Phase 1 — On-chain Verification");
  console.log("=".repeat(60));

  // 1. Network
  const net = await ethers.provider.getNetwork();
  const chainOk = Number(net.chainId) === EXPECTED.chainId;
  console.log(`\n[1] Network`);
  console.log(`  [${chainOk ? "✓" : "✗"}] chainId: ${net.chainId} (expected ${EXPECTED.chainId})`);

  // 2. Contract addresses
  console.log(`\n[2] Contract Addresses`);
  console.log(`  Vault           : ${VAULT_ADDR}`);
  console.log(`  StrategyManager : ${MANAGER_ADDR}`);
  console.log(`  AaveV3Strategy  : ${STRATEGY_ADDR}`);

  // 3. Contract ABIs (minimal)
  const vaultAbi = [
    "function asset() view returns (address)",
    "function strategyManager() view returns (address)",
    "function treasury() view returns (address)",
    "function externalTransfersEnabled() view returns (bool)",
    "function reserveRatioBps() view returns (uint256)",
    "function isAllowed(address) view returns (bool)",
    "function systemMode() view returns (uint8)",
    "function hasRole(bytes32, address) view returns (bool)",
    "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
    "function EMERGENCY_ROLE() view returns (bytes32)",
  ];
  const managerAbi = [
    "function vault() view returns (address)",
    "function underlying() view returns (address)",
    "function strategy() view returns (address)",
    "function paused() view returns (bool)",
    "function hasRole(bytes32, address) view returns (bool)",
    "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
    "function EMERGENCY_ROLE() view returns (bytes32)",
  ];
  const strategyAbi = [
    "function underlying() view returns (address)",
    "function manager() view returns (address)",
    "function pool() view returns (address)",
    "function aToken() view returns (address)",
    "function totalUnderlying() view returns (uint256)",
  ];

  const vault    = new ethers.Contract(VAULT_ADDR,    vaultAbi,    ethers.provider);
  const manager  = new ethers.Contract(MANAGER_ADDR,  managerAbi,  ethers.provider);
  const strategy = new ethers.Contract(STRATEGY_ADDR, strategyAbi, ethers.provider);

  // 4. Token addresses
  console.log(`\n[3] Token Addresses`);
  const vaultAsset      = await vault.asset();
  const managerUnderlying = await manager.underlying();
  const strategyUnderlying = await strategy.underlying();
  check("vault.asset() == USDC",           vaultAsset,          EXPECTED.usdc);
  check("manager.underlying() == USDC",    managerUnderlying,   EXPECTED.usdc);
  check("strategy.underlying() == USDC",   strategyUnderlying,  EXPECTED.usdc);

  // 5. Aave parameters
  console.log(`\n[4] Aave V3 Parameters`);
  const stratPool  = await strategy.pool();
  const stratAToken = await strategy.aToken();
  check("strategy.pool() == Aave V3 Pool", stratPool,   EXPECTED.aavePool);
  check("strategy.aToken() == aUSDC",      stratAToken, EXPECTED.aUsdc);

  // 6. Wiring
  console.log(`\n[5] Contract Wiring`);
  const vaultStratMgr = await vault.strategyManager();
  const managerVault  = await manager.vault();
  const managerStrat  = await manager.strategy();
  check("vault.strategyManager() == StrategyManager", vaultStratMgr, MANAGER_ADDR);
  check("manager.vault() == Vault",                   managerVault,  VAULT_ADDR);
  check("manager.strategy() == AaveV3Strategy",       managerStrat,  STRATEGY_ADDR);

  // 7. Role addresses
  console.log(`\n[6] Role Addresses`);
  const DEFAULT_ADMIN_ROLE = await vault.DEFAULT_ADMIN_ROLE();
  const EMERGENCY_ROLE     = await vault.EMERGENCY_ROLE();
  const vaultTreasury      = await vault.treasury();
  const adminHasVaultAdmin    = await vault.hasRole(DEFAULT_ADMIN_ROLE, EXPECTED.admin);
  const adminHasManagerAdmin  = await manager.hasRole(DEFAULT_ADMIN_ROLE, EXPECTED.admin);
  const guardianHasEmergency  = await vault.hasRole(EMERGENCY_ROLE, EXPECTED.guardian);

  check("vault.treasury() == TREASURY",            vaultTreasury, EXPECTED.treasury);
  checkBool("vault: ADMIN has DEFAULT_ADMIN_ROLE",    adminHasVaultAdmin,   true);
  checkBool("manager: ADMIN has DEFAULT_ADMIN_ROLE",  adminHasManagerAdmin, true);
  checkBool("vault: GUARDIAN has EMERGENCY_ROLE",     guardianHasEmergency, true);

  // 8. Config params
  console.log(`\n[7] Protocol Config`);
  const extTransfers  = await vault.externalTransfersEnabled();
  const reserveBps    = await vault.reserveRatioBps();
  const systemMode    = await vault.systemMode();
  checkBool("externalTransfersEnabled == true", extTransfers, true);
  const reserveOk = Number(reserveBps) === 3000;
  console.log(`  [${reserveOk ? "✓" : "✗"}] reserveRatioBps: ${reserveBps} (expected 3000)`);
  const modeOk = Number(systemMode) === 0;
  console.log(`  [${modeOk ? "✓" : "✗"}] systemMode: ${systemMode} (expected 0=Normal)`);

  // 9. Allowlist
  console.log(`\n[8] Allowlist`);
  const adminAllowed = await vault.isAllowed(EXPECTED.admin);
  checkBool("ADMIN is on allowlist", adminAllowed, true);

  // 10. Strategy balance
  console.log(`\n[9] Strategy Balance`);
  const stratAssets = await strategy.totalUnderlying();
  console.log(`  strategy.totalUnderlying(): ${ethers.formatUnits(stratAssets, 6)} USDC`);

  // 11. Manager paused?
  console.log(`\n[10] Manager State`);
  const isPaused = await manager.paused();
  checkBool("manager.paused() == false (ready)", isPaused, false);

  console.log("\n" + "=".repeat(60));
  console.log("Verification complete.");
  console.log("=".repeat(60));
}

main().catch(console.error);
