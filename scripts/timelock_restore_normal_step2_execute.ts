/**
 * timelock_restore_normal_step2_execute.ts
 *
 * Executes the scheduled Timelock batch: closeExitModeRound + setMode(Normal).
 * Reads parameters from deployments/restore_normal_timelock.json (written by step 1).
 *
 * Requires: EXECUTOR_ROLE on ProtocolTimelockV02, OR Timelock executor is open (address(0)).
 *
 * Usage:
 *   npx hardhat run scripts/timelock_restore_normal_step2_execute.ts --network base
 */
import { ethers } from "hardhat"
import * as fs    from "fs"
import * as path  from "path"

const VAULT_ADDR    = "0x9dD61ee543a9C51aBe7B26A89687C9aEeea98a54"
const TIMELOCK_ADDR = "0x054Cb2c32D6062B291420584dE2e5952C372cDD6"

const VAULT_ABI = [
  "function systemMode() view returns (uint8)",
  "function totalAssets() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function lastFeeAccrual() view returns (uint256)",
  "function currentRoundId() view returns (uint256)",
]

const TIMELOCK_ABI = [
  "function executeBatch(address[] targets, uint256[] values, bytes[] payloads, bytes32 predecessor, bytes32 salt) payable",
  "function isOperationReady(bytes32 id) view returns (bool)",
  "function isOperationDone(bytes32 id) view returns (bool)",
  "function isOperationPending(bytes32 id) view returns (bool)",
]

const MODE = ["Normal", "Paused", "EmergencyExit"]

async function main() {
  const chainId = (await ethers.provider.getNetwork()).chainId
  if (chainId !== 8453n) {
    console.error("❌  Must run with --network base"); process.exit(1)
  }

  // ── Load step1 record ─────────────────────────────────────────────────────
  const recordPath = path.join(__dirname, "../deployments/restore_normal_timelock.json")
  if (!fs.existsSync(recordPath)) {
    console.error("❌  deployments/restore_normal_timelock.json not found.")
    console.error("   Run step 1 first: npx hardhat run scripts/timelock_restore_normal_step1_schedule.ts --network base")
    process.exit(1)
  }

  const record = JSON.parse(fs.readFileSync(recordPath, "utf-8"))
  const { targets, values, payloads, predecessor, salt, operationId, eta } = record

  const [executor] = await ethers.getSigners()
  const vault      = new ethers.Contract(VAULT_ADDR,    VAULT_ABI,    executor)
  const timelock   = new ethers.Contract(TIMELOCK_ADDR, TIMELOCK_ABI, executor)

  console.log("\n╔══════════════════════════════════════════════════════════╗")
  console.log("║   Timelock — Restore Normal Mode  (Step 2: execute)     ║")
  console.log("╚══════════════════════════════════════════════════════════╝")
  console.log(`\nExecutor   : ${executor.address}`)
  console.log(`Vault      : ${VAULT_ADDR}`)
  console.log(`Timelock   : ${TIMELOCK_ADDR}`)
  console.log(`OperationId: ${operationId}`)
  console.log(`Scheduled  : ${record.timestamp}`)
  console.log(`ETA        : ${eta}`)

  // ── Check operation state ─────────────────────────────────────────────────
  const [isReady, isDone, isPending] = await Promise.all([
    timelock.isOperationReady(operationId),
    timelock.isOperationDone(operationId),
    timelock.isOperationPending(operationId),
  ])

  const stateLabel = isDone ? "Done" : isReady ? "Ready" : isPending ? "Waiting" : "Unset"
  console.log(`\nOperation state: ${stateLabel}`)

  if (isDone) {
    console.log("  ✅  Operation already executed — checking vault state…")
  } else if (!isReady) {
    const etaMs   = Number(record.etaUnix) * 1000
    const nowMs   = Date.now()
    const waitSec = Math.ceil((etaMs - nowMs) / 1000)
    console.log(`\n  ⏳  Operation not ready yet.`)
    console.log(`     ETA    : ${eta}`)
    console.log(`     Waiting: ~${Math.ceil(waitSec / 3600)}h ${Math.ceil((waitSec % 3600) / 60)}m remaining`)
    process.exit(0)
  }

  if (!isDone) {
    // ── Execute batch ───────────────────────────────────────────────────────
    const bigValues = (values as string[]).map((v: string) => BigInt(v))

    console.log(`\nExecuting batch (${targets.length} calls)…`)
    const tx = await timelock.executeBatch(targets, bigValues, payloads, predecessor, salt)
    const receipt = await tx.wait()
    console.log(`\n✅  Executed!`)
    console.log(`   tx hash : ${receipt.hash}`)
    console.log(`   block   : ${receipt.blockNumber}`)
  }

  // ── Verify vault state ────────────────────────────────────────────────────
  const [modeAfter, assetsAfter, supplyAfter, lastFeeAccrual, roundIdAfter] = await Promise.all([
    vault.systemMode(),
    vault.totalAssets(),
    vault.totalSupply(),
    vault.lastFeeAccrual(),
    vault.currentRoundId(),
  ])

  console.log("\n── Post-Execute Vault State ─────────────────────────────")
  console.log("  systemMode    :", MODE[Number(modeAfter)] ?? modeAfter.toString())
  console.log("  totalAssets   :", ethers.formatUnits(assetsAfter, 6), "USDC")
  console.log("  totalSupply   :", ethers.formatUnits(supplyAfter, 18), "fbUSDC")
  console.log("  lastFeeAccrual:", new Date(Number(lastFeeAccrual) * 1000).toISOString())
  console.log("  currentRoundId:", roundIdAfter.toString())

  if (Number(modeAfter) === 0) {
    console.log("\n  ✅  Vault is back in Normal mode.")
  } else {
    console.log("\n  ❌  Mode is still:", MODE[Number(modeAfter)])
    process.exit(1)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
