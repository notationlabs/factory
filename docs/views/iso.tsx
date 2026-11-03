import { useId, type ReactNode } from "react";

const C = Math.cos(Math.PI / 6);

// Maps plan coordinates onto the isometric ground plane. Anything drawn
// inside it lies flat, with plan x running down to the right and plan y
// running down to the left.
const flat = `matrix(${C} 0.5 ${-C} 0.5 0 0)`;

function project(x: number, y: number, z = 0): [number, number] {
  return [C * (x - y), 0.5 * (x + y) - z];
}

function useSvgId() {
  return useId().replace(/[^a-zA-Z0-9]/g, "");
}

const tones = {
  accent: ["#5c1004", "#c52a10", "#fe5537", "#ffb36b", "#fe5537", "#ff8a5c", "#a3200b", "#4a0d03"],
  grey: ["#1c1c1f", "#3f3f45", "#7a7a82", "#3a3a40", "#9a9aa2", "#2e2e33", "#1c1c1f"],
};

type Tone = keyof typeof tones;

// A rounded slab `w` by `d` in plan and `h` deep, with its top face at (x, y).
// The sides are the face repeated down one pixel at a time, filled with a
// gradient across the slab's width. `children` are drawn flat on the top
// face in plan coordinates centred on the slab. `label` is set on the
// front-left side.
export function Slab({
  x,
  y,
  w,
  d = w,
  h = 16,
  r = 18,
  tone = "accent",
  outline,
  label,
  children,
}: {
  x: number;
  y: number;
  w: number;
  d?: number;
  h?: number;
  r?: number;
  tone?: Tone;
  outline?: boolean;
  label?: string;
  children?: ReactNode;
}) {
  const id = useSvgId();
  const half = (C * (w + d)) / 2;
  const stops = tones[tone];
  const corner = project(-w / 2, d / 2);
  return (
    <g transform={`translate(${x} ${y})`}>
      <defs>
        <rect id={`${id}-face`} x={-w / 2} y={-d / 2} width={w} height={d} rx={r} />
        <linearGradient id={`${id}-side`} gradientUnits="userSpaceOnUse" x1={-half} x2={half} y1="0" y2="0">
          {stops.map((color, index) => (
            <stop key={index} offset={index / (stops.length - 1)} stopColor={color} />
          ))}
        </linearGradient>
      </defs>
      {Array.from({ length: h }, (_, index) => (
        <use
          key={index}
          href={`#${id}-face`}
          transform={`translate(0 ${h - index}) ${flat}`}
          fill={`url(#${id}-side)`}
        />
      ))}
      {label && (
        <g transform={`matrix(${C} 0.5 0 1 ${corner[0]} ${corner[1]})`}>
          <text
            x={w / 2}
            y={h / 2 + 4}
            textAnchor="middle"
            className="font-sans font-black fill-white/85"
            fontSize={Math.min(13, h * 0.75)}
            letterSpacing="0.04em"
          >
            {label}
          </text>
        </g>
      )}
      <use
        href={`#${id}-face`}
        transform={flat}
        className={`fill-[var(--iso-top)] ${outline ? "stroke-accent" : "stroke-[var(--iso-line)]"}`}
        strokeWidth={outline ? 1.5 : 1}
        vectorEffect="non-scaling-stroke"
      />
      <g transform={flat}>{children}</g>
    </g>
  );
}

// The outline of a box `w` by `d` in plan and `height` tall, standing on
// (x, y). Only its edges are drawn, dashed, with the hidden back edge fainter.
export function Wireframe({
  x,
  y,
  w,
  d = w,
  height,
  r = 18,
  children,
}: {
  x: number;
  y: number;
  w: number;
  d?: number;
  height: number;
  r?: number;
  children?: ReactNode;
}) {
  const k = r * (1 - Math.SQRT1_2);
  const left = project(-w / 2 + k, d / 2 - k);
  const right = project(w / 2 - k, -d / 2 + k);
  const front = project(w / 2 - k, d / 2 - k);
  const back = project(-w / 2 + k, -d / 2 + k);
  const face = (z: number) => (
    <rect
      x={-w / 2}
      y={-d / 2}
      width={w}
      height={d}
      rx={r}
      transform={`translate(0 ${-z}) ${flat}`}
      vectorEffect="non-scaling-stroke"
    />
  );
  const edge = ([ex, ey]: [number, number], faint?: boolean) => (
    <line x1={ex} y1={ey} x2={ex} y2={ey - height} opacity={faint ? 0.45 : 1} />
  );
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className="stroke-[var(--iso-wire)]" fill="none" strokeDasharray="4 4" strokeWidth="1">
        {face(0)}
        {edge(back, true)}
        {edge(left)}
        {edge(right)}
        {edge(front)}
      </g>
      {children}
      <g className="stroke-[var(--iso-wire)] fill-[var(--iso-glass)]" strokeDasharray="4 4" strokeWidth="1">
        {face(height)}
      </g>
    </g>
  );
}

