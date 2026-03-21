import { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js'

export const OWNER_WALLET = '3j8YDgyhk8Jj8XWdQJ6hpstvq9XQ2BWN8U8cT2qMCAQo'
export const BASE_PIXEL_PRICE_USD = 2
export const PRICE_INCREASE_PERCENT = 10
export const PLATFORM_FEE_PERCENT = 5
export const SELLER_BONUS_PERCENT = 5
export const SOL_PRICE_USD = 150 // approximate, update via API in production

export const usdToSol = (usd) => parseFloat((usd / SOL_PRICE_USD).toFixed(6))
export const solToUsd = (sol) => parseFloat((sol * SOL_PRICE_USD).toFixed(2))
export const BASE_PIXEL_PRICE_SOL = usdToSol(BASE_PIXEL_PRICE_USD)

export const calculateNextPrice = (currentPriceSol) =>
  parseFloat((currentPriceSol * (1 + PRICE_INCREASE_PERCENT / 100)).toFixed(6))

export const calculateSplit = (priceSol, isResale) => {
  if (!isResale) return { platform: priceSol, seller: 0 }
  const platform = parseFloat((priceSol * PLATFORM_FEE_PERCENT / 100).toFixed(6))
  const seller = parseFloat((priceSol - platform).toFixed(6))
  return { platform, seller }
}

export const getConnection = () =>
  new Connection(
    process.env.NEXT_PUBLIC_SOLANA_RPC || 'https://api.mainnet-beta.solana.com',
    'confirmed'
  )

// Build a transaction to pay for pixels
// If resale: split between seller and platform
// If first sale: all goes to platform
export const buildPaymentTransaction = async (
  buyerPublicKey,
  totalSol,
  sellerWallet = null,
  isResale = false
) => {
  const connection = getConnection()
  const { blockhash } = await connection.getLatestBlockhash()
  const tx = new Transaction({ recentBlockhash: blockhash, feePayer: buyerPublicKey })

  if (isResale && sellerWallet) {
    const split = calculateSplit(totalSol, true)
    // Pay seller their share + bonus
    tx.add(SystemProgram.transfer({
      fromPubkey: buyerPublicKey,
      toPubkey: new PublicKey(sellerWallet),
      lamports: Math.floor(split.seller * LAMPORTS_PER_SOL),
    }))
    // Pay platform fee
    tx.add(SystemProgram.transfer({
      fromPubkey: buyerPublicKey,
      toPubkey: new PublicKey(OWNER_WALLET),
      lamports: Math.floor(split.platform * LAMPORTS_PER_SOL),
    }))
  } else {
    // First sale — all to platform
    tx.add(SystemProgram.transfer({
      fromPubkey: buyerPublicKey,
      toPubkey: new PublicKey(OWNER_WALLET),
      lamports: Math.floor(totalSol * LAMPORTS_PER_SOL),
    }))
  }

  return tx
}

// Build bulk payment transaction
// For country/continent purchases: pay each seller individually + platform fees
// Groups: [{ pixelId, currentPriceSol, ownerWallet }]
export const buildBulkPaymentTransaction = async (buyerPublicKey, pixelGroups) => {
  const connection = getConnection()
  const { blockhash } = await connection.getLatestBlockhash()
  const tx = new Transaction({ recentBlockhash: blockhash, feePayer: buyerPublicKey })

  // Group payments by seller to minimize instructions
  const sellerMap = new Map()
  let platformTotal = 0

  for (const { currentPriceSol, ownerWallet } of pixelGroups) {
    const isResale = !!ownerWallet
    if (isResale) {
      const split = calculateSplit(currentPriceSol, true)
      sellerMap.set(ownerWallet, (sellerMap.get(ownerWallet) || 0) + split.seller)
      platformTotal += split.platform
    } else {
      platformTotal += currentPriceSol
    }
  }

  // Add seller payments
  for (const [wallet, amount] of sellerMap.entries()) {
    if (amount < 0.000001) continue
    tx.add(SystemProgram.transfer({
      fromPubkey: buyerPublicKey,
      toPubkey: new PublicKey(wallet),
      lamports: Math.floor(amount * LAMPORTS_PER_SOL),
    }))
  }

  // Add platform payment
  if (platformTotal > 0.000001) {
    tx.add(SystemProgram.transfer({
      fromPubkey: buyerPublicKey,
      toPubkey: new PublicKey(OWNER_WALLET),
      lamports: Math.floor(platformTotal * LAMPORTS_PER_SOL),
    }))
  }

  return tx
}

export const verifyTransaction = async (signature) => {
  const connection = getConnection()
  try {
    const tx = await connection.getTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    })
    return tx?.meta?.err === null
  } catch {
    return false
  }
}
