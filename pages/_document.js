import { Html, Head, Main, NextScript } from 'next/document'

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <meta name="description" content="Terrox — Own the world. One pixel at a time." />
        <meta property="og:title" content="TERROX — Own The World" />
        <meta property="og:description" content="Buy pixels on a real world map. Prices rise with every sale. Previous owners always profit." />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}
