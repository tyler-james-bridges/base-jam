import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "BASE JAM — Play the chain";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const rails = [
  { name: "DRUMS", color: "#181818" },
  { name: "BASS", color: "#b6d81d" },
  { name: "SYNTH", color: "#1456f0" },
  { name: "FX", color: "#8f62d8" },
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
              JAM
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
              THE CHAIN.
            </div>
          </div>
          <div style={{ display: "flex", fontSize: 20 }}>
            Real Base transactions. One shared live rhythm chart.
          </div>
        </div>
        <div
          style={{
            display: "flex",
            width: 470,
            height: 470,
            marginLeft: "auto",
            alignSelf: "center",
            border: "3px solid #181818",
            background: "#efe7cf",
            boxShadow: "14px 14px 0 #181818",
            flexDirection: "column",
            justifyContent: "center",
            padding: "28px 20px",
          }}
        >
          {rails.map((rail, lane) => (
            <div
              key={rail.name}
              style={{
                display: "flex",
                position: "relative",
                width: "100%",
                height: 84,
                alignItems: "center",
              }}
            >
              <div
                style={{
                  display: "flex",
                  width: 82,
                  height: 46,
                  alignItems: "center",
                  justifyContent: "center",
                  border: "2px solid #181818",
                  background: rail.color,
                  color: lane === 1 ? "#181818" : "#f4eedb",
                  fontSize: 12,
                  fontWeight: 800,
                }}
              >
                {rail.name}
              </div>
              <div
                style={{
                  display: "flex",
                  position: "relative",
                  width: 318,
                  height: 44,
                  marginLeft: -2,
                  alignItems: "center",
                  border: `2px solid ${rail.color}`,
                  background: "#f4eedb",
                }}
              >
                {[0, 1, 2, 3].map((note) => (
                  <div
                    key={note}
                    style={{
                      display: "flex",
                      position: "absolute",
                      left: 34 + ((note * 67 + lane * 29) % 250),
                      width: note % 2 === 0 ? 25 : 18,
                      height: note % 2 === 0 ? 25 : 18,
                      border: "2px solid #181818",
                      background: rail.color,
                      transform: note % 2 === 0 ? "rotate(-4deg)" : "rotate(5deg)",
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
