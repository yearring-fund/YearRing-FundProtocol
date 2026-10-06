import { ethers } from "hardhat";

async function main() {
  const VAULT    = "0x2D2C7BbE92571FF28A23e44d19232e9137F3a310";
  const TREASURY = "0xA8a6BE4B0Cf96b43169EB9FeB7d905bfc301a083";
  const MANAGER  = "0x03987638d7a0522c2e1521714e46D486628c87a0";
  const YRPTS    = "0xe8f731bef3Ebda21Da6aa4a2B061448F7842e90c";
  const USDC     = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const AAVE     = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";
  const DEPLOYER = "0x087ea7F67d9282f0bdC43627b855F79789C6824C";
  const ALICE    = "0xa7C381eA23E12B83500A5D3eEE850068740B0339";

  const ERC20_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address,address) view returns (uint256)",
  ];
  const VAULT_ABI = [
    "function depositsPaused() view returns (bool)",
    "function redeemsPaused() view returns (bool)",
    "function reserveRatioBps() view returns (uint256)",
    "function isAllowed(address) view returns (bool)",
  ];
  const TREASURY_ABI = [
    "function rebateBudget(address) view returns (uint256)",
    "function approvedAssets(address) view returns (bool)",
  ];
  const AAVE_ABI = [
    "function getReserveData(address) view returns (tuple(uint256,uint128,uint128,uint128,uint128,uint128,uint40,uint16,address,address,address,address,uint128,uint128,uint128))",
  ];

  const provider  = ethers.provider;
  const usdc      = new ethers.Contract(USDC,     ERC20_ABI,    provider);
  const yrpts     = new ethers.Contract(YRPTS,    ERC20_ABI,    provider);
  const vaultErc  = new ethers.Contract(VAULT,    ERC20_ABI,    provider);
  const vault     = new ethers.Contract(VAULT,    VAULT_ABI,    provider);
  const treasury  = new ethers.Contract(TREASURY, TREASURY_ABI, provider);
  const aave      = new ethers.Contract(AAVE,     AAVE_ABI,     provider);

  const [
    dEth, aEth,
    dUsdc, aUsdc,
    yrCoreAllow, yrptsAllow,
    rebate, apYrCore, apYrpts,
    depPaused, redPaused, resBps,
    aliceWl,
  ] = await Promise.all([
    provider.getBalance(DEPLOYER),
    provider.getBalance(ALICE),
    usdc.balanceOf(DEPLOYER),
    usdc.balanceOf(ALICE),
    vaultErc.allowance(TREASURY, MANAGER),
    yrpts.allowance(TREASURY, MANAGER),
    treasury.rebateBudget(VAULT),
    treasury.approvedAssets(VAULT),
    treasury.approvedAssets(YRPTS),
    vault.depositsPaused(),
    vault.redeemsPaused(),
    vault.reserveRatioBps(),
    vault.isAllowed(ALICE),
  ]);

  const aaveOk = await aave.getReserveData(USDC).then(() => true).catch(() => false);

  const MX = ethers.MaxUint256;

  console.log("=== [E] Treasury 预算 & 授权 ===");
  console.log("  yrCORE allowance(treasury->manager):", yrCoreAllow === MX ? "MaxUint256 ✓" : yrCoreAllow.toString() + " ⚠");
  console.log("  YRPTS  allowance(treasury->manager):", yrptsAllow  === MX ? "MaxUint256 ✓" : yrptsAllow.toString()  + " ⚠");
  console.log("  rebateBudget(yrCORE)               :", rebate === MX ? "MaxUint256 ✓" : rebate.toString() + " ⚠");
  console.log("  approvedAssets[yrCORE]             :", apYrCore ? "true ✓" : "false ⚠");
  console.log("  approvedAssets[YRPTS]              :", apYrpts  ? "true ✓" : "false ⚠");

  console.log("\n=== [F] Vault 状态 ===");
  console.log("  depositsPaused :", depPaused ? "true ⚠ 已暂停" : "false ✓");
  console.log("  redeemsPaused  :", redPaused ? "true ⚠ 已暂停" : "false ✓");
  console.log("  reserveRatioBps:", resBps.toString(), resBps === 3000n ? "(30%) ✓" : "⚠ 非 3000");
  console.log("  Alice allowlist:", aliceWl ? "true ✓" : "false — rehearsal 前需 addToAllowlist ⚠");

  console.log("\n=== [G] 钱包余额 ===");
  const dEthNum = Number(ethers.formatEther(dEth));
  const aEthNum = Number(ethers.formatEther(aEth));
  console.log("  Deployer ETH :", ethers.formatEther(dEth),  dEthNum < 0.05 ? "⚠ 偏低 (建议补至 ≥0.05 ETH)" : "✓");
  console.log("  Alice    ETH :", ethers.formatEther(aEth),  aEthNum < 0.005 ? "⚠ 不足 rehearsal gas" : "✓");
  console.log("  Deployer USDC:", ethers.formatUnits(dUsdc, 6));
  console.log("  Alice    USDC:", ethers.formatUnits(aUsdc, 6), BigInt(aUsdc) >= 5000000n ? "(≥5 ✓)" : "⚠ 需要至少 5 USDC");

  console.log("\n=== [H] Aave V3 Pool ===");
  console.log("  getReserveData(USDC):", aaveOk ? "响应正常 ✓" : "调用失败 ⚠");
}

main().catch(console.error);
