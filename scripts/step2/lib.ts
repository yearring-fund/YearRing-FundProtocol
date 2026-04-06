/**
 * lib.ts — shared utilities for Step2 scripts
 * Provides: loadDeployment, getContracts, snapshot, saveEvidence
 */
import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Deployment loader
// ---------------------------------------------------------------------------
export function loadDeployment(networkName = "base") {
  const p = path.join(__dirname, "../../deployments", `${networkName}.json`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

// ---------------------------------------------------------------------------
// Contract factories (minimal ABIs — only what Step2 needs)
// ---------------------------------------------------------------------------
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function decimals() view returns (uint8)",
];

const VAULT_ABI = [
  "function totalAssets() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function pricePerShare() view returns (uint256)",
  "function systemMode() view returns (uint8)",
  "function depositsPaused() view returns (bool)",
  "function redeemsPaused() view returns (bool)",
  "function availableToInvest() view returns (uint256)",
  "function convertToAssets(uint256) view returns (uint256)",
  "function deposit(uint256,address) returns (uint256)",
  "function redeem(uint256,address,address) returns (uint256)",
  "function transferToStrategyManager(uint256)",
];

const MANAGER_ABI = [
  "function totalManagedAssets() view returns (uint256)",
  "function idleUnderlying() view returns (uint256)",
  "function paused() view returns (bool)",
  "function invest(uint256)",
  "function divest(uint256) returns (uint256)",
  "function returnToVault(uint256)",
];

const STRATEGY_ABI = [
  "function totalUnderlying() view returns (uint256)",
  "function underlying() view returns (address)",
  "function pool() view returns (address)",
  "function aToken() view returns (address)",
];

const ATOKEN_ABI = [
  "function balanceOf(address) view returns (uint256)",
];

export async function getContracts(dep: any) {
  const usdc     = new ethers.Contract(dep.contracts.USDC,               ERC20_ABI,    ethers.provider);
  const vault    = new ethers.Contract(dep.contracts.FundVaultV01,        VAULT_ABI,    ethers.provider);
  const manager  = new ethers.Contract(dep.contracts.StrategyManagerV01,  MANAGER_ABI,  ethers.provider);
  const strategy = new ethers.Contract(dep.contracts.AaveV3StrategyV01,   STRATEGY_ABI, ethers.provider);
  const aToken   = new ethers.Contract(dep.contracts["aUSDC"] || "0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB", ATOKEN_ABI, ethers.provider);
  return { usdc, vault, manager, strategy, aToken };
}

// ---------------------------------------------------------------------------
// Snapshot — capture full system state at a point in time
// ---------------------------------------------------------------------------
export async function snapshot(label: string, dep: any, userAddress: string) {
  const { usdc, vault, manager, strategy, aToken } = await getContracts(dep);

  const [
    userUsdc,
    userShares,
    vaultTotal,
    vaultIdle,
    managerTotal,
    managerIdle,
    stratUnderlying,
    aTokenBal,
    pps,
    systemMode,
    depPaused,
    redPaused,
    availToInvest,
  ] = await Promise.all([
    usdc.balanceOf(userAddress),
    vault.balanceOf(userAddress),
    vault.totalAssets(),
    usdc.balanceOf(dep.contracts.FundVaultV01),
    manager.totalManagedAssets(),
    manager.idleUnderlying(),
    strategy.totalUnderlying(),
    aToken.balanceOf(dep.contracts.AaveV3StrategyV01),
    vault.pricePerShare(),
    vault.systemMode(),
    vault.depositsPaused(),
    vault.redeemsPaused(),
    vault.availableToInvest(),
  ]);

  const u = (v: bigint, dec = 6) => parseFloat(ethers.formatUnits(v, dec));
  const u18 = (v: bigint) => parseFloat(ethers.formatUnits(v, 18));

  return {
    label,
    timestamp: new Date().toISOString(),
    user: userAddress,
    userUsdc_raw:      userUsdc.toString(),
    userShares_raw:    userShares.toString(),
    vaultTotal_raw:    vaultTotal.toString(),
    vaultIdle_raw:     vaultIdle.toString(),
    managerTotal_raw:  managerTotal.toString(),
    managerIdle_raw:   managerIdle.toString(),
    stratUnderlying_raw: stratUnderlying.toString(),
    aTokenBal_raw:     aTokenBal.toString(),
    pps_raw:           pps.toString(),
    // Human-readable
    userUsdc:          u(userUsdc),
    userShares:        u18(userShares),
    vaultTotal:        u(vaultTotal),
    vaultIdle:         u(vaultIdle),
    managerTotal:      u(managerTotal),
    managerIdle:       u(managerIdle),
    stratUnderlying:   u(stratUnderlying),
    aTokenBal:         u(aTokenBal),
    pricePerShare:     u(pps),   // pps = convertToAssets(1e18), result is in USDC (6 decimals)
    systemMode:        Number(systemMode),
    depositsPaused:    depPaused,
    redeemsPaused:     redPaused,
    availableToInvest: u(availToInvest),
  };
}

// ---------------------------------------------------------------------------
// Evidence logger
// ---------------------------------------------------------------------------
const EVIDENCE_DIR = path.join(__dirname, "../../evidence");

export function saveEvidence(filename: string, data: object) {
  if (!fs.existsSync(EVIDENCE_DIR)) fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const fullPath = path.join(EVIDENCE_DIR, filename);
  fs.writeFileSync(fullPath, JSON.stringify(data, null, 2));
  console.log("Evidence saved:", fullPath);
}

export function appendEvidence(logFile: string, entry: object) {
  const fullPath = path.join(EVIDENCE_DIR, logFile);
  let log: object[] = [];
  if (fs.existsSync(fullPath)) {
    log = JSON.parse(fs.readFileSync(fullPath, "utf8"));
  }
  log.push(entry);
  fs.writeFileSync(fullPath, JSON.stringify(log, null, 2));
}

export function printSnapshot(s: ReturnType<typeof snapshot> extends Promise<infer T> ? T : never) {
  console.log(`\n--- Snapshot: ${s.label} @ ${s.timestamp} ---`);
  console.log(`  User USDC          : ${s.userUsdc.toFixed(6)} USDC`);
  console.log(`  User Shares (fbUSDC): ${s.userShares.toFixed(6)}`);
  console.log(`  Vault totalAssets  : ${s.vaultTotal.toFixed(6)} USDC`);
  console.log(`  Vault idle USDC    : ${s.vaultIdle.toFixed(6)} USDC`);
  console.log(`  Manager total      : ${s.managerTotal.toFixed(6)} USDC`);
  console.log(`  Manager idle       : ${s.managerIdle.toFixed(6)} USDC`);
  console.log(`  Strategy underlying: ${s.stratUnderlying.toFixed(6)} USDC`);
  console.log(`  aToken balance     : ${s.aTokenBal.toFixed(6)}`);
  console.log(`  pricePerShare      : ${s.pricePerShare.toFixed(6)} USDC/share`);
  console.log(`  systemMode         : ${s.systemMode} (0=Normal,1=Paused,2=EmergencyExit)`);
  console.log(`  depositsPaused     : ${s.depositsPaused}`);
  console.log(`  redeemsPaused      : ${s.redeemsPaused}`);
  console.log(`  availableToInvest  : ${s.availableToInvest.toFixed(6)} USDC`);
}
