import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "BASE JAM — Pack a real Base block";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const colors = [
  "#1456f0",
  "#1456f0",
  "#ff5b45",
  "#181818",
  "#b6d81d",
  "#1456f0",
  "#8f62d8",
  "#181818",
];

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "#f4eedb",
          color: "#181818",
          padding: "54px 60px",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            width: "54%",
            flexDirection: "column",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 24,
              fontWeight: 800,
              letterSpacing: "-1px",
            }}
          >
            BASE JAM <span style={{ color: "#1456f0", marginLeft: 10 }}>/ 8453</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                display: "flex",
                color: "#1456f0",
                fontSize: 100,
                fontWeight: 900,
                letterSpacing: "-8px",
                lineHeight: 0.82,
              }}
            >
              BASE JAM
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 100,
                fontWeight: 900,
                letterSpacing: "-8px",
                lineHeight: 0.82,
              }}
            >
              THE BLOCK.
            </div>
          </div>
          <div style={{ display: "flex", fontSize: 20 }}>
            Real Base transactions. One shared packing challenge.
          </div>
        </div>
        <div
          style={{
            display: "flex",
            width: 470,
            height: 470,
            marginLeft: "auto",
            alignSelf: "center",
            flexWrap: "wrap",
            border: "3px solid #181818",
            background: "#efe7cf",
            boxShadow: "14px 14px 0 #181818",
            padding: 12,
          }}
        >
          {Array.from({ length: 64 }, (_, index) => (
            <div
              key={index}
              style={{
                display: "flex",
                width: "12.5%",
                height: "12.5%",
                border: "3px solid #efe7cf",
                borderRadius: 7,
                background:
                  index % 9 === 0 || index % 13 === 0
                    ? "#efe7cf"
                    : colors[(index * 7 + Math.floor(index / 8)) % colors.length],
              }}
            />
          ))}
        </div>
      </div>
    ),
    size,
  );
}
