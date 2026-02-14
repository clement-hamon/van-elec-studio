import type { Config } from "jest";

const config: Config = {
  testEnvironment: "node",
  testMatch: ["**/tests/**/*.test.ts"],
  transform: {
    "^.+\\.(ts|tsx)$": ["ts-jest", { useESM: true }]
  },
  extensionsToTreatAsEsm: [".ts"]
};

export default config;
