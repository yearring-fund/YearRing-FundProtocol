import { ethers } from "hardhat";

const DEFAULT_ADMIN_ROLE  = ethers.ZeroHash;
const KEEPER_ROLE         = ethers.keccak256(ethers.toUtf8Bytes("KEEPER_ROLE"));
const REBATE_MANAGER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("REBATE_MANAGER_ROLE"));
const POINTS_MINTER_ROLE  = ethers.keccak256(ethers.toUtf8Bytes("POINTS_MINTER_ROLE"));
const POINTS_BURNER_ROLE  = ethers.keccak256(ethers.toUtf8Bytes("POINTS_BURNER_ROLE"));

const DEPLOYER  = "0x087ea7F67d9282f0bdC43627b855F79789C6824C";
const MULTISIG  = "0xd29d1E3B9478F09aB5D89bC2b59DFDcF0485f7E8";

const ADDRS = {
  vault:    "0x53e45AcB32aCD80F3d215a007fD8FE87390746F8",
  csm:      "0xc615c0c37524e9997622337cC973aC24C40e0548",
  asm:      "0x49f2FF1CF3BcD216f4958485407a038535f1Ebb0",
  treasury: "0x413f038278A97FC2AE413380Ba0ef195F4e8a0b2",
  lm:       "0xCDc679865b5161C7b7cf75584551F5B57828d59F",
  rebateMgr:"0x3B1F6956D5212bCA3Af223DD63AE31420233aDAD",
  eligMod:  "0x7ee0ED49A008e6feA8d196492699a87f878a2022",
  pl:       "0xb9c51ff318352c21f2fF5D378D31eFE0c7020dFe",
  lens:     "0xeb6C6b8FaE3c10271ea94dc5C071FE8147E01a0a",
  csmStrat: "0x58F265139E3693651B4E30961a1e535b413BBa2C",
  asmStrat: "0xc61D5966F2802aff6c6377C21bBdE923Daf879e0",
};

async function main() {
  const vault    = await ethers.getContractAt("YearRingCoreVaultV21",    ADDRS.vault);
  const csm      = await ethers.getContractAt("CoreStrategyManagerV21",  ADDRS.csm);
  const asm      = await ethers.getContractAt("AccessStrategyManagerV21",ADDRS.asm);
  const treasury = await ethers.getContractAt("TreasuryV21",             ADDRS.treasury);
  const lm       = await ethers.getContractAt("LockManagerV21",          ADDRS.lm);
  const pl       = await ethers.getContractAt("PointsLedgerV01",         ADDRS.pl);
  const em       = await ethers.getContractAt("EligibilityModuleV21",    ADDRS.eligMod);

  // ── Vault ──────────────────────────────────────────────────────────────────
  const totalAssets      = await vault.totalAssets();
  const totalSupply      = await vault.totalSupply();
  const pps              = await vault.convertToAssets(ethers.parseUnits("1", 18));
  const allowlistEnabled = await vault.allowlistEnabled();
  const systemMode       = await vault.systemMode();
  const coreStratMgr     = await vault.coreStrategyManager();

  // ── CSM ────────────────────────────────────────────────────────────────────
  const csmStrategy     = await csm.strategy();
  const csmFeeReceiver  = await csm.feeReceiver();
  const csmFeeBps       = await csm.FEE_BPS();
  const csmTotalManaged = await csm.totalManagedAssets();
  const csmTotalUnits   = await csm.totalUnits();

  // ── ASM ────────────────────────────────────────────────────────────────────
  const asmStrategy  = await asm.strategy();
  const asmFeeRcvr   = await asm.feeReceiver();
  const asmLockMgr   = await asm.lockManager();
  const asmFeeBps    = await asm.managementFeeBpsPerYear();

  // ── Treasury ───────────────────────────────────────────────────────────────
  const tRebateMgr = await treasury.rebateManager();
  const amCount    = await treasury.accessManagerCount();
  const accessManagers: string[] = [];
  for (let i = 0n; i < amCount; i++) accessManagers.push(await treasury.accessManagerAt(i));

  // ── LockManager ────────────────────────────────────────────────────────────
  const lmPL        = await lm.pointsLedger();
  const lmEM        = await lm.eligibilityModule();
  const lmRebRole   = await lm.hasRole(REBATE_MANAGER_ROLE, ADDRS.rebateMgr);
  const lmKeepRole  = await lm.hasRole(KEEPER_ROLE,         DEPLOYER);

  // ── PointsLedger ───────────────────────────────────────────────────────────
  const plMinter = await pl.hasRole(POINTS_MINTER_ROLE, ADDRS.lm);
  const plBurner = await pl.hasRole(POINTS_BURNER_ROLE, ADDRS.lm);

  // ── DEFAULT_ADMIN_ROLE ─────────────────────────────────────────────────────
  const contracts = { vault, csm, asm, treasury, lm, pl, em } as Record<string, typeof vault>;
  const adminRoles: Record<string, { deployer: boolean; multisig: boolean }> = {};
  for (const [name, c] of Object.entries(contracts)) {
    adminRoles[name] = {
      deployer: await c.hasRole(DEFAULT_ADMIN_ROLE, DEPLOYER),
      multisig: await c.hasRole(DEFAULT_ADMIN_ROLE, MULTISIG),
    };
  }

  console.log(JSON.stringify({
    vault:    { totalAssets: totalAssets.toString(), totalSupply: totalSupply.toString(), pps: pps.toString(), systemMode: systemMode.toString(), allowlistEnabled, coreStrategyManager: coreStratMgr },
    csm:      { strategy: csmStrategy, feeReceiver: csmFeeReceiver, feeBpsPerYear: csmFeeBps.toString(), totalManagedAssets: csmTotalManaged.toString(), totalUnits: csmTotalUnits.toString() },
    asm:      { strategy: asmStrategy, feeReceiver: asmFeeRcvr, lockManager: asmLockMgr, managementFeeBpsPerYear: asmFeeBps.toString() },
    treasury: { rebateManager: tRebateMgr, accessManagers },
    lm:       { pointsLedger: lmPL, eligibilityModule: lmEM, rebateManagerRoleGranted: lmRebRole, keeperRoleGranted: lmKeepRole },
    pl:       { minterIsLockManager: plMinter, burnerIsLockManager: plBurner },
    adminRoles,
  }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
