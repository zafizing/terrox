import '../styles/globals.css'
import dynamic from 'next/dynamic'

const SolanaWalletProvider = dynamic(
  () => import('../components/WalletProvider'),
  { ssr: false }
)

export default function App({ Component, pageProps }) {
  return (
    <SolanaWalletProvider>
      <Component {...pageProps} />
    </SolanaWalletProvider>
  )
}