// Line glyphs on a 24-unit grid, stroked.
const glyphs = {
  agent: "M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4",
  hub: "M12 9a3 3 0 1 1 0 6 3 3 0 1 1 0-6M12 3v6M12 15v6M3 12h6M15 12h6",
  slack: "M9.5 4 7.5 20M16.5 4l-2 16M4.5 9h16M3.5 15h16",
  container: "M12 3 20 7.5v9L12 21l-8-4.5v-9zM4 7.5 12 12l8-4.5M12 12v9",
  terminal: "m4.5 7 5 5-5 5M12 17.5h7.5",
  cloud: "M7 18.5a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5a4.5 4.5 0 0 1-.5 9z",
  rails: "M7 3 4 21M17 3l3 18M6 8h12M5.3 13h13.4M4.6 18h14.8",
  key: "M14.5 4a5.5 5.5 0 1 1-4.9 8L4 17.6V20h3v-2h2v-2h2l1.1-1.1A5.5 5.5 0 0 1 14.5 4zM16 8.2v.1",
};

// GitHub's mark is filled, on a 16-unit grid.
const githubMark =
  "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z";

type GlyphName = keyof typeof glyphs | "github";

// A glyph for the top face of a slab. It is turned against the plan so it
// stands upright on screen, foreshortened like the face it sits on.
function Glyph({ name, size = 30, accent }: { name: GlyphName; size?: number; accent?: boolean }) {
  return (
    <g transform={`rotate(-45) translate(${-size / 2} ${-size / 2}) scale(${size / 24})`}>
      {name === "github" ? (
        <path
          d={githubMark}
          transform="translate(2.4 2.4) scale(1.2)"
          className={accent ? "fill-accent" : "fill-[var(--iso-ink)]"}
        />
      ) : (
      <path
        d={glyphs[name]}
        fill="none"
        className={accent ? "stroke-accent" : "stroke-[var(--iso-ink)]"}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      )}
    </g>
  );
}

// Text lying flat on a face, running along its plan x edge.
function FaceText({
  x = 0,
  y = 0,
  size = 13,
  dim,
  children,
}: {
  x?: number;
  y?: number;
  size?: number;
  dim?: boolean;
  children: ReactNode;
}) {
  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      dominantBaseline="middle"
      fontSize={size}
      className={`font-mono ${dim ? "fill-[var(--iso-wire)]" : "fill-[var(--iso-ink)]"}`}
    >
      {children}
    </text>
  );
}

function Art({ viewBox, label, children }: { viewBox: string; label: string; children: ReactNode }) {
  return (
    <svg viewBox={viewBox} className="w-full h-auto overflow-visible" role="img" aria-label={label}>
      {children}
    </svg>
  );
}

// An agent floats above the container it runs in, which stands on your cloud.
export function HeroStack() {
  return (
    <Art viewBox="0 0 480 590" label="An agent above a container, standing on a cloud">
      <Wireframe x={240} y={440} w={200} height={140}>
        <Slab x={0} y={0} w={200} h={22} tone="grey" label="YOUR CLOUD">
          <Glyph name="cloud" size={54} />
        </Slab>
      </Wireframe>
      <g transform="translate(240 300)">
        <g transform={flat}>
          <FaceText x={-40} y={70} size={15} dim>
            lightbox
          </FaceText>
        </g>
      </g>
      <g className="lightbox-float">
        <Slab x={240} y={100} w={160} h={18} label="AGENT">
          <Glyph name="agent" size={48} accent />
        </Slab>
      </g>
    </Art>
  );
}

const sources = [
  { label: "issue #42", column: 0 },
  { label: "#ops", column: 1 },
  { label: "issue #57", column: 0 },
  { label: "#support", column: 1 },
  { label: "issue #61", column: 0 },
  { label: "@claude", column: 1 },
  { label: "issue #64", column: 0 },
  { label: "#releases", column: 1 },
  { label: "issue #70", column: 0 },
];

// Conversations on the left, as labels, each with a line that joins the
// others on the way to the hub on the right. Some lines carry a moving dash.
export function ChannelsGraph() {
  const hub: [number, number] = [520, 168];
  const bus = 400;
  return (
    <Art viewBox="0 0 620 340" label="Conversations on GitHub and Slack routed into the hub">
      {sources.map((source, index) => {
        const y = 28 + index * 32;
        const x = source.column === 0 ? 16 : 156;
        const width = 18 + source.label.length * 7.4;
        const bend = Math.sign(hub[1] - y) * Math.min(10, Math.abs(hub[1] - y));
        const path = [
          `M ${x + width} ${y}`,
          `H ${bus - 10 - index * 4}`,
          `q 10 0 10 ${bend}`,
          `V ${hub[1] - bend}`,
          `q 0 ${bend} 10 ${bend}`,
          `H ${hub[0] - 70}`,
        ].join(" ");
        return (
          <g key={source.label}>
            <path d={path} fill="none" className="stroke-[var(--iso-wire)]" strokeWidth="1" />
            {index % 3 === 0 && (
              <path
                d={path}
                fill="none"
                className="stroke-accent lightbox-dash"
                strokeWidth="1.5"
                strokeDasharray="14 600"
                style={{ animationDelay: `${index * 0.45}s` }}
              />
            )}
            <rect
              x={x}
              y={y - 11}
              width={width}
              height={22}
              rx={4}
              className="fill-[var(--iso-top)] stroke-accent/70"
              strokeWidth="1"
            />
            <text x={x + 9} y={y + 4} fontSize="12" className="font-mono fill-[var(--iso-ink)]">
              {source.label}
            </text>
          </g>
        );
      })}
      <Slab x={hub[0]} y={hub[1] - 16} w={88} h={14} r={14}>
        <Glyph name="hub" size={30} accent />
      </Slab>
    </Art>
  );
}

