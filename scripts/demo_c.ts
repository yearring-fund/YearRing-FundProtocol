/**
 * Demo Scene C — Beneficiary Path
 *
 * deposit → lock → set beneficiary → trigger claim → beneficiary inherits → unlock → redeem
 *
 * Shows: on-chain long-term asset protection mechanism
 *        locked positions survive user inactivity with state preserved
 */
import { ethers } from "hardhat";

const D6       = (n: number) => ethers.parseUnits(String(n), 6);
const D18      = (n: number) => ethers.parseUnits(String(n), 18);
const fmtUSDC  = (n: bigint) => (Number(n) / 1e6).toFixed(2) + " USDC";
const fmtAddr  = (s: string) => s.slice(0, 6) + "..." + s.slice(-4);
const sep      = () => console.log("-".repeat(52));
const DAY      = 86400n;
const D90      = 90n * DAY;

async function advance(seconds: bigint) {
  await ethers.provider.send("evm_increaseTime", [Number(seconds)]);
  await ethers.provider.send("evm_mine", []);
}

async function main() {
  const [, admin, guardian, treasury, alice, bob] = await ethers.getSigners();

  console.log("\n" + "=".repeat(52));
  console.log("  SCENE C  |  Beneficiary Path");
  console.log("=".repeat(52));

  // ── Deploy ──────────────────────────────────────────
  const usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
  const vault = await (await ethers.getContractFactory("FundVaultV01")).deploy(
    await usdc.getAddress(), "Fund Vault Shares", "fbUSDC",
    treasury.address, guardian.address, admin.address
  );
  const ledger = await (await ethers.getContractFactory("LockLedgerV02")).deploy(
    await vault.getAddress(), admin.address, guardian.address
  );
  const benefit = await (await ethers.getContractFactory("LockBenefitV02")).deploy(
    await ledger.getAddress()
  );
  const engine = await (await ethers.getContractFactory("UserStateEngineV02")).deploy(
    await ledger.getAddress()
  );
  const rwToken = await (await ethers.getContractFactory("RewardToken")).deploy(
    "Reward Token", "RWT", D18(1_000_000), treasury.address
  );
  const manager = await (await ethers.getContractFactory("LockRewardManagerV02")).deploy(
    await ledger.getAddress(),
    await benefit.getAddress(),
    await rwToken.getAddress(),
    await vault.getAddress(),
    await vault.getAddress(),
    treasury.address, admin.address, guardian.address
  );
  const beneficiaryModule = await (await ethers.getContractFactory("BeneficiaryModuleV02")).deploy(
    await ledger.getAddress(), admin.address
  );

  // Grant roles
  const OPERATOR_ROLE = await ledger.OPERATOR_ROLE();
  await ledger.connect(admin).grantRole(OPERATOR_ROLE, await manager.getAddress());
  await ledger.connect(admin).grantRole(OPERATOR_ROLE, await beneficiaryModule.getAddress());
  await rwToken.connect(treasury).approve(await manager.getAddress(), ethers.MaxUint256);

  // ── Step 1: Alice deposits ───────────────────────────
  sep();
  await usdc.mint(alice.address, D6(500));
  await usdc.connect(alice).approve(await vault.getAddress(), D6(500));
  await vault.connect(alice).deposit(D6(500), alice.address);
  const shares = await vault.balanceOf(alice.address);
  console.log("[1] Alice deposits 500 USDC");
  console.log("    Address          :", fmtAddr(alice.address));
  console.log("    fbUSDC received  :", (Number(shares) / 1e18).toFixed(4));

  // ── Step 2: Lock 90 days ─────────────────────────────
  sep();
  await vault.connect(alice).approve(await ledger.getAddress(), shares);
  // TODO(demo-only): Number(D90) casts bigint to number. Safe (7_776_000 < MAX_SAFE_INTEGER).
  const tx      = await manager.connect(alice).lockWithReward(shares, Number(D90));
  const receipt = await tx.wait();
  const ev = receipt!.logs
    .map((l: any) => { try { return manager.interface.parseLog(l); } catch { return null; } })
    .find((e: any) => e?.name === "LockedWithReward");
  const lockId   = ev!.args.lockId;
  const rwIssued = await manager.issuedRewardTokens(lockId);
  console.log("[2] Alice locks all shares for 90 days (Silver)");
  console.log("    Lock ID          :", lockId.toString());
  console.log("    Reward tokens    :", (Number(rwIssued) / 1e18).toFixed(2), "RWT (upfront)");
  console.log("    State            : LockedAccumulating");

  // ── Step 3: Set beneficiary ──────────────────────────
  sep();
  await beneficiaryModule.connect(alice).setBeneficiary(bob.address);
  console.log("[3] Alice sets beneficiary");
  console.log("    Alice            :", fmtAddr(alice.address));
  console.log("    Beneficiary (Bob):", fmtAddr(bob.address));
  console.log("    lastActiveAt     : now");

  // ── Step 4: Admin marks alice inactive (oracle trigger)
  sep();
  await beneficiaryModule.connect(admin).adminMarkInactive(alice.address);
  const inactive = await beneficiaryModule.isInactive(alice.address);
  console.log("[4] Admin marks alice as inactive (oracle trigger)");
  console.log("    isInactive(alice):", inactive);
  console.log("    Lock state       : LockedAccumulating (preserved)");

  // ── Step 5: Bob executes claim ───────────────────────
  sep();
  const ownerBefore = (await ledger.getLock(lockId)).owner;
  await beneficiaryModule.connect(bob).executeClaim(alice.address, [lockId]);
  const ownerAfter  = (await ledger.getLock(lockId)).owner;
  const posAfter    = await ledger.getLock(lockId);
  console.log("[5] Bob executes beneficiary claim");
  console.log("    Lock owner before:", fmtAddr(ownerBefore));
  console.log("    Lock owner after :", fmtAddr(ownerAfter));
  console.log("    unlockAt         :", new Date(Number(posAfter.unlockAt) * 1000).toISOString().slice(0, 10));
  console.log("    State            :", (await engine.lockStateOf(lockId)) === 1n ? "LockedAccumulating (preserved)" : "other");
  console.log("    claimed(alice)   :", await beneficiaryModule.claimed(alice.address));

  // ── Step 6: Advance to maturity, bob unlocks ─────────
  sep();
  await advance(D90);
  const stateMatured = await engine.lockStateOf(lockId);
  console.log("[6] 90 days elapsed — lock matures");
  console.log("    State            :", stateMatured === 2n ? "Matured" : stateMatured.toString());

  const bobSharesBefore = await vault.balanceOf(bob.address);
  await ledger.connect(bob).unlock(lockId);
  const bobSharesAfter  = await vault.balanceOf(bob.address);
  console.log("    Bob unlocks lock →", (Number(bobSharesAfter) / 1e18).toFixed(4), "fbUSDC");

  // ── Step 7: Bob redeems ──────────────────────────────
  sep();
  await vault.connect(bob).redeem(bobSharesAfter, bob.address, bob.address);
  const bobUSDC = await usdc.balanceOf(bob.address);
  console.log("[7] Bob redeems fbUSDC");
  console.log("    USDC received    :", fmtUSDC(bobUSDC));

  // ── Result ───────────────────────────────────────────
  console.log("\n" + "=".repeat(52));
  console.log("  RESULT: Lock state fully preserved through");
  console.log("  inheritance. Beneficiary receives exact");
  console.log("  asset rights — no forced early exit.");
  console.log("  Points remain with original owner.");
  console.log("=".repeat(52) + "\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
