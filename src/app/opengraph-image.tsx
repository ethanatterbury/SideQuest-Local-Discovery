import { ImageResponse } from "next/og";
export const alt = "SideQuest — Stop scrolling. Go somewhere.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export default function Image() {
  return new ImageResponse(
    <div
      style={{
        background: "#f6f6ef",
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        padding: 72,
        color: "#243b30",
      }}
    >
      <div style={{ fontSize: 36, fontWeight: 700 }}>sidequest.</div>
      <div
        style={{
          fontSize: 90,
          fontWeight: 700,
          letterSpacing: -4,
          marginTop: 64,
        }}
      >
        Stop scrolling.
      </div>
      <div
        style={{
          fontSize: 90,
          fontWeight: 700,
          letterSpacing: -4,
          color: "#5d7752",
        }}
      >
        Go somewhere.
      </div>
      <div style={{ display: "flex", marginTop: 30, fontSize: 26 }}>
        Your next good idea is closer than you think.
      </div>
    </div>,
    size,
  );
}
