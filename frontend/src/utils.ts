import { parseUnits, formatUnits } from 'viem'

/**
 * Parse a user-entered decimal string into a bigint with the given decimals.
 * Uses viem parseUnits — exact string-based conversion, no float arithmetic.
 * Returns 0n on empty or invalid input.
 */
export function parseBigIntInput(value: string, decimals: number): bigint {
  const trimmed = value.trim()
  if (!trimmed || trimmed === '.' || trimmed === '-') return 0n
  try {
    return parseUnits(trimmed, decimals)
  } catch {
    return 0n
  }
}

export const parseSharesInput = (v: string) => parseBigIntInput(v, 18)
export const parseUsdcInput   = (v: string) => parseBigIntInput(v, 6)

/**
 * Format a bigint (18 decimals) back to a display string for input fields.
 * Used when computing percentage fills from on-chain balances.
 */
export const formatSharesForInput = (n: bigint) => formatUnits(n, 18)

// ---------------------------------------------------------------------------
// Legacy helpers — kept for display-only callers outside of this module.
// Do NOT use for building on-chain calldata.
// ---------------------------------------------------------------------------
/** @deprecated Use parseUsdcInput instead for on-chain amounts */
export const D6  = (n: number) => BigInt(Math.round(n * 1e6))
/** @deprecated Use parseSharesInput instead for on-chain amounts */
export const D18 = (n: number) => BigInt(Math.round(n * 1e18))

export function fmtUsdc(n: bigint | undefined): string {
  if (n === undefined) return '–'
  return parseFloat(formatUnits(n, 6)).toFixed(2) + ' USDC'
}

export function fmtShares(n: bigint | undefined): string {
  if (n === undefined) return '–'
  return parseFloat(formatUnits(n, 18)).toFixed(6) + ' yrCORE'
}

export function fmtPoints(n: bigint | undefined): string {
  if (n === undefined) return '–'
  return parseFloat(formatUnits(n, 18)).toFixed(4) + ' Points'
}

export function fmtPps(n: bigint | undefined): string {
  if (n === undefined) return '–'
  // pricePerShare() returns convertToAssets(1e18 shares) in USDC (6 dec)
  return parseFloat(formatUnits(n, 6)).toFixed(6) + ' USDC/share'
}

export function fmtBps(n: bigint | undefined): string {
  if (n === undefined) return '–'
  return (Number(n) / 100).toFixed(0) + '%'
}

export function fmtTs(ts: bigint | number | undefined): string {
  if (ts === undefined || ts === 0n || ts === 0) return '–'
  return new Date(Number(ts) * 1000).toLocaleString()
}

export function fmtAddr(addr: string | undefined): string {
  if (!addr || addr === '0x0000000000000000000000000000000000000000') return '–'
  return addr.slice(0, 6) + '…' + addr.slice(-4)
}

export function lockStateName(s: number | undefined): string {
  if (s === undefined) return '–'
  return ['Normal', 'Locked (Accumulating)', 'Matured', 'Early Exited'][s] ?? '–'
}

export function tierName(t: number | undefined): string {
  if (t === undefined) return '–'
  return ['None', 'Bronze', 'Silver', 'Gold'][t] ?? '–'
}

export const DURATION_30D  = 30  * 24 * 3600
export const DURATION_90D  = 90  * 24 * 3600
export const DURATION_180D = 180 * 24 * 3600

export function shortErr(e: unknown): string {
  if (!e) return ''
  const err = e as { shortMessage?: string; message?: string }
  return err.shortMessage ?? err.message ?? String(e)
}

export function isZeroAddr(a: string | undefined): boolean {
  return !a || a === '' || a === '0x0000000000000000000000000000000000000000'
}
