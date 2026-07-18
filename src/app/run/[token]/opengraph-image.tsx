import { ImageResponse } from "next/og";
import {
  shareRunPayloadSchema,
  verifyCompact,
  type ParsedShareRun,
} from "@/lib/server";

export const runtime = "nodejs";
export const alt = "A verified Base Jam block challenge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

interface ImageProps {
  params: Promise<{ token: string }>;
}

function decodeRun(token: string): ParsedShareRun | null {
  try {
    return verifyCompact(decodeURIComponent(token), shareRunPayloadSchema);
  } catch {
    return null;
  }
}

export default async function RunImage({ params }: ImageProps) {
  const { token } = await params;
  const run = decodeRun(token);
  const palette = ["#1456f0", "#ff5b45", "#b6d81d", "#181818", "#8f62d8"];

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          background: "#f4eedb",
          color: "#181818",
          padding: 50,
          fontFamily: "Arial, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            width: "55%",
            flexDirection: "column",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", fontSize: 24, fontWeight: 800 }}>
            BASE JAM <span style={{ color: "#1456f0", marginLeft: 10 }}>/ 8453</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                display: "flex",
                color: "#1456f0",
                fontSize: 104,
                fontWeight: 900,
                letterSpacing: "-8px",
                lineHeight: 0.82,
              }}
            >
              {run ? `${run.packedPercentage}%` : "INVALID"}
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 70,
                fontWeight: 900,
                letterSpacing: "-6px",
              }}
            >
              {run ? "BEAT THIS JAM." : "PLATE."}
            </div>
          </div>
          <div style={{ display: "flex", fontSize: 18 }}>
            {run
              ? `Verified replay · Base block ${run.levelNumber} · Grade ${run.sealGrade}`
              : "This challenge could not be verified."}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            width: 470,
            height: 470,
            alignSelf: "center",
            marginLeft: "auto",
            flexWrap: "wrap",
            border: "3px solid #181818",
            background: "#efe7cf",
            boxShadow: "14px 14px 0 #1456f0",
            padding: 12,
          }}
        >
          {(run?.board ?? "-".repeat(100)).split("").map((cell, index) => {
            const pieceIndex = cell === "-" ? -1 : Number.parseInt(cell, 36);
            const colorIndex =
              pieceIndex >= 0 ? Number(run?.colors[pieceIndex] ?? "3") : -1;
            return (
              <div
                key={index}
                style={{
                  display: "flex",
                  width: "10%",
                  height: "10%",
                  border: "2px solid #efe7cf",
                  borderRadius: 4,
                  background:
                    colorIndex >= 0 ? palette[colorIndex] : "transparent",
                }}
              />
            );
          })}
        </div>
      </div>
    ),
    size,
  );
}
