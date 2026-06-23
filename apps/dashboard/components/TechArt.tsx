"use client";

/** Arte padrao de PC/tecnologia usada como capa dos cards da frota. */
export default function TechArt({ online }: { online: boolean }) {
  const c = online ? "#84e62b" : "#4b5563";
  const c2 = online ? "#22d3ee" : "#374151";
  const glow = online ? 0.22 : 0.06;

  return (
    <svg viewBox="0 0 200 250" className="w-full h-full" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id="ta-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#11161f" />
          <stop offset="1" stopColor="#0a0d14" />
        </linearGradient>
        <linearGradient id="ta-scr" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={c} stopOpacity="0.9" />
          <stop offset="1" stopColor={c2} stopOpacity="0.7" />
        </linearGradient>
        <radialGradient id="ta-glow" cx="0.5" cy="0.42" r="0.6">
          <stop offset="0" stopColor={c} stopOpacity={glow} />
          <stop offset="1" stopColor={c} stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect width="200" height="250" fill="url(#ta-bg)" />
      <rect width="200" height="250" fill="url(#ta-glow)" />

      {/* grade sutil */}
      <g stroke={c} strokeOpacity={online ? 0.07 : 0.04} strokeWidth="1">
        {[40, 80, 120, 160].map((x) => (
          <line key={x} x1={x} y1="0" x2={x} y2="250" />
        ))}
        {[50, 100, 150, 200].map((y) => (
          <line key={y} x1="0" y1={y} x2="200" y2={y} />
        ))}
      </g>

      {/* nodes de circuito */}
      <g fill={c} fillOpacity={online ? 0.5 : 0.2}>
        <circle cx="28" cy="40" r="2.5" />
        <circle cx="172" cy="60" r="2.5" />
        <circle cx="36" cy="200" r="2.5" />
        <circle cx="166" cy="190" r="2.5" />
      </g>
      <g stroke={c} strokeOpacity={online ? 0.25 : 0.1} strokeWidth="1.2" fill="none">
        <path d="M28 40 H60 V70" />
        <path d="M172 60 H140" />
        <path d="M36 200 V170 H70" />
        <path d="M166 190 H130 V165" />
      </g>

      {/* monitor */}
      <g transform="translate(100 110)">
        <rect x="-52" y="-38" width="104" height="74" rx="7" fill="#0d1117" stroke={c} strokeOpacity="0.55" strokeWidth="2" />
        <rect x="-45" y="-31" width="90" height="60" rx="3" fill="url(#ta-scr)" opacity={online ? 0.92 : 0.5} />
        {/* janelas abstratas na tela */}
        <g fill="#0a0d14" fillOpacity="0.55">
          <rect x="-39" y="-25" width="34" height="22" rx="2" />
          <rect x="2" y="-25" width="38" height="10" rx="2" />
          <rect x="2" y="-11" width="38" height="11" rx="2" />
          <rect x="-39" y="3" width="79" height="20" rx="2" />
        </g>
        <g fill={c} fillOpacity="0.8">
          <rect x="-35" y="-21" width="20" height="3" rx="1.5" />
          <rect x="-35" y="7" width="46" height="3" rx="1.5" />
          <rect x="-35" y="14" width="30" height="3" rx="1.5" />
        </g>
        {/* base */}
        <rect x="-8" y="36" width="16" height="12" fill="#0d1117" stroke={c} strokeOpacity="0.4" strokeWidth="1.5" />
        <rect x="-26" y="48" width="52" height="6" rx="3" fill="#0d1117" stroke={c} strokeOpacity="0.4" strokeWidth="1.5" />
      </g>
    </svg>
  );
}
