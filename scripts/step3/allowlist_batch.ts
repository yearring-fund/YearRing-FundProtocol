/**
 * allowlist_batch.ts — Batch allowlist management for Step3 invite-only operation
 *
 * Usage:
 *   npx hardhat run scripts/step3/allowlist_batch.ts --network base
 *
 * Requires: DEFAULT_ADMIN_ROLE (PRIVATE_KEY in .env must be admin)
 *
 * Instructions:
 *   1. Fill in ALLOWLIST_ADDRESSES with the 5 invited user addresses
 *   2. Fill in NON_ALLOWLIST_ADDRESS for reference (not added, just documented)
 *   3. Run the script — it will skip addresses already on allowlist
 */
import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config();

// ─── Step3 首批受邀用户（填入真实地址后运行）────────────────────────────────
const ALLOWLIST_ADDRESSES: string[] = [
  "0xa7C381eA23E12B83500A5D3eEE850068740B0339",   // 用户 A
  "0x9d84145F057C2fd532250891E9b02BDe0C92CcB4",   // 用户 B
  "0x2dfF07C3Bb71CB6c6EB366b4b2f30CEb48771d4B",   // 用户 C
  "0x747062942aC7e66BD162FAE8F05c7d2a8C9e8DFe",   // 用户 D
  "0x6248C59f517e096258C611578a19F80e594E379B",   // 用户 E
];

// ─── 非白名单地址（仅记录，不会被添加）──────────────────────────────────────
// 可用于测试"未授权地址无法 deposit"的预期行为
const NON_ALLOWLIST_ADDRESS = "0xC7466ab073978C154c0A565d6273Ce4Ba7b414B2";  // 观察者 / 测试用

// ─────────────────────────────────────────────────────────────────────────────

const VAULT_ABI = [
  "function addToAllowlist(address account) external",
  "function isAllowed(address) view returns (bool)",
];

async function main() {
  // 地址格式校验
  const invalid = ALLOWLIST_ADDRESSES.filter(a => !ethers.isAddress(a));
  if (invalid.length > 0) {
    throw new Error(
      `以下地址格式无效，请先填入真实地址：\n${invalid.join("\n")}`
    );
  }
  if (!ethers.isAddress(NON_ALLOWLIST_ADDRESS)) {
    throw new Error(`NON_ALLOWLIST_ADDRESS 格式无效：${NON_ALLOWLIST_ADDRESS}`);
  }

  const dep = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../../deployments/base.json"), "utf8")
  );
  const [signer] = await ethers.getSigners();
  const vault = new ethers.Contract(dep.contracts.FundVaultV01, VAULT_ABI, signer);

  console.log("=".repeat(60));
  console.log("Step3 — allowlist_batch");
  console.log("Vault :", dep.contracts.FundVaultV01);
  console.log("Admin :", signer.address);
  console.log("=".repeat(60));

  // ── 批量添加白名单 ────────────────────────────────────────────────────────
  console.log(`\n添加 ${ALLOWLIST_ADDRESSES.length} 个受邀地址：`);

  const results: { address: string; status: string; tx?: string }[] = [];

  for (const addr of ALLOWLIST_ADDRESSES) {
    const already = await vault.isAllowed(addr);
    if (already) {
      console.log(`  [skip]  ${addr} — 已在白名单`);
      results.push({ address: addr, status: "already_allowed" });
      continue;
    }
    const tx = await vault.addToAllowlist(addr, { gasLimit: 100000 });
    const receipt = await tx.wait(2); // wait 2 confirmations to avoid read-after-write lag
    const after = await vault.isAllowed(addr);
    const status = after ? "added" : "FAILED";
    console.log(`  [${status}]  ${addr}  tx: ${tx.hash}  block: ${receipt?.blockNumber}`);
    results.push({ address: addr, status, tx: tx.hash });
  }

  // ── 非白名单地址确认 ──────────────────────────────────────────────────────
  console.log("\n非白名单地址（仅确认，不添加）：");
  const nonAllowed = await vault.isAllowed(NON_ALLOWLIST_ADDRESS);
  console.log(
    `  ${NON_ALLOWLIST_ADDRESS} — isAllowed: ${nonAllowed}` +
    (nonAllowed ? "  ⚠️  警告：此地址已在白名单，与预期不符" : "  ✓ 确认未授权")
  );

  // ── 汇总 ─────────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(60));
  console.log("批量结果汇总：");
  for (const r of results) {
    console.log(`  ${r.status.padEnd(16)} ${r.address}${r.tx ? "  " + r.tx : ""}`);
  }

  const failed = results.filter(r => r.status === "FAILED");
  if (failed.length > 0) {
    throw new Error(`${failed.length} 个地址添加失败，请检查 admin 权限与 gas`);
  }
  console.log("\n完成。白名单录入成功。");
}

main().catch(console.error);
