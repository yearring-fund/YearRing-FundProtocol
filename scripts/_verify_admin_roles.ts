import { ethers } from "hardhat";

const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;
const TIMELOCK = "0x054Cb2c32D6062B291420584dE2e5952C372cDD6";
const DEPLOYER = "0x087ea7F67d9282f0bdC43627b855F79789C6824C";

const ABI = ["function hasRole(bytes32 role, address account) view returns (bool)"];

const CONTRACTS: [string, string][] = [
  ["FundVaultV01",         "0x9dD61ee543a9C51aBe7B26A89687C9aEeea98a54"],
  ["StrategyManagerV01",   "0xa44d3b9b0ECD6fFa4bD646957468c0B5Bfa64A54"],
  ["LockLedgerV02",        "0x2FC1d315c67AE3Df2a062f7130d58FaA6c0ce9EF"],
  ["LockRewardManagerV02", "0x129aEce0C7659575Ae7aB4e78bfe4ca8946B962a"],
  ["BeneficiaryModuleV02", "0x6d463f7d78Ca3a1809971D5A43E5F57066d325cF"],
  ["GovernanceSignalV02",  "0x9BE5636943d7BfF57ACA6047Cf945FD770CcC7d0"],
  ["ClaimLedger",          "0x5CF9b8EC75314115EDDE5Dd332C193995Dd55234"],
];

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("\nDEFAULT_ADMIN_ROLE verification — Base mainnet");
  console.log(`Timelock : ${TIMELOCK}`);
  console.log(`Deployer : ${DEPLOYER}\n`);
  console.log("  Contract               Timelock=admin  Deployer=admin  Status");
  console.log("  " + "─".repeat(66));

  let allOk = true;
  for (const [name, addr] of CONTRACTS) {
    const ct = new ethers.Contract(addr, ABI, signer);
    const [tlOk, depOk] = await Promise.all([
      ct.hasRole(DEFAULT_ADMIN_ROLE, TIMELOCK),
      ct.hasRole(DEFAULT_ADMIN_ROLE, DEPLOYER),
    ]);
    const ok = tlOk && !depOk;
    if (!ok) allOk = false;
    console.log(
      `  ${ok ? "✅" : "❌"}  ${name.padEnd(22)} ${String(tlOk).padEnd(15)} ${String(depOk).padEnd(15)} ${ok ? "OK" : "FAIL"}`
    );
  }

  console.log("  " + "─".repeat(66));
  console.log(allOk
    ? "\n  ✅  All 7 contracts confirmed: Timelock is admin, deployer is not."
    : "\n  ❌  Mismatch detected — review above."
  );
}

main().catch(e => { console.error(e); process.exit(1); });
