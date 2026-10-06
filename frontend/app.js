/**
 * app.js — YearRing-FundProtocol Demo Frontend Logic
 *
 * Uses ethers.js v6 (loaded via CDN in index.html).
 * Depends on window.DEMO_CONFIG from config.js.
 */

"use strict";

// ─── Global state ─────────────────────────────────────────────────────────

let provider = null;
let signer   = null;
let userAddr = null;
let C        = {};        // contracts map
let activeLockId = null;  // current user's active lock ID (if any)

const CFG = window.DEMO_CONFIG;
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

// ─── Formatting helpers ───────────────────────────────────────────────────

const fmt6  = (n) => (Number(ethers.formatUnits(n, 6))).toFixed(2);
const fmt18 = (n) => (Number(ethers.formatEther(n))).toFixed(4);
const fmtAddr = (a) => a ? `${a.slice(0,6)}…${a.slice(-4)}` : "—";
const fmtDate = (ts) => ts > 0n
  ? new Date(Number(ts) * 1000).toLocaleDateString("en-US", {year:"numeric",month:"short",day:"numeric"})
  : "—";

// ─── Status helpers ───────────────────────────────────────────────────────

function setStatus(id, msg, type = "info") {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.className = `status ${type}`;
}

function setLoading(id, loading) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.disabled = loading;
  btn.dataset.original = btn.dataset.original || btn.textContent;
  btn.textContent = loading ? "Processing…" : btn.dataset.original;
}

// ─── Contract initialization ──────────────────────────────────────────────

function configIsComplete() {
  const a = CFG.ADDRESSES;
  return Object.values(a).every(v => v && v !== "" && v !== ZERO_ADDR);
}

async function initContracts() {
  const a = CFG.ADDRESSES;
  const s = signer || provider;
  C.usdc      = new ethers.Contract(a.USDC,               CFG.ABI.USDC,               s);
  C.vault     = new ethers.Contract(a.FundVaultV01,       CFG.ABI.FundVaultV01,       s);
  C.rwToken   = new ethers.Contract(a.RewardToken,        CFG.ABI.RewardToken,        s);
  C.ledger    = new ethers.Contract(a.LockLedgerV02,      CFG.ABI.LockLedgerV02,      s);
  C.benefit   = new ethers.Contract(a.LockBenefitV02,     CFG.ABI.LockBenefitV02,     s);
  C.lockMgr   = new ethers.Contract(a.LockRewardManagerV02, CFG.ABI.LockRewardManagerV02, s);
  C.benModule = new ethers.Contract(a.BeneficiaryModuleV02, CFG.ABI.BeneficiaryModuleV02, s);
  C.engine    = new ethers.Contract(a.UserStateEngineV02,  CFG.ABI.UserStateEngineV02, s);
  C.metrics   = new ethers.Contract(a.MetricsLayerV02,    CFG.ABI.MetricsLayerV02,    s);
}

// ─── Wallet connection ────────────────────────────────────────────────────

async function connectWallet() {
  if (!window.ethereum) {
    alert("MetaMask (or compatible wallet) not detected. Please install it.");
    return;
  }
  try {
    setLoading("connect-btn", true);
    provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    signer   = await provider.getSigner();
    userAddr = await signer.getAddress();

    const network = await provider.getNetwork();
    const chainId = Number(network.chainId);

    if (chainId !== CFG.CHAIN_ID) {
      setStatus("wallet-status", `Wrong network (got chainId ${chainId}). Please switch to ${CFG.CHAIN_NAME}.`, "error");
      await switchNetwork();
    }

    document.getElementById("wallet-address").textContent = fmtAddr(userAddr);
    document.getElementById("wallet-full").textContent    = userAddr;
    document.getElementById("network-badge").textContent  = CFG.CHAIN_NAME;
    document.getElementById("connect-btn").textContent    = "Connected";
    document.getElementById("connect-btn").disabled       = true;
    document.getElementById("disconnect-btn").style.display = "inline-block";
    setStatus("wallet-status", "Wallet connected ✓", "ok");

    if (!configIsComplete()) {
      setStatus("wallet-status", "Wallet connected — but contract addresses not configured. Update frontend/config.js.", "warn");
      return;
    }

    await initContracts();
    await refreshAll();

    // Listen for account/chain changes
    window.ethereum.on("accountsChanged", () => window.location.reload());
    window.ethereum.on("chainChanged",    () => window.location.reload());

  } catch (err) {
    setStatus("wallet-status", `Connection failed: ${err.message}`, "error");
  } finally {
    setLoading("connect-btn", false);
  }
}

