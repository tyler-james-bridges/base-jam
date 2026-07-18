import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  shareRunPayloadSchema,
  verifyCompact,
  type ParsedShareRun,
} from "@/lib/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RunPageProps {
  params: Promise<{ token: string }>;
}

function decodeRun(token: string): ParsedShareRun | null {
  try {
    return verifyCompact(decodeURIComponent(token), shareRunPayloadSchema);
  } catch {
    return null;
  }
}

function boardColor(run: ParsedShareRun, cell: string): string {
  if (cell === "-") return "transparent";
  const pieceIndex = Number.parseInt(cell, 36);
  const paletteIndex = Number(run.colors[pieceIndex] ?? "3");
  return ["#1456f0", "#ff5b45", "#b6d81d", "#181818", "#8f62d8"][
    paletteIndex
  ];
}

export async function generateMetadata({
  params,
}: RunPageProps): Promise<Metadata> {
  const { token } = await params;
  const run = decodeRun(token);
  if (!run) {
    return {
      title: "Invalid challenge",
      robots: { index: false, follow: false },
    };
  }
  const encoded = encodeURIComponent(token);
  return {
    title: `${run.packedPercentage}% on Base block ${run.levelNumber}`,
    description: `Can you beat this verified Base Jam on Base block ${run.levelNumber}?`,
    openGraph: {
      title: `${run.packedPercentage}% Base Jam · Grade ${run.sealGrade}`,
      description: `Same Base block. Same pieces. Beat this jam.`,
      images: [`/run/${encoded}/opengraph-image`],
    },
    twitter: {
      card: "summary_large_image",
      title: `${run.packedPercentage}% Base Jam · Grade ${run.sealGrade}`,
      description: `Same Base block. Same pieces. Beat this jam.`,
      images: [`/run/${encoded}/opengraph-image`],
    },
  };
}

export default async function RunPage({ params }: RunPageProps) {
  const { token } = await params;
  const run = decodeRun(token);

  if (!run) {
    return (
      <main className="share-shell">
        <header className="share-header">
          <Link className="brand" href="/">
            <Image alt="" height={38} src="/mark.svg" width={38} />
            <span>BASE JAM</span>
            <sup>8453</sup>
          </Link>
        </header>
        <section className="error-card">
          <span className="error-code">SHARE / INVALID</span>
          <h1>THIS PLATE WON’T VERIFY.</h1>
          <p>
            The challenge link is malformed or was signed with a different
            server key. No score has been accepted.
          </p>
          <div>
            <Link className="button button--primary" href="/">
              Play a fresh block
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="share-shell">
      <header className="share-header">
        <Link className="brand" href="/">
          <Image alt="" height={38} src="/mark.svg" width={38} />
          <span>BASE JAM</span>
          <sup>8453</sup>
        </Link>
        <span className="verified-pill">✓ Server replay verified</span>
      </header>
      <section className="share-layout">
        <div className="share-copy">
          <p className="eyebrow">Challenge received / Base {run.levelNumber}</p>
          <h1>BEAT THIS JAM.</h1>
          <p>
            One player packed {run.packedPercentage}% of this exact Base block.
            You get the same transaction shapes, in the same order, for 60
            seconds.
          </p>
          <div className="result-stats">
            <div>
              <span>Grade</span>
              <strong>{run.sealGrade}</strong>
            </div>
            <div>
              <span>Packed</span>
              <strong>{run.packedPercentage}%</strong>
            </div>
            <div>
              <span>Score</span>
              <strong>{run.score.toLocaleString()}</strong>
            </div>
          </div>
          <div className="share-actions">
            <Link
              className="button button--primary"
              href={`/?block=${encodeURIComponent(run.levelNumber)}&challenge=${encodeURIComponent(run.runId)}`}
            >
              Play the same block <b>↗</b>
            </Link>
            <a
              className="button button--ink"
              href={`https://basescan.org/block/${run.levelNumber}`}
              rel="noreferrer"
              target="_blank"
            >
              Inspect Base
            </a>
          </div>
          <p className="verification-state">
            {run.ranked ? "Ranked Base source" : "Unranked practice"} ·
            fingerprint {run.fingerprint}
          </p>
        </div>
        <div className="result-card">
          <div className="result-card__top">
            <span>BASE JAM</span>
            <small>BASE / 8453</small>
          </div>
          <div className="result-mosaic">
            {run.board.split("").map((cell, index) => (
              <span
                key={index}
                style={{ background: boardColor(run, cell) }}
              />
            ))}
          </div>
          <div className="result-card__bottom">
            <strong>{run.packedPercentage}%</strong>
            <div>
              <span>BLOCK {run.levelNumber}</span>
              <small>{`${run.levelHash.slice(0, 8)}…${run.levelHash.slice(-6)}`}</small>
            </div>
            <b>{run.sealGrade}</b>
          </div>
        </div>
      </section>
    </main>
  );
}
