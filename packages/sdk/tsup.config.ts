import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  platform: "neutral",
  external: ["@coral-xyz/anchor", "@solana/web3.js", "@solana/spl-token", "bn.js"],
});