async function switchNetwork() {
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x" + CFG.CHAIN_ID.toString(16) }],
    });
  } catch (e) {
    // Chain not added — add it
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId:  "0x" + CFG.CHAIN_ID.toString(16),
        chainName: CFG.CHAIN_NAME,
        rpcUrls: [CFG.RPC_URL],
        nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
        blockExplorerUrls: ["https://sepolia.basescan.org"],
      }],
    });
  }
}

function disconnectWallet() {
  provider = signer = userAddr = null;
  C = {};
  activeLockId = null;
  window.location.reload();
}

// ─── Refresh all sections ─────────────────────────────────────────────────

async function refreshAll() {
  if (!userAddr || !configIsComplete()) return;
  await Promise.all([
    refreshProtocolStats(),
    refreshVaultSection(),
    refreshLockSection(),
    refreshIncentiveSection(),
    refreshStateSection(),
    refreshBeneficiarySection(),
    refreshStrategySection(),
  ]);
}

// ─── Protocol stats bar ───────────────────────────────────────────────────

async function refreshProtocolStats() {
  try {
    const snap = await C.metrics.snapshot();
    const pps  = await C.vault.pricePerShare();
    setText("stat-tvl",          fmt6(snap.totalTVL) + " USDC");
    setText("stat-pps",          fmt6(pps) + " USDC/share");
    setText("stat-locked-ratio", (Number(snap.lockedRatioBps) / 100).toFixed(2) + "%");
    setText("stat-total-locks",  snap.totalLocksEver.toString());
  } catch (e) { /* silent — metrics might not be deployed */ }
}

// ─── Vault section ────────────────────────────────────────────────────────

async function refreshVaultSection() {
  try {
    const [usdcBal, sharesBal, totalAssets, pps] = await Promise.all([
      C.usdc.balanceOf(userAddr),
      C.vault.balanceOf(userAddr),
      C.vault.totalAssets(),
      C.vault.pricePerShare(),
    ]);
    setText("vault-usdc-bal",   fmt6(usdcBal)    + " USDC");
    setText("vault-shares-bal", fmt18(sharesBal) + " fbUSDC");
    setText("vault-total",      fmt6(totalAssets) + " USDC");
    setText("vault-pps",        fmt6(pps) + " USDC/share");
  } catch (e) { setStatus("vault-status", "Error: " + e.message, "error"); }
}

async function doDeposit() {
  const input = document.getElementById("deposit-amount").value;
  if (!input || isNaN(+input) || +input <= 0) {
    setStatus("vault-status", "Enter a valid USDC amount.", "error"); return;
  }
  const amount = ethers.parseUnits(input, 6);
  setLoading("deposit-btn", true);
  setStatus("vault-status", "Approving USDC…", "info");
  try {
    const allowance = await C.usdc.allowance(userAddr, CFG.ADDRESSES.FundVaultV01);
    if (allowance < amount) {
      const tx = await C.usdc.approve(CFG.ADDRESSES.FundVaultV01, ethers.MaxUint256);
      setStatus("vault-status", "Waiting for approval…", "info");
      await tx.wait();
    }
    setStatus("vault-status", "Depositing…", "info");
    const tx2 = await C.vault.deposit(amount, userAddr);
    await tx2.wait();
    setStatus("vault-status", `Deposited ${input} USDC ✓`, "ok");
    document.getElementById("deposit-amount").value = "";
    await refreshVaultSection();
    await refreshStrategySection();
  } catch (e) {
    setStatus("vault-status", "Deposit failed: " + (e.reason || e.message), "error");
  } finally { setLoading("deposit-btn", false); }
}