const branches = ["issue-42", "ops-1718", "issue-57"];

// Each conversation's branch as a plate stacked over the container it lives in.
export function Branches() {
  return (
    <Art viewBox="0 0 480 420" label="Three branches stacked over one container">
      <Slab x={240} y={300} w={190} h={22} tone="grey" label="DEV CONTAINER">
        <Glyph name="container" size={40} />
      </Slab>
      {branches.map((branch, index) => {
        const y = 230 - index * 64;
        const top = index === branches.length - 1;
        return (
          <g key={branch} opacity={top ? 1 : 0.85 - index * 0.1}>
            <Slab x={240} y={y} w={190} h={top ? 6 : 3} tone={top ? "accent" : "grey"} outline={top}>
              <FaceText x={-20} y={50} size={14}>
                {branch}
              </FaceText>
              <g transform="translate(-50 -40)">
                <Glyph name="agent" size={22} accent={top} />
              </g>
            </Slab>
          </g>
        );
      })}
    </Art>
  );
}

const tiles: { at: [number, number]; glyph: GlyphName }[] = [
  { at: [-1, -1], glyph: "github" },
  { at: [0, -1], glyph: "slack" },
  { at: [1, -1], glyph: "agent" },
  { at: [-1, 0], glyph: "terminal" },
  { at: [1, 0], glyph: "cloud" },
  { at: [-1, 1], glyph: "key" },
  { at: [0, 1], glyph: "container" },
  { at: [1, 1], glyph: "rails" },
];

// A grid of tiles around the hub: the platforms, runtimes and providers it
// works with. Tiles are drawn back to front so nearer ones overlap.
export function Tiles() {
  const step = 104;
  const ordered = [...tiles, { at: [0, 0] as [number, number], glyph: "hub" as GlyphName }].sort(
    (a, b) => a.at[0] + a.at[1] - (b.at[0] + b.at[1]),
  );
  return (
    <Art viewBox="0 0 560 380" label="Tiles for GitHub, Slack, Claude, Cloudflare, Railway, the terminal and the vault around the hub">
      {ordered.map((tile) => {
        const [sx, sy] = project(tile.at[0] * step, tile.at[1] * step);
        const centre = tile.glyph === "hub";
        return (
          <Slab
            key={tile.glyph}
            x={280 + sx}
            y={170 + sy}
            w={82}
            h={centre ? 16 : 12}
            r={16}
            tone={centre ? "accent" : "grey"}
          >
            <Glyph name={tile.glyph} size={30} accent={centre} />
          </Slab>
        );
      })}
    </Art>
  );
}

const outposts: { repo: string; at: [number, number] }[] = [
  { repo: "acme/api", at: [46, 254] },
  { repo: "acme/webapp", at: [190, 190] },
  { repo: "acme/docs", at: [254, 46] },
];

// The hub at the back, joined by lines across the ground to an outpost in
// each repo at the front.
export function HubAndOutposts() {
  return (
    <Art viewBox="0 0 560 420" label="One hub connected to an outpost in each of three repos">
      <g transform="translate(280 110)">
        <g transform={`translate(0 20) ${flat}`}>
          {outposts.map((outpost) => (
            <path
              key={outpost.repo}
              d={`M 0 0 L ${outpost.at[0]} ${outpost.at[1]}`}
              className="stroke-accent lightbox-march"
              strokeWidth="1.5"
              strokeDasharray="6 6"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </g>
      </g>
      <Slab x={280} y={110} w={150} h={20} label="HUB">
        <Glyph name="hub" size={46} accent />
      </Slab>
      {outposts.map((outpost) => {
        const [sx, sy] = project(...outpost.at);
        return (
          <Slab key={outpost.repo} x={280 + sx} y={110 + sy + 14} w={96} h={12} r={14} tone="grey">
            <FaceText x={0} y={22} size={11}>
              {outpost.repo}
            </FaceText>
            <g transform="translate(-14 -14)">
              <Glyph name="container" size={22} />
            </g>
          </Slab>
        );
      })}
    </Art>
  );
}
