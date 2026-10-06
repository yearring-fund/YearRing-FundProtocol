/**
 * deposit.ts — approve USDC + deposit to FundVault
 * Usage: AMOUNT=100 npx hardhat run scripts/step2/deposit.ts --network base
 *        (AMOUNT in USDC, default 148.9)
 *
 * Step3 limit enforcement (script-layer — V01 is deployed, contract unchanged):
 *   MIN_DEPOSIT      : 1 USDC
 *   PER_USER_CAP     : 2,000 USDC  (current vault value of user's shares + this deposit)
 *   TVL_CAP          : 20,000 USDC (vault.totalAssets() + this deposit)
 *   DAILY_CAP        : 5,000 USDC  (tracked in evidence/daily_deposits.json)
 *
 * Set BYPASS_LIMITS=true to skip soft checks (admin override, use with caution).
 */
import { ethers } from "hardhat";
import { loadDeployment, getContracts, snapshot, printSnapshot, saveEvidence, appendEvidence } from "./lib";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config();

const AMOUNT_USDC      = parseFloat(process.env.AMOUNT || "148.9");
const MIN_DEPOSIT_USDC = 1.0;
const PER_USER_CAP     = 2_000.0;   // USDC — single address cumulative value cap
const TVL_CAP          = 20_000.0;  // USDC — total vault TVL cap
const DAILY_CAP        = 5_000.0;   // USDC — max new deposits per calendar day
const BYPASS_LIMITS    = process.env.BYPASS_LIMITS === "true";

// ---------------------------------------------------------------------------
// Daily deposit tracking (local file — resets each calendar day UTC)
// ---------------------------------------------------------------------------
const DAILY_FILE = path.join(__dirname, "../../evidence/daily_deposits.json");

function readDailyTracker(): { date: string; total: number } {
  try {
    if (fs.existsSync(DAILY_FILE)) return JSON.parse(fs.readFileSync(DAILY_FILE, "utf8"));
  } catch {}
  return { date: "", total: 0 };
}