async function doRedeem() {
  const input = document.getElementById("redeem-shares").value;
  if (!input || isNaN(+input) || +input <= 0) {
    setStatus("vault-status", "Enter a valid share amount.", "error"); return;
  }
  const shares = ethers.parseEther(input);
  setLoading("redeem-btn", true);
  setStatus("vault-status", "Redeeming…", "info");
  try {
    const tx = await C.vault.redeem(shares, userAddr, userAddr);
    await tx.wait();
    setStatus("vault-status", `Redeemed ${input} fbUSDC ✓`, "ok");
    document.getElementById("redeem-shares").value = "";
    await refreshVaultSection();
  } catch (e) {
    setStatus("vault-status", "Redeem failed: " + (e.reason || e.message), "error");
  } finally { setLoading("redeem-btn", false); }
}

// ─── Lock section ─────────────────────────────────────────────────────────

async function refreshLockSection() {
  try {
    const ids = await C.ledger.userLockIds(userAddr);
    activeLockId = null;

    if (ids.length === 0) {
      setLockDisplay(null);
      return;
    }

    // Find the first active (not unlocked, not earlyExited) lock
    for (const id of ids) {
      const pos = await C.ledger.getLock(id);
      if (!pos.unlocked && !pos.earlyExited) {
        activeLockId = id;
        const [tier, state, discount, issued] = await Promise.all([
          C.benefit.tierOf(id),
          C.engine.lockStateOf(id),
          C.benefit.feeDiscountBpsOf(id),
          C.lockMgr.issuedRewardTokens(id),
        ]);
        setLockDisplay({ id, pos, tier, state, discount, issued });
        return;
      }
    }
    // All locks are completed
    setLockDisplay(null);
  } catch (e) { setStatus("lock-status", "Error: " + e.message, "error"); }
}

function setLockDisplay(data) {
  const infoEl  = document.getElementById("lock-info");
  const actEl   = document.getElementById("lock-actions");
  const newEl   = document.getElementById("lock-new");

  if (!data) {
    infoEl.innerHTML = `<span class="muted">No active lock</span>`;
    actEl.style.display  = "none";
    newEl.style.display  = "block";
    return;
  }
  const { id, pos, tier, state, discount, issued } = data;
  const isMatured   = state === 2n;
  const stateName   = CFG.STATE_LABEL[Number(state)] || "Unknown";
  const tierName    = CFG.TIER_LABEL[Number(tier)]   || "Unknown";
  const discountPct = (Number(discount) / 100).toFixed(0);

  infoEl.innerHTML = `
    <table class="info-table">
      <tr><th>Lock ID</th><td>${id.toString()}</td></tr>
      <tr><th>Tier</th><td>${tierName}</td></tr>
      <tr><th>State</th><td><span class="badge badge-${isMatured ? 'green' : 'blue'}">${stateName}</span></td></tr>
      <tr><th>Shares</th><td>${fmt18(pos.shares)} fbUSDC</td></tr>
      <tr><th>Locked</th><td>${fmtDate(pos.lockedAt)}</td></tr>
      <tr><th>Unlocks</th><td>${fmtDate(pos.unlockAt)}</td></tr>
      <tr><th>RWT issued</th><td>${fmt18(issued)} RWT</td></tr>
      <tr><th>Fee discount</th><td>${discountPct}%</td></tr>
    </table>`;

  actEl.style.display = "flex";
  newEl.style.display = "none";

  document.getElementById("unlock-btn").disabled    = !isMatured;
  document.getElementById("earlyexit-btn").disabled = isMatured;
}

