/**
 * timelock_restore_normal_step1_schedule.ts
 *
 * Schedules a Timelock batch to restore FundVaultV01 from EmergencyExit → Normal:
 *   Call 1: vault.closeExitModeRound()
 *   Call 2: vault.setMode(0)  — 0 = Normal
 *
 * Requires: PROPOSER_ROLE on ProtocolTimelockV02 (deployer EOA retains this).
 *
 * After running:
 *   - Note the operationId and ETA printed below
 *   - Wait for MIN_DELAY (see output)
 *   - Run: npx hardhat run scripts/timelock_restore_normal_step2_execute.ts --network base
 *
 * Usage:
 *   npx hardhat run scripts/timelock_restore_normal_step1_schedule.ts --network base
 */
import { ethers } from "hardhat"
import * as fs    from "fs"
import * as path  from "path"

const VAULT_ADDR    = "0x9dD61ee543a9C51aBe7B26A89687C9aEeea98a54"
const TIMELOCK_ADDR = "0x054Cb2c32D6062B291420584dE2e5952C372cDD6"

const VAULT_ABI = [
  "function systemMode() view returns (uint8)",
  "function currentRoundId() view returns (uint256)",
  "function exitRounds(uint256) view returns (uint256,uint256,uint256,uint256,bool,uint256)",
  "function closeExitModeRound()",
  "function setMode(uint8 newMode)",
]

const TIMELOCK_ABI = [
  "function scheduleBatch(address[] targets, uint256[] values, bytes[] payloads, bytes32 predecessor, bytes32 salt, uint256 delay)",
  "function hashOperationBatch(address[] targets, uint256[] values, bytes[] payloads, bytes32 predecessor, bytes32 salt) view returns (bytes32)",
  "function isOperation(bytes32 id) view returns (bool)",
  "function getMinDelay() view returns (uint256)",
]

const SALT        = ethers.id("yearring.restore.normal.2026-04-22")
const PREDECESSOR = ethers.ZeroHash

async function main() {
  const chainId = (await ethers.provider.getNetwork()).chainId
  if (chainId !== 8453n) {
    console.error("❌  Must run with --network base"); process.exit(1)
  }

  const [proposer] = await ethers.getSigners()
  const vault      = new ethers.Contract(VAULT_ADDR,    VAULT_ABI,    proposer)
  const timelock   = new ethers.Contract(TIMELOCK_ADDR, TIMELOCK_ABI, proposer)

  // ── Pre-flight ────────────────────────────────────────────────────────────
  const [mode, roundId, minDelay] = await Promise.all([
    vault.systemMode(),
    vault.currentRoundId(),
    timelock.getMinDelay(),
  ])

  const MODE = ["Normal", "Paused", "EmergencyExit"]
  console.log("\n╔══════════════════════════════════════════════════════════╗")
  console.log("║   Timelock — Restore Normal Mode  (Step 1: schedule)    ║")
  console.log("╚══════════════════════════════════════════════════════════╝")
  console.log(`\nProposer   : ${proposer.address}`)
  console.log(`Vault      : ${VAULT_ADDR}`)
  console.log(`Timelock   : ${TIMELOCK_ADDR}`)
  console.log(`MIN_DELAY  : ${Number(minDelay) / 3600}h`)
  console.log(`systemMode : ${MODE[Number(mode)] ?? mode.toString()}`)
  console.log(`roundId    : ${roundId.toString()}`)

  if (Number(mode) !== 2) {
    console.log("\n⚠️  Vault is not in EmergencyExit mode — nothing to schedule.")
    return
  }

  // Check round state
  let roundIsOpen = false
  if (roundId > 0n) {
    const round = await vault.exitRounds(roundId)
    roundIsOpen = round[4] // isOpen is index 4
    console.log(`\nRound ${roundId} isOpen: ${roundIsOpen}`)
    console.log(`  availableAssets : ${ethers.formatUnits(round[2], 6)} USDC`)
    console.log(`  totalClaimed    : ${ethers.formatUnits(round[3], 6)} USDC`)
    console.log(`  unclaimed       : ${ethers.formatUnits(round[2] - round[3], 6)} USDC`)
  }

  // ── Build batch calldata ──────────────────────────────────────────────────
  const iface = new ethers.Interface(VAULT_ABI)

  const targets:  string[] = []
  const values:   bigint[] = []
  const payloads: string[] = []

  // Call 1: closeExitModeRound (only if round is open)
  if (roundIsOpen) {
    targets.push(VAULT_ADDR)
    values.push(0n)
    payloads.push(iface.encodeFunctionData("closeExitModeRound", []))
    console.log("\n  + Batch call 1: closeExitModeRound()")
  } else {
    console.log("\n  ℹ️  Round already closed — skipping closeExitModeRound()")
  }

  // Call 2: setMode(0) — Normal
  targets.push(VAULT_ADDR)
  values.push(0n)
  payloads.push(iface.encodeFunctionData("setMode", [0]))
  console.log("  + Batch call " + targets.length + ": setMode(0)  [Normal]")

  // ── Check for duplicate operation ─────────────────────────────────────────
  const operationId = await timelock.hashOperationBatch(targets, values, payloads, PREDECESSOR, SALT)
  const alreadyQueued = await timelock.isOperation(operationId)

  if (alreadyQueued) {
    console.log(`\n⚠️  Operation already queued. operationId: ${operationId}`)
    console.log(`   Skip to step 2 and execute after the delay.`)
    process.exit(0)
  }

  // ── Schedule ──────────────────────────────────────────────────────────────
  console.log(`\nScheduling batch (${targets.length} calls) with ${Number(minDelay) / 3600}h delay…`)
  const tx = await timelock.scheduleBatch(targets, values, payloads, PREDECESSOR, SALT, minDelay)
  const receipt = await tx.wait()

  const etaUnix = BigInt(Math.floor(Date.now() / 1000)) + minDelay
  const etaDate = new Date(Number(etaUnix) * 1000).toISOString()

  console.log(`\n✅  Scheduled!`)
  console.log(`   tx hash     : ${receipt.hash}`)
  console.log(`   block       : ${receipt.blockNumber}`)
  console.log(`   ETA         : ${etaDate}`)
  console.log(`   operationId : ${operationId}`)

  // ── Save record ───────────────────────────────────────────────────────────
  const record = {
    step:        "schedule",
    timestamp:   new Date().toISOString(),
    operation:   "closeExitModeRound + setMode(Normal)",
    vault:       VAULT_ADDR,
    timelock:    TIMELOCK_ADDR,
    targets,
    values:      values.map(v => v.toString()),
    payloads,
    predecessor: PREDECESSOR,
    salt:        SALT,
    operationId,
    scheduleTxHash: receipt.hash,
    scheduleBlock:  receipt.blockNumber,
    eta:         etaDate,
    etaUnix:     etaUnix.toString(),
    minDelay:    minDelay.toString(),
  }

  const outPath = path.join(__dirname, "../deployments/restore_normal_timelock.json")
  fs.writeFileSync(outPath, JSON.stringify(record, null, 2))
  console.log(`\n   Record saved → deployments/restore_normal_timelock.json`)
  console.log(`\n  ──────────────────────────────────────────────────────────`)
  console.log(`  Next step:`)
  console.log(`    Wait until : ${etaDate}`)
  console.log(`    Then run   : npx hardhat run scripts/timelock_restore_normal_step2_execute.ts --network base`)
}

main().catch(e => { console.error(e); process.exit(1) })
