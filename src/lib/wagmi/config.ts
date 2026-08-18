import { createConfig, http } from "wagmi";
import { coinbaseWallet, injected } from "wagmi/connectors";
import { baseChain } from "@/lib/base/chain";
import { BASE_DATA_SUFFIX } from "@/lib/base/builder-code";

export const wagmiConfig = createConfig({
  chains: [baseChain],
  dataSuffix: BASE_DATA_SUFFIX,
  connectors: [
    injected(),
    coinbaseWallet({
      appName: "BASE JAM",
      appLogoUrl:
        typeof window === "undefined"
          ? undefined
          : `${window.location.origin}/mark.svg`,
    }),
  ],
  transports: {
    [baseChain.id]: http(),
  },
  ssr: true,
});