async function doLock() {
  const amountInput = document.getElementById("lock-amount").value;
  const tierSel     = document.getElementById("tier-select").value;
  if (!amountInput || isNaN(+amountInput) || +amountInput <= 0) {
    setStatus("lock-status", "Enter a valid share amount.", "error"); return;
  }
  const shares   = ethers.parseEther(amountInput);
  const duration = BigInt(CFG.TIER_DAYS[+tierSel] * 86400);

  setLoading("lock-btn", true);
  setStatus("lock-status", "Approving fbUSDC…", "info");
  try {
    const allowance = await C.vault.allowance(userAddr, CFG.ADDRESSES.LockLedgerV02);
    if (allowance < shares) {
      const tx = await C.vault.approve(CFG.ADDRESSES.LockLedgerV02, ethers.MaxUint256);
      await tx.wait();
    }
    setStatus("lock-status", "Creating lock…", "info");
    const tx2 = await C.lockMgr.lockWithReward(shares, duration);
    const rcpt = await tx2.wait();

    // Parse LockedWithReward event
    const iface = C.lockMgr.interface;
    const ev = rcpt.logs.map(l => { try { return iface.parseLog(l); } catch { return null; } })
                        .find(e => e?.name === "LockedWithReward");
    const newId = ev ? ev.args.lockId.toString() : "?";

    setStatus("lock-status", `Locked ✓  Lock ID: ${newId}`, "ok");
    document.getElementById("lock-amount").value = "";
    await refreshLockSection();
    await refreshVaultSection();
    await refreshIncentiveSection();
    await refreshStateSection();
  } catch (e) {
    setStatus("lock-status", "Lock failed: " + (e.reason || e.message), "error");
  } finally { setLoading("lock-btn", false); }
}

async function doUnlock() {
  if (activeLockId === null) return;
  setLoading("unlock-btn", true);
  setStatus("lock-status", "Unlocking…", "info");
  try {
    const tx = await C.ledger.unlock(activeLockId);
    await tx.wait();
    setStatus("lock-status", "Unlocked ✓ Shares returned to your wallet.", "ok");
    activeLockId = null;
    await refreshAll();
  } catch (e) {
    setStatus("lock-status", "Unlock failed: " + (e.reason || e.message), "error");
  } finally { setLoading("unlock-btn", false); }
}

async function doEarlyExit() {
  if (activeLockId === null) return;
  setLoading("earlyexit-btn", true);
  setStatus("lock-status", "Checking early exit…", "info");
  try {
    const [canExit, rwtToReturn] = await C.lockMgr.checkEarlyExit(activeLockId);
    if (!canExit) {
      setStatus("lock-status", "Early exit not available for this lock.", "error");
      return;
    }
    // Approve RWT return if needed
    if (rwtToReturn > 0n) {
      const rwAllowance = await C.rwToken.allowance(userAddr, CFG.ADDRESSES.LockRewardManagerV02);
      if (rwAllowance < rwtToReturn) {
        setStatus("lock-status", `Approving ${fmt18(rwtToReturn)} RWT return…`, "info");
        const appTx = await C.rwToken.approve(CFG.ADDRESSES.LockRewardManagerV02, ethers.MaxUint256);
        await appTx.wait();
      }
    }
    setStatus("lock-status", "Submitting early exit…", "info");
    const tx = await C.lockMgr.earlyExitWithReturn(activeLockId);
    await tx.wait();
    setStatus("lock-status", `Early exit complete. ${fmt18(rwtToReturn)} RWT returned to treasury.`, "ok");
    activeLockId = null;
    await refreshAll();
  } catch (e) {
    setStatus("lock-status", "Early exit failed: " + (e.reason || e.message), "error");
  } finally { setLoading("earlyexit-btn", false); }
}

// ─── Incentive section ────────────────────────────────────────────────────

async function refreshIncentiveSection() {
  try {
    const rwtBal = await C.rwToken.balanceOf(userAddr);
    setText("rwt-balance", fmt18(rwtBal) + " RWT");

    if (activeLockId !== null) {
      const [discount, preview] = await Promise.all([
        C.benefit.feeDiscountBpsOf(activeLockId),
        C.lockMgr.previewRebate(activeLockId),
      ]);
      setText("fee-discount",   (Number(discount) / 100).toFixed(0) + "% of mgmt fees refunded");
      setText("rebate-preview", fmt18(preview) + " fbUSDC claimable");
      document.getElementById("claim-rebate-btn").disabled = preview === 0n;
    } else {
      setText("fee-discount",   "No active lock");
      setText("rebate-preview", "—");
      document.getElementById("claim-rebate-btn").disabled = true;
    }
  } catch (e) { setStatus("incentive-status", "Error: " + e.message, "error"); }
}

