/** 40 real Solana memecoin mints used by the mock generator (best-effort addresses; mock mode only). */
export interface MockTokenSeed {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  priceUsd: number;
  marketCapUsd: number;
}

export const MOCK_TOKENS: MockTokenSeed[] = [
  { mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', symbol: 'WIF', name: 'dogwifhat', decimals: 6, priceUsd: 0.92, marketCapUsd: 920_000_000 },
  { mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', symbol: 'BONK', name: 'Bonk', decimals: 5, priceUsd: 0.0000195, marketCapUsd: 1_500_000_000 },
  { mint: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', symbol: 'POPCAT', name: 'Popcat', decimals: 9, priceUsd: 0.31, marketCapUsd: 305_000_000 },
  { mint: '2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv', symbol: 'PENGU', name: 'Pudgy Penguins', decimals: 6, priceUsd: 0.028, marketCapUsd: 1_760_000_000 },
  { mint: '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump', symbol: 'FARTCOIN', name: 'Fartcoin', decimals: 6, priceUsd: 0.78, marketCapUsd: 780_000_000 },
  { mint: '6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN', symbol: 'TRUMP', name: 'OFFICIAL TRUMP', decimals: 6, priceUsd: 7.9, marketCapUsd: 1_580_000_000 },
  { mint: '2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump', symbol: 'PNUT', name: 'Peanut the Squirrel', decimals: 6, priceUsd: 0.21, marketCapUsd: 210_000_000 },
  { mint: 'CzLSujWBLFsSjncfkh59rUFqvafWcY5tzedWJSuypump', symbol: 'GOAT', name: 'Goatseus Maximus', decimals: 6, priceUsd: 0.11, marketCapUsd: 110_000_000 },
  { mint: 'ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzPJBY', symbol: 'MOODENG', name: 'Moo Deng', decimals: 6, priceUsd: 0.17, marketCapUsd: 170_000_000 },
  { mint: 'HeLp6NuQkmYB4pYWo2zYs22mESHXPQYzXbB8n4V98jwC', symbol: 'AI16Z', name: 'ai16z', decimals: 9, priceUsd: 0.19, marketCapUsd: 209_000_000 },
  { mint: '63LfDmNb3MQ8mw9MtZ2To9bEA2M71kZUUGq5tiJxcqj9', symbol: 'GIGA', name: 'Gigachad', decimals: 5, priceUsd: 0.021, marketCapUsd: 200_000_000 },
  { mint: 'MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5', symbol: 'MEW', name: 'cat in a dogs world', decimals: 5, priceUsd: 0.0031, marketCapUsd: 275_000_000 },
  { mint: 'ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82', symbol: 'BOME', name: 'BOOK OF MEME', decimals: 6, priceUsd: 0.0019, marketCapUsd: 131_000_000 },
  { mint: 'J3NKxxXZcnNiMjKw9hYb2K4LUxgwB6t1FtPtQVsv3KFr', symbol: 'SPX', name: 'SPX6900', decimals: 8, priceUsd: 1.21, marketCapUsd: 1_120_000_000 },
  { mint: 'GJAFwWjJ3vnTsrQVabjBVK2TYB1YtRCQXRDfDgUnpump', symbol: 'ACT', name: 'Act I: The AI Prophecy', decimals: 6, priceUsd: 0.052, marketCapUsd: 49_000_000 },
  { mint: 'Df6yfrKC8kZE3KNkrHERKzAetSxbrWeniQfyJY4Jpump', symbol: 'CHILLGUY', name: 'Just a chill guy', decimals: 6, priceUsd: 0.045, marketCapUsd: 45_000_000 },
  { mint: '5mbK36SZ7J19An8jFochhQS4of8g6BwUjbeCSxBSoWdp', symbol: 'MICHI', name: 'michi', decimals: 6, priceUsd: 0.089, marketCapUsd: 49_000_000 },
  { mint: '6ogzHhzdrQr9Pgv6hZ2MNze7UrzBMAFyBBWUYp1Fhitx', symbol: 'RETARDIO', name: 'retardio', decimals: 6, priceUsd: 0.038, marketCapUsd: 38_000_000 },
  { mint: '5SVG3T9CNQsm2kEwzbRq6hASqh1oGfjqTtLXYUibpump', symbol: 'SIGMA', name: 'sigma', decimals: 6, priceUsd: 0.021, marketCapUsd: 21_000_000 },
  { mint: 'A8C3xuqscfmyLrte3VmTqrAq8kgMASius9AFNANwpump', symbol: 'FWOG', name: 'FWOG', decimals: 6, priceUsd: 0.034, marketCapUsd: 33_000_000 },
  { mint: 'WENWENvqqNya429ubCdR81ZmD69brwQaaBYY6p3LCpk', symbol: 'WEN', name: 'Wen', decimals: 5, priceUsd: 0.000041, marketCapUsd: 29_000_000 },
  { mint: '7BgBvyjrZX1YKz4oh9mjb8ZScatkkwb8DzFx7LoiVkM3', symbol: 'SLERF', name: 'SLERF', decimals: 9, priceUsd: 0.065, marketCapUsd: 32_000_000 },
  { mint: 'HhJpBhRRn4g56VsyLuT8DL5Bv31HkXqsrahTTUCZeZg4', symbol: 'MYRO', name: 'Myro', decimals: 9, priceUsd: 0.019, marketCapUsd: 19_000_000 },
  { mint: '5z3EqYQo9HiCEs3R84RCDMu2n7anpDMxRhdK8PSWmrRC', symbol: 'PONKE', name: 'PONKE', decimals: 9, priceUsd: 0.14, marketCapUsd: 78_000_000 },
  { mint: '3S8qX1MsMqRbiwKg2cQyx7nis1oHMgaCuc9c4VfvVdPN', symbol: 'MOTHER', name: 'MOTHER IGGY', decimals: 6, priceUsd: 0.024, marketCapUsd: 24_000_000 },
  { mint: '69kdRLyP5DTRkpHraaSZAQbWmAwzF9guKjZfzMXzcbAs', symbol: 'USA', name: 'American Coin', decimals: 9, priceUsd: 0.000012, marketCapUsd: 12_000_000 },
  { mint: '4Cnk9EPnW5ixfLZatCPJjDB1PUtcRpVVgTQukm9epump', symbol: 'DADDY', name: 'Daddy Tate', decimals: 6, priceUsd: 0.051, marketCapUsd: 29_000_000 },
  { mint: 'FU1q8vJpZNUrmqsciSjp8bAKKidGsLmouB8CBdf8TKQv', symbol: 'TREMP', name: 'doland tremp', decimals: 9, priceUsd: 0.071, marketCapUsd: 7_100_000 },
  { mint: 'Fch1oixTPri8zxBnmdCEADoJW2toyFHxqDZacQkwdvSP', symbol: 'HARAMBE', name: 'Harambe on Solana', decimals: 9, priceUsd: 0.028, marketCapUsd: 11_000_000 },
  { mint: 'GtDZKAqvMZMnti46ZewMiXCa4oXF4bZxwQPoKzXPFxZn', symbol: 'NUB', name: 'nubcat', decimals: 9, priceUsd: 0.011, marketCapUsd: 11_000_000 },
  { mint: '3B5wuUrMEi5yATD7on46hKfej3pfmd7t1RKgrsN3pump', symbol: 'BILLY', name: 'Billy', decimals: 6, priceUsd: 0.015, marketCapUsd: 15_000_000 },
  { mint: '5LafQUrVco6o7KMz42eqVEJ9LW31StPyGjeeu5sKoMtA', symbol: 'MUMU', name: 'Mumu the Bull', decimals: 6, priceUsd: 0.0000098, marketCapUsd: 22_000_000 },
  { mint: '8wXtPeU6557ETkp9WHFY1n1EcU6NxDvbAggHGsMYiHsB', symbol: 'GME', name: 'GameStop', decimals: 9, priceUsd: 0.0039, marketCapUsd: 27_000_000 },
  { mint: '8x5VqbHA8D7NkD52uNuS5nnt3PwA8pLD34ymskeSo2Wn', symbol: 'ZEREBRO', name: 'zerebro', decimals: 6, priceUsd: 0.036, marketCapUsd: 36_000_000 },
  { mint: 'KENJSUYLASHUMfHyy5o4Hp2FdNqZg1AsUPhfH2kYvEP', symbol: 'GRIFFAIN', name: 'griffain', decimals: 6, priceUsd: 0.041, marketCapUsd: 41_000_000 },
  { mint: '61V8vBaqAGMpgDQi4JcAwo1dmBGHsyhzodcPqnEVpump', symbol: 'ARC', name: 'AI Rig Complex', decimals: 6, priceUsd: 0.048, marketCapUsd: 48_000_000 },
  { mint: '74SBV4zDXxTRgv1pEMoECskKBkZHc2yGPnc7GYVepump', symbol: 'SWARMS', name: 'swarms', decimals: 6, priceUsd: 0.027, marketCapUsd: 27_000_000 },
  { mint: 'Dfh5DzRgSvvCFDoYc2ciTkMrbDfRKybA4SoFbPmApump', symbol: 'PIPPIN', name: 'pippin', decimals: 6, priceUsd: 0.033, marketCapUsd: 33_000_000 },
  { mint: 'HNg5PYJmtqcmzXrv6S9zP1CDKk5BgDuyFBxbvNApump', symbol: 'ALCH', name: 'Alchemist AI', decimals: 6, priceUsd: 0.064, marketCapUsd: 64_000_000 },
  { mint: 'CBdCxKo9QavR9hfShgpEBG3zekorAeD7W1jfq2o3pump', symbol: 'LUCE', name: 'Luce', decimals: 6, priceUsd: 0.022, marketCapUsd: 22_000_000 },
];
