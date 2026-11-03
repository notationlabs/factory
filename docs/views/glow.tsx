import { useId, type ReactNode } from "react";

// A deterministic generator, so the server and the client draw the same rays.
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const width = 1000;
const height = 640;

type Ray = { points: string; color: string; opacity: number };

function rays(seed: number, focus: [number, number], count: number): Ray[] {
  const next = random(seed);
  const colors = ["#ffe6b3", "#ffb36b", "#ffffff", "#ff8a5c"];
  return Array.from({ length: count }, () => {
    const angle = next() * Math.PI * 2;
    const spread = 0.0015 + next() * next() * 0.012;
    const start = 60 + next() * 140;
    const length = 500 + next() * 700;
    const point = (a: number, r: number) =>
      `${focus[0] + Math.cos(a) * r},${focus[1] + Math.sin(a) * r}`;
    return {
      points: [
        point(angle, start),
        point(angle - spread, length),
        point(angle + spread, length),
      ].join(" "),
      color: colors[Math.floor(next() * colors.length)],
      opacity: 0.15 + next() * 0.55,
    };
  });
}

// A panel lit from one point, with rays of light leaving it and a layer of
// grain over the top. `focus` places the light source as a fraction of the
// panel's width and height, and may sit outside the panel.
export function Glow({
  focus = [0.5, 0.5],
  seed = 7,
  className = "",
  children,
}: {
  focus?: [number, number];
  seed?: number;
  className?: string;
  children?: ReactNode;
}) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const centre: [number, number] = [focus[0] * width, focus[1] * height];
  return (
    <div className={`relative isolate overflow-hidden bg-[#3a0b03] ${className}`}>
      <svg
        className="absolute inset-0 -z-10 w-full h-full"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid slice"
        aria-hidden
      >
        <defs>
          <radialGradient
            id={`${id}-light`}
            gradientUnits="userSpaceOnUse"
            cx={centre[0]}
            cy={centre[1]}
            r={760}
          >
            <stop offset="0" stopColor="#fff4dc" />
            <stop offset="0.12" stopColor="#ffc078" />
            <stop offset="0.32" stopColor="#fe5537" />
            <stop offset="0.62" stopColor="#a3200b" />
            <stop offset="1" stopColor="#2a0802" />
          </radialGradient>
          <filter id={`${id}-soft`}>
            <feGaussianBlur stdDeviation="1.6" />
          </filter>
          <filter id={`${id}-grain`} x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
            <feColorMatrix type="saturate" values="0" />
          </filter>
        </defs>
        <rect width={width} height={height} fill={`url(#${id}-light)`} />
        <g filter={`url(#${id}-soft)`} style={{ mixBlendMode: "screen" }}>
          {rays(seed, centre, 170).map((ray, index) => (
            <polygon key={index} points={ray.points} fill={ray.color} opacity={ray.opacity} />
          ))}
        </g>
        <rect
          width={width}
          height={height}
          filter={`url(#${id}-grain)`}
          opacity="0.7"
          style={{ mixBlendMode: "overlay" }}
        />
      </svg>
      {children}
    </div>
  );
}