function writeDailyTracker(date: string, total: number) {
  if (!fs.existsSync(path.dirname(DAILY_FILE))) fs.mkdirSync(path.dirname(DAILY_FILE), { recursive: true });
  fs.writeFileSync(DAILY_FILE, JSON.stringify({ date, total }, null, 2));
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

async function main() {
  const dep = loadDeployment("base");
  const [signer] = await ethers.getSigners();
  const { usdc, vault } = await getContracts(dep);

  if (AMOUNT_USDC < MIN_DEPOSIT_USDC) {
    throw new Error(`Deposit amount ${AMOUNT_USDC} USDC is below minimum ${MIN_DEPOSIT_USDC} USDC.`);
  }

  // ── Step3 limit pre-flight checks ──────────────────────────────────────
  if (!BYPASS_LIMITS) {
    const amountRaw    = ethers.parseUnits(AMOUNT_USDC.toString(), 6);
    const totalAssets  = await vault.totalAssets();
    const userShares   = await vault.balanceOf(signer.address);
    const userValueRaw = userShares > 0n ? await vault.convertToAssets(userShares) : 0n;
    const userValue    = parseFloat(ethers.formatUnits(userValueRaw, 6));
    const tvlNow       = parseFloat(ethers.formatUnits(totalAssets, 6));

    // 1. Per-user cap
    if (userValue + AMOUNT_USDC > PER_USER_CAP) {
      throw new Error(
        `[LIMIT] Per-user cap exceeded: current vault value ${userValue.toFixed(6)} USDC ` +
        `+ deposit ${AMOUNT_USDC} USDC = ${(userValue + AMOUNT_USDC).toFixed(6)} USDC > ${PER_USER_CAP} USDC cap.\n` +
        `To override: BYPASS_LIMITS=true (admin only).`
      );
    }

    // 2. TVL cap
    if (tvlNow + AMOUNT_USDC > TVL_CAP) {
      throw new Error(
        `[LIMIT] TVL cap exceeded: current totalAssets ${tvlNow.toFixed(6)} USDC ` +
        `+ deposit ${AMOUNT_USDC} USDC = ${(tvlNow + AMOUNT_USDC).toFixed(6)} USDC > ${TVL_CAP} USDC cap.\n` +
        `To override: BYPASS_LIMITS=true (admin only).`
      );
    }

    // 3. Daily cap
    const tracker = readDailyTracker();
    const today   = todayUTC();
    const dailyAccum = tracker.date === today ? tracker.total : 0;
    if (dailyAccum + AMOUNT_USDC > DAILY_CAP) {
      throw new Error(
        `[LIMIT] Daily cap exceeded: today's deposits ${dailyAccum.toFixed(6)} USDC ` +
        `+ this deposit ${AMOUNT_USDC} USDC = ${(dailyAccum + AMOUNT_USDC).toFixed(6)} USDC > ${DAILY_CAP} USDC daily cap.\n` +
        `To override: BYPASS_LIMITS=true (admin only).`
      );
    }

    console.log("\n[limits] Pre-flight checks passed:");
    console.log(`  Per-user  : ${userValue.toFixed(2)} + ${AMOUNT_USDC} = ${(userValue + AMOUNT_USDC).toFixed(2)} / ${PER_USER_CAP} USDC`);
    console.log(`  TVL       : ${tvlNow.toFixed(2)} + ${AMOUNT_USDC} = ${(tvlNow + AMOUNT_USDC).toFixed(2)} / ${TVL_CAP} USDC`);
    console.log(`  Daily     : ${dailyAccum.toFixed(2)} + ${AMOUNT_USDC} = ${(dailyAccum + AMOUNT_USDC).toFixed(2)} / ${DAILY_CAP} USDC`);
  } else {
    console.log("\n[limits] BYPASS_LIMITS=true — skipping soft limit checks (admin override).");
  }

  const amount = ethers.parseUnits(AMOUNT_USDC.toString(), 6);
  const VAULT_ADDR = dep.contracts.FundVaultV01;

  console.log("=".repeat(60));
  console.log("Step2 — Deposit");
  console.log("User  :", signer.address);
  console.log("Amount:", AMOUNT_USDC, "USDC");
  console.log("=".repeat(60));

  // --- pre-state ---
  const pre = await snapshot("pre_deposit", dep, signer.address);
  printSnapshot(pre);

  // --- approve ---
  console.log("\nApproving USDC...");
  const approveTx = await usdc.connect(signer).approve(VAULT_ADDR, amount, { gasLimit: 100000 });
  await approveTx.wait();
  console.log("approve tx:", approveTx.hash);

  // --- deposit ---
  console.log("Depositing...");
  const depositTx = await vault.connect(signer).deposit(amount, signer.address, { gasLimit: 250000 });
  const depositReceipt = await depositTx.wait();
  console.log("deposit tx:", depositTx.hash);
  console.log("block:", depositReceipt?.blockNumber);

  // --- post-state ---
  const post = await snapshot("post_deposit", dep, signer.address);
  printSnapshot(post);

  // --- update daily tracker ---
  if (!BYPASS_LIMITS) {
    const today   = todayUTC();
    const tracker = readDailyTracker();
    const prev    = tracker.date === today ? tracker.total : 0;
    writeDailyTracker(today, prev + AMOUNT_USDC);
  }

  // --- evidence ---
  const record = {
    action: "deposit",
    timestamp: new Date().toISOString(),
    user: signer.address,
    amount_usdc: AMOUNT_USDC,
    approve_tx: approveTx.hash,
    deposit_tx: depositTx.hash,
    block: depositReceipt?.blockNumber,
    pre,
    post,
  };
  saveEvidence(`deposit_${Date.now()}.json`, record);
  appendEvidence("step2_log.json", { action: "deposit", tx: depositTx.hash, amount: AMOUNT_USDC, block: depositReceipt?.blockNumber, ts: new Date().toISOString() });
}

main().catch(console.error);
