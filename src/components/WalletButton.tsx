"use client";

import { useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";

function shortAddress(address: string) {
  return `${address.slice(0, 5)}…${address.slice(-4)}`;
}

export function WalletButton({ compact = false }: { compact?: boolean }) {
  const { address, isConnected, chain } = useAccount();
  const { connect, connectors, error, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);

  if (isConnected && address) {
    return (
      <button
        className="wallet-button wallet-button--connected"
        onClick={() => disconnect()}
        title="Disconnect wallet"
        type="button"
      >
        <span className="status-dot" />
        {compact ? shortAddress(address) : `${shortAddress(address)} · ${chain?.name ?? "Base"}`}
      </button>
    );
  }

  return (
    <div className="wallet-wrap">
      <button
        aria-expanded={open}
        className="wallet-button"
        disabled={isPending}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        {isPending ? "Opening…" : "Connect"}
      </button>
      {open && (
        <div className="wallet-menu">
          <p>Optional. Play first, connect when you want an identity.</p>
          {connectors.slice(0, 2).map((connector) => (
            <button
              disabled={isPending}
              key={connector.uid}
              onClick={() => {
                connect({ connector });
                setOpen(false);
              }}
              type="button"
            >
              {connector.name}
            </button>
          ))}
          {error && <span>{error.message}</span>}
        </div>
      )}
    </div>
  );
}
