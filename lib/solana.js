export const OWNER_WALLET = '3j8YDgyhk8Jj8XWdQJ6hpstvq9XQ2BWN8U8cT2qMCAQo'
export const PLATFORM_FEE_PERCENT = 5
export const PRICE_INCREASE_PERCENT = 10
export const BASE_PIXEL_PRICE_SOL = 0.01

export const calculateNextPrice = (currentPrice) => {
  return parseFloat((currentPrice * (1 + PRICE_INCREASE_PERCENT / 100)).toFixed(6))
}

export const calculateSplit = (price, isResale) => {
  if (!isResale) {
    return { platform: price, seller: 0 }
  }
  const platformFee = parseFloat((price * (PLATFORM_FEE_PERCENT / 100)).toFixed(6))
  const sellerAmount = parseFloat((price - platformFee).toFixed(6))
  return { platform: platformFee, seller: sellerAmount }
}