async function doClaimRebate() {
  if (activeLockId === null) return;
  setLoading("claim-rebate-btn", true);
  setStatus("incentive-status", "Claiming rebate…", "info");
  try {
    const tx = await C.lockMgr.claimRebate(activeLockId);
    await tx.wait();
    setStatus("incentive-status", "Fee rebate claimed ✓", "ok");
    await refreshIncentiveSection();
    await refreshVaultSection();
  } catch (e) {
    setStatus("incentive-status", "Claim failed: " + (e.reason || e.message), "error");
  } finally { setLoading("claim-rebate-btn", false); }
}

// ─── State section ────────────────────────────────────────────────────────

async function refreshStateSection() {
  try {
    const userState = await C.engine.userStateOf(userAddr);
    const stateName = CFG.STATE_LABEL[Number(userState)] || "Unknown";
    const badgeCls  = userState === 0n ? "gray" : userState === 2n ? "green" : "blue";
    setText("user-state-badge", stateName);
    document.getElementById("user-state-badge").className = `badge badge-${badgeCls}`;

    const ids = await C.ledger.userLockIds(userAddr);
    const lockedShares = await C.ledger.userLockedSharesOf(userAddr);
    const freeShares   = await C.vault.balanceOf(userAddr);

    setText("state-locked-shares", fmt18(lockedShares) + " fbUSDC");
    setText("state-free-shares",   fmt18(freeShares)   + " fbUSDC");
    setText("state-lock-count",    ids.length.toString() + " total");

    if (activeLockId !== null) {
      const pos = await C.ledger.getLock(activeLockId);
      setText("state-unlock-date", fmtDate(pos.unlockAt));
    } else {
      setText("state-unlock-date", "—");
    }
  } catch (e) { setStatus("state-status", "Error: " + e.message, "error"); }
}

// ─── Beneficiary section ──────────────────────────────────────────────────

async function refreshBeneficiarySection() {
  try {
    const [ben, inactive, claimed_, lastActive] = await Promise.all([
      C.benModule.beneficiaryOf(userAddr),
      C.benModule.isInactive(userAddr),
      C.benModule.claimed(userAddr),
      C.benModule.lastActiveAt(userAddr),
    ]);
    const hasBen = ben !== ZERO_ADDR;
    setText("ben-current",    hasBen ? fmtAddr(ben) : "Not set");
    setText("ben-full",       hasBen ? ben : "");
    setText("ben-inactive",   inactive ? "⚠ Marked inactive" : "Active");
    setText("ben-claimed",    claimed_ ? "Claimed" : "Not claimed");
    setText("ben-last-active",lastActive > 0n ? fmtDate(lastActive) : "Never recorded");

    document.getElementById("ben-inactive").className = inactive ? "badge badge-red" : "badge badge-green";
    document.getElementById("revoke-ben-btn").disabled = !hasBen;
  } catch (e) { setStatus("ben-status", "Error: " + e.message, "error"); }
}

async function doSetBeneficiary() {
  const addr = document.getElementById("ben-address").value.trim();
  if (!ethers.isAddress(addr)) {
    setStatus("ben-status", "Enter a valid Ethereum address.", "error"); return;
  }
  setLoading("set-ben-btn", true);
  setStatus("ben-status", "Setting beneficiary…", "info");
  try {
    const current = await C.benModule.beneficiaryOf(userAddr);
    const tx = current === ZERO_ADDR
      ? await C.benModule.setBeneficiary(addr)
      : await C.benModule.updateBeneficiary(addr);
    await tx.wait();
    setStatus("ben-status", "Beneficiary set ✓", "ok");
    document.getElementById("ben-address").value = "";
    await refreshBeneficiarySection();
  } catch (e) {
    setStatus("ben-status", "Failed: " + (e.reason || e.message), "error");
  } finally { setLoading("set-ben-btn", false); }
}

