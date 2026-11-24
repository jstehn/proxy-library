"use client";
import { useId } from "react";

// A card back of our own design (design doc 08, decision 2): the real Magic card back is Wizards
// of the Coast's artwork. Styled to match the app's obsidian-and-gold spark emblem (src/app/icon.svg)
// as a scalable inline SVG so it stays crisp from grid thumbnails up to the full-size spotlight.
export function CardBack() {
  const uid = useId();
  const bgId = `${uid}-bg`;
  const goldId = `${uid}-gold`;
  const goldSoftId = `${uid}-gold-soft`;
  const glowId = `${uid}-glow`;

  return (
    <div
      aria-hidden
      className="aspect-[488/680] w-full overflow-hidden rounded-[4.5%] bg-[#09090b] shadow-md select-none"
    >
      <svg
        viewBox="0 0 488 680"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="h-full w-full"
      >
        <defs>
          <radialGradient id={bgId} cx="50%" cy="48%" r="65%">
            <stop offset="0%" stopColor="#27272a" />
            <stop offset="55%" stopColor="#141417" />
            <stop offset="100%" stopColor="#09090b" />
          </radialGradient>
          <linearGradient id={goldId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#fde68a" />
            <stop offset="45%" stopColor="#fbbf24" />
            <stop offset="100%" stopColor="#b45309" />
          </linearGradient>
          <linearGradient id={goldSoftId} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.45" />
            <stop offset="50%" stopColor="#d97706" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#fbbf24" stopOpacity="0.45" />
          </linearGradient>
          <radialGradient id={glowId} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.22" />
            <stop offset="65%" stopColor="#d97706" stopOpacity="0.06" />
            <stop offset="100%" stopColor="#09090b" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Outer black card margin + dark obsidian field */}
        <rect width="488" height="680" fill="#09090b" />
        <rect x="22" y="22" width="444" height="636" rx="18" fill={`url(#${bgId})`} />

        {/* Subtle geometric rays behind the medallion */}
        <g stroke="#fbbf24" strokeOpacity="0.08" strokeWidth="1.5">
          <line x1="244" y1="68" x2="244" y2="612" />
          <line x1="64" y1="340" x2="424" y2="340" />
          <line x1="88" y1="120" x2="400" y2="560" />
          <line x1="400" y1="120" x2="88" y2="560" />
        </g>

        {/* Outer & inner metallic gold frames */}
        <rect
          x="26"
          y="26"
          width="436"
          height="628"
          rx="16"
          stroke={`url(#${goldId})`}
          strokeWidth="4"
        />
        <rect
          x="40"
          y="40"
          width="408"
          height="600"
          rx="10"
          stroke={`url(#${goldSoftId})`}
          strokeWidth="2"
        />

        {/* Corner diamond accents */}
        <g fill={`url(#${goldId})`}>
          <path d="M58 58 L66 66 L58 74 L50 66 Z" />
          <path d="M430 58 L438 66 L430 74 L422 66 Z" />
          <path d="M58 606 L66 614 L58 622 L50 614 Z" />
          <path d="M430 606 L438 614 L430 622 L422 614 Z" />
        </g>

        {/* Ambient golden halo */}
        <ellipse cx="244" cy="340" rx="158" ry="205" fill={`url(#${glowId})`} />

        {/* Central medallion */}
        <ellipse
          cx="244"
          cy="340"
          rx="132"
          ry="184"
          fill="#0c0c0f"
          stroke={`url(#${goldId})`}
          strokeWidth="4"
        />
        <ellipse
          cx="244"
          cy="340"
          rx="116"
          ry="166"
          stroke={`url(#${goldSoftId})`}
          strokeWidth="2"
          strokeDasharray="6 6"
        />

        {/* Four-pointed spark / mana diamond (from src/app/icon.svg) */}
        <g transform="translate(244 340)">
          <path
            d="M0 -106 L28 -32 L100 0 L28 32 L0 106 L-28 32 L-100 0 L-28 -32 Z"
            fill={`url(#${goldId})`}
          />
          <path d="M0 -64 L16 -18 L60 0 L16 18 L0 64 L-16 18 L-60 0 L-16 -18 Z" fill="#18181b" />
          <path
            d="M0 -34 L9 -10 L32 0 L9 10 L0 34 L-9 10 L-32 0 L-9 -10 Z"
            fill={`url(#${goldId})`}
          />
        </g>

        {/* Top & bottom small accent pips */}
        <g fill={`url(#${goldId})`} opacity="0.85">
          <path d="M244 102 L252 116 L244 130 L236 116 Z" />
          <path d="M244 550 L252 564 L244 578 L236 564 Z" />
        </g>
      </svg>
    </div>
  );
}
