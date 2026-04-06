/**
 * seed_v2.ts — Pre-seed demo positions for three personas
 *
 * Creates observable on-chain state for testnet review:
 *
 *   alice  — deposits 1000 USDC, locks 180d Gold tier (LockedAccumulating)
 *            Represents Scene B: long-term committed user
 *
 *   carol  — deposits 500 USDC, locks 90d Silver tier,
 *            sets bob as beneficiary, admin marks carol inactive
 *            Bob can execute claim immediately (Scene C demo-ready)
 *
 *   bob    — deposits 200 USDC, holds free (Scene A: regular user view)
 *
 * Account mapping:
 *   hardhat (in-process) — signers[1]=admin  [3]=treasury [4]=alice [5]=bob [6]=carol
 *   External networks    — signers[0]=admin/treasury  [1]=alice [2]=bob [3]=carol
 *                          (from PRIVATE_KEY / ALICE_PRIVATE_KEY / BOB_PRIVATE_KEY / CAROL_PRIVATE_KEY)
 *
 * On external networks alice/bob/carol MUST be distinct from deployer.
 * Idempotent: fails if seed already exists unless FORCE_RESEED=true.
 *
 * Usage:
 *   npx hardhat run scripts/v2/seed_v2.ts --network baseSepolia
 *   FORCE_RESEED=true npx hardhat run scripts/v2/seed_v2.ts --network baseSepolia
 */

import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { v2DemoConfig } from "../config";

const D6     = (n: number) => ethers.parseUnits(String(n), 6);
const fmtU   = (n: bigint) => (Number(n) / 1e6).toFixed(2) + " USDC";
const fmtS   = (n: bigint) => (Number(n) / 1e18).toFixed(6) + " fbUSDC";
const fmtRWT = (n: bigint) => (Number(n) / 1e18).toFixed(2) + " RWT";
const fmtA   = (a: string) => a.slice(0, 6) + "..." + a.slice(-4);
const SEP    = () => console.log("-".repeat(62));

const FORCE_RESEED = process.env.FORCE_RESEED === "true";