async function doRevokeBeneficiary() {
  setLoading("revoke-ben-btn", true);
  setStatus("ben-status", "Revoking…", "info");
  try {
    const tx = await C.benModule.revokeBeneficiary();
    await tx.wait();
    setStatus("ben-status", "Beneficiary revoked ✓", "ok");
    await refreshBeneficiarySection();
  } catch (e) {
    setStatus("ben-status", "Failed: " + (e.reason || e.message), "error");
  } finally { setLoading("revoke-ben-btn", false); }
}

async function doHeartbeat() {
  setLoading("heartbeat-btn", true);
  setStatus("ben-status", "Sending heartbeat…", "info");
  try {
    const tx = await C.benModule.heartbeat();
    await tx.wait();
    setStatus("ben-status", "Heartbeat recorded ✓ (marks you as active)", "ok");
    await refreshBeneficiarySection();
  } catch (e) {
    setStatus("ben-status", "Failed: " + (e.reason || e.message), "error");
  } finally { setLoading("heartbeat-btn", false); }
}

async function doExecuteClaim() {
  const inactiveAddr = document.getElementById("claim-inactive-addr").value.trim();
  const lockIdsRaw   = document.getElementById("claim-lock-ids").value.trim();
  if (!ethers.isAddress(inactiveAddr)) {
    setStatus("ben-status", "Enter a valid inactive user address.", "error"); return;
  }
  let lockIds;
  try {
    lockIds = lockIdsRaw.split(",").map(s => BigInt(s.trim()));
  } catch {
    setStatus("ben-status", "Enter lock IDs as comma-separated numbers.", "error"); return;
  }
  setLoading("execute-claim-btn", true);
  setStatus("ben-status", "Executing claim…", "info");
  try {
    const tx = await C.benModule.executeClaim(inactiveAddr, lockIds);
    await tx.wait();
    setStatus("ben-status", "Claim executed ✓ Lock ownership transferred.", "ok");
    document.getElementById("claim-inactive-addr").value = "";
    document.getElementById("claim-lock-ids").value      = "";
    await refreshAll();
  } catch (e) {
    setStatus("ben-status", "Claim failed: " + (e.reason || e.message), "error");
  } finally { setLoading("execute-claim-btn", false); }
}

// ─── Strategy section ─────────────────────────────────────────────────────

async function refreshStrategySection() {
  try {
    const [totalAssets, usdcInVault] = await Promise.all([
      C.vault.totalAssets(),
      C.usdc.balanceOf(CFG.ADDRESSES.FundVaultV01),
    ]);
    const inStrategy = totalAssets > usdcInVault ? totalAssets - usdcInVault : 0n;
    setText("strat-total",      fmt6(totalAssets)  + " USDC");
    setText("strat-in-vault",   fmt6(usdcInVault)  + " USDC");
    setText("strat-deployed",   fmt6(inStrategy)   + " USDC");
  } catch (e) { setStatus("strat-status", "Error: " + e.message, "error"); }
}

// ─── Utility ──────────────────────────────────────────────────────────────

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

// ─── Boot ──────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("connect-btn").addEventListener("click", connectWallet);
  document.getElementById("disconnect-btn").addEventListener("click", disconnectWallet);
  document.getElementById("refresh-btn").addEventListener("click", refreshAll);

  // Vault
  document.getElementById("deposit-btn").addEventListener("click", doDeposit);
  document.getElementById("redeem-btn").addEventListener("click", doRedeem);

  // Lock
  document.getElementById("lock-btn").addEventListener("click", doLock);
  document.getElementById("unlock-btn").addEventListener("click", doUnlock);
  document.getElementById("earlyexit-btn").addEventListener("click", doEarlyExit);

  // Incentive
  document.getElementById("claim-rebate-btn").addEventListener("click", doClaimRebate);

  // Beneficiary
  document.getElementById("set-ben-btn").addEventListener("click", doSetBeneficiary);
  document.getElementById("revoke-ben-btn").addEventListener("click", doRevokeBeneficiary);
  document.getElementById("heartbeat-btn").addEventListener("click", doHeartbeat);
  document.getElementById("execute-claim-btn").addEventListener("click", doExecuteClaim);

  // Show warning if config not filled
  if (!configIsComplete()) {
    document.getElementById("config-warning").style.display = "block";
  }
});