async function main() {
  const signers     = await ethers.getSigners();
  const isInProcess = network.name === "hardhat";

  // ── Account mapping ──────────────────────────────────────────────────────
  let admin: any, treasury: any, alice: any, bob: any, carol: any;

  if (isInProcess) {
    // In-process Hardhat: fixed signer indices
    [, admin, , treasury, alice, bob, carol] = signers;
  } else {
    // External network: deployer=admin=treasury, personas from separate keys
    admin    = signers[0];
    treasury = signers[0];

    if (signers.length < 4) {
      throw new Error(
        `Demo requires 4 signers [deployer, alice, bob, carol] on external networks.\n` +
        `Provide ALICE_PRIVATE_KEY, BOB_PRIVATE_KEY, CAROL_PRIVATE_KEY in .env.\n` +
        `Current signer count: ${signers.length}`
      );
    }

    alice = signers[1];
    bob   = signers[2];
    carol = signers[3];

    // Personas must be distinct from deployer — no silent fallback allowed
    const deployerAddr = admin.address.toLowerCase();
    if (
      alice.address.toLowerCase() === deployerAddr ||
      bob.address.toLowerCase()   === deployerAddr ||
      carol.address.toLowerCase() === deployerAddr
    ) {
      throw new Error(
        `Demo personas must be distinct from deployer (${admin.address}).\n` +
        `Set ALICE_PRIVATE_KEY, BOB_PRIVATE_KEY, CAROL_PRIVATE_KEY to different keys in .env.`
      );
    }
  }

  // ── Load deployment ──────────────────────────────────────────────────────
  const deploymentsPath = path.join(__dirname, `../../deployments/${network.name}.json`);
  if (!fs.existsSync(deploymentsPath)) {
    throw new Error(`No deployment found. Run deploy.ts + deploy_v2.ts + setup_v2.ts first.`);
  }
  const dep = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));

  // ── Idempotency check ────────────────────────────────────────────────────
  if (dep.seed && !FORCE_RESEED) {
    throw new Error(
      `Seed state already exists (seededAt: ${dep.seed.seededAt}).\n` +
      `  Alice : ${dep.seed.alice?.address} lockId=${dep.seed.alice?.lockId}\n` +
      `  Carol : ${dep.seed.carol?.address} lockId=${dep.seed.carol?.lockId}\n` +
      `Set FORCE_RESEED=true to override.\n` +
      `WARNING: re-seeding on testnet creates duplicate positions — existing state is not cleaned.`
    );
  }

  const c   = dep.contracts;

  const usdc      = await ethers.getContractAt("MockUSDC",              c.MockUSDC    || c.USDC);
  const vault     = await ethers.getContractAt("FundVaultV01",          c.FundVaultV01);
  const ledger    = await ethers.getContractAt("LockLedgerV02",         c.LockLedgerV02);
  const benefit   = await ethers.getContractAt("LockBenefitV02",        c.LockBenefitV02);
  const lockMgr   = await ethers.getContractAt("LockRewardManagerV02",  c.LockRewardManagerV02);
  const benModule = await ethers.getContractAt("BeneficiaryModuleV02",  c.BeneficiaryModuleV02);

  const isMock = !!c.MockUSDC;

  console.log("\n" + "=".repeat(62));
  console.log("  YearRing-FundProtocol V2 — Demo Seed");
  console.log("=".repeat(62));
  console.log("Network   :", network.name);
  console.log("USDC type :", isMock ? "MockUSDC (mintable)" : "Real USDC (pre-funded required)");
  console.log("Admin     :", fmtA(admin.address));
  console.log("Alice     :", fmtA(alice.address));
  console.log("Bob       :", fmtA(bob.address));
  console.log("Carol     :", fmtA(carol.address));

  // ── Helpers ──────────────────────────────────────────────────────────────

  async function ensureUSDC(to: any, amount: bigint, label: string) {
    if (isMock) {
      const mockUsdc = await ethers.getContractAt("MockUSDC", await usdc.getAddress());
      await (await mockUsdc.mint(to.address, amount)).wait();
      console.log(`    Minted ${fmtU(amount)} → ${label}`);
    } else {
      const bal = await usdc.balanceOf(to.address);
      console.log(`    ${label} USDC balance: ${fmtU(bal)}`);
      if (bal < amount) {
        throw new Error(`${label} (${to.address}) needs ${fmtU(amount)} but only has ${fmtU(bal)}.`);
      }
    }
  }

  async function getLockId(receipt: any, persona: string): Promise<bigint> {
    const ev = receipt.logs
      .map((l: any) => { try { return lockMgr.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e?.name === "LockedWithReward");
    if (!ev) {
      throw new Error(
        `LockedWithReward event not found in tx ${receipt.hash} (persona: ${persona}).\n` +
        `Check lockWithReward call and contract state.`
      );
    }
    return ev.args.lockId;
  }

  // ────────────────────────────────────────────────────────────────────────
  // ALICE — Scene B: deposit 1000 USDC, lock 180d Gold
  // ────────────────────────────────────────────────────────────────────────
  SEP();
  console.log("[ALICE] Scene B setup — 1000 USDC, 180d Gold lock");

  let aliceShares = await vault.balanceOf(alice.address);
  if (aliceShares === 0n) {
    await ensureUSDC(alice, v2DemoConfig.aliceDeposit, "alice");
    await (await usdc.connect(alice).approve(await vault.getAddress(), v2DemoConfig.aliceDeposit)).wait();
    aliceShares = await vault.connect(alice).deposit.staticCall(v2DemoConfig.aliceDeposit, alice.address);
    await (await vault.connect(alice).deposit(v2DemoConfig.aliceDeposit, alice.address)).wait();
  }
  console.log("    Deposited →", fmtS(aliceShares), "fbUSDC");

  await (await vault.connect(alice).approve(await ledger.getAddress(), aliceShares)).wait();
  const txB   = await lockMgr.connect(alice).lockWithReward(aliceShares, Number(v2DemoConfig.goldDuration));
  const rcptB = await txB.wait();
  const lockIdAlice   = await getLockId(rcptB, "alice");
  const rwIssuedAlice = await lockMgr.issuedRewardTokens(lockIdAlice);
  const tierAlice     = await benefit.tierOf(lockIdAlice);

  console.log("    Lock ID :", lockIdAlice.toString());
  console.log("    Tier    :", tierAlice === 3n ? "Gold (180d)" : tierAlice.toString());
  console.log("    RWT     :", fmtRWT(rwIssuedAlice), "issued upfront");
  console.log("    State   : LockedAccumulating ✓");

  // ────────────────────────────────────────────────────────────────────────
  // BOB — Scene A/C: deposit 200 USDC free (no lock)
  // ────────────────────────────────────────────────────────────────────────
  SEP();
  console.log("[BOB] Scene A observer / beneficiary recipient — 200 USDC free");

  let bobShares = await vault.balanceOf(bob.address);
  if (bobShares === 0n) {
    await ensureUSDC(bob, v2DemoConfig.bobDeposit, "bob");
    await (await usdc.connect(bob).approve(await vault.getAddress(), v2DemoConfig.bobDeposit)).wait();
    bobShares = await vault.connect(bob).deposit.staticCall(v2DemoConfig.bobDeposit, bob.address);
    await (await vault.connect(bob).deposit(v2DemoConfig.bobDeposit, bob.address)).wait();
  }
  console.log("    Free fbUSDC :", fmtS(bobShares));
  console.log("    No lock — free balance visible ✓");

  // ────────────────────────────────────────────────────────────────────────
  // CAROL + BOB — Scene C: lock + beneficiary + admin marks inactive
  // ────────────────────────────────────────────────────────────────────────
  SEP();
  console.log("[CAROL] Scene C setup — 500 USDC, 90d Silver + beneficiary → Bob");

  let carolShares = await vault.balanceOf(carol.address);
  if (carolShares === 0n) {
    await ensureUSDC(carol, v2DemoConfig.carolDeposit, "carol");
    await (await usdc.connect(carol).approve(await vault.getAddress(), v2DemoConfig.carolDeposit)).wait();
    carolShares = await vault.connect(carol).deposit.staticCall(v2DemoConfig.carolDeposit, carol.address);
    await (await vault.connect(carol).deposit(v2DemoConfig.carolDeposit, carol.address)).wait();
  }
  console.log("    Deposited →", fmtS(carolShares), "fbUSDC");

  await (await vault.connect(carol).approve(await ledger.getAddress(), carolShares)).wait();
  const txC   = await lockMgr.connect(carol).lockWithReward(carolShares, Number(v2DemoConfig.silverDuration));
  const rcptC = await txC.wait();
  const lockIdCarol   = await getLockId(rcptC, "carol");
  const rwIssuedCarol = await lockMgr.issuedRewardTokens(lockIdCarol);
  const tierCarol     = await benefit.tierOf(lockIdCarol);
  const lockPosCarol  = await ledger.getLock(lockIdCarol);

  console.log("    Lock ID  :", lockIdCarol.toString());
  console.log("    Tier     :", tierCarol === 2n ? "Silver (90d)" : tierCarol.toString());
  console.log("    RWT      :", fmtRWT(rwIssuedCarol), "issued upfront");
  console.log("    unlockAt :", new Date(Number(lockPosCarol.unlockAt) * 1000).toISOString().slice(0, 10));

  await (await benModule.connect(carol).setBeneficiary(bob.address)).wait();
  console.log("    Beneficiary set → Bob ✓");

  await (await benModule.connect(admin).adminMarkInactive(carol.address)).wait();
  const inactive = await benModule.isInactive(carol.address);
  console.log("    isInactive(carol):", inactive, "(admin trigger) ✓");
  console.log("    → Bob can call executeClaim now");

  // ── Save seed state ───────────────────────────────────────────────────────
  SEP();
  dep.seed = {
    seededAt: new Date().toISOString(),
    alice:    { address: alice.address, lockId: lockIdAlice.toString(), scenario: "B - Gold 180d" },
    bob:      { address: bob.address,   lockId: null,                   scenario: "A - free holder / C beneficiary" },
    carol:    { address: carol.address, lockId: lockIdCarol.toString(), scenario: "C - Silver 90d + beneficiary" },
  };
  fs.writeFileSync(deploymentsPath, JSON.stringify(dep, null, 2));
  console.log("Seed state saved →", deploymentsPath);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(62));
  console.log("  Seed complete — Demo-ready state on-chain");
  console.log("=".repeat(62));
  console.log("Alice :", alice.address, "→ lockId", lockIdAlice.toString(), "(Gold, LockedAccumulating)");
  console.log("Bob   :", bob.address,   "→ free fbUSDC, designated beneficiary of Carol");
  console.log("Carol :", carol.address, "→ lockId", lockIdCarol.toString(), "(Silver, admin-marked inactive)");
  console.log("");

  if (!isInProcess) {
    console.log("Testnet seeded state — what is live:");
    console.log("  ✓ Alice: active Gold lock — accumulating (lockId " + lockIdAlice + ")");
    console.log("  ✓ Bob  : free fbUSDC balance");
    console.log("  ✓ Carol: active Silver lock + Bob designated + admin-marked inactive");
    console.log("  ✓ Bob can call executeClaim(carol, [" + lockIdCarol + "]) on-chain now");
    console.log("");
    console.log("Testnet seeded state — what is NOT yet demonstrable on-chain:");
    console.log("  ✗ Lock maturity requires real time (~90–180 days from now)");
    console.log("  ✗ Fee rebate claim requires time elapsed under live fee accrual");
    console.log("  ✗ Unlock after maturity — not available until natural unlockAt date");
    console.log("  → Full lifecycle (maturity + unlock + rebate): use local demo");
    console.log("    npx hardhat run scripts/v2/run_demo.ts");
    console.log("");
    console.log("Beneficiary limitations (Carol → Bob, Scene C):");
    console.log("  • executeClaim transfers locked position ownership only");
    console.log("  • Carol's free fbUSDC balance is NOT transferred automatically");
    console.log("  • Fee rebate entitlement stays with the original lock owner (Carol)");
    console.log("  See docs/V2_LIMITATIONS_AND_V3_NOTES.md for details.");
  }
  console.log("=".repeat(62));
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
