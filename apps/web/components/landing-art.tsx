/**
 * Drawings and small product previews for the landing page. Decorative: each sits next to text
 * that says the same thing, so they're hidden from screen readers.
 */

const INK = '#2a2a33';
const LINE = '#b9bbd0';

function Glow({ cx, cy, id }: { cx: number; cy: number; id: string }) {
  return (
    <>
      <defs>
        <radialGradient id={id}>
          <stop offset="0%" stopColor="#5b5bd6" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#5b5bd6" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx={cx} cy={cy} r="26" fill={`url(#${id})`} />
      <circle cx={cx} cy={cy} r="6" fill="#5b5bd6" />
    </>
  );
}

function Person({ x, y, paid }: { x: number; y: number; paid: boolean }) {
  return (
    <g>
      <circle cx={x} cy={y} r="17" fill="#fff" stroke={INK} strokeWidth="1.4" />
      <circle cx={x} cy={y - 4} r="5" fill="none" stroke={INK} strokeWidth="1.4" />
      <path d={`M${x - 9} ${y + 10}c1.5-5 5-7.5 9-7.5s7.5 2.5 9 7.5`} fill="none" stroke={INK} strokeWidth="1.4" />
      {paid ? (
        <g>
          <circle cx={x + 13} cy={y - 12} r="7" fill="#5b5bd6" />
          <path d={`M${x + 10} ${y - 12}l2 2 4-4`} fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      ) : (
        <circle cx={x + 13} cy={y - 12} r="6" fill="#fff" stroke={LINE} strokeWidth="1.4" strokeDasharray="2 2" />
      )}
    </g>
  );
}

/** A confidential treasury being filled. */
export function FundArt() {
  return (
    <svg viewBox="0 0 400 300" aria-hidden className="h-full w-full">
      <ellipse cx="205" cy="256" rx="150" ry="12" fill="#e4e4ee" />
      <path d="M58 214Q190 30 344 140" fill="none" stroke={LINE} strokeWidth="1.5" strokeDasharray="3 6" />
      <Glow cx={128} cy={104} id="glow-fund" />
      {/* Vault */}
      <rect x="176" y="126" width="128" height="116" rx="16" fill="#ececf4" />
      <rect x="162" y="138" width="128" height="116" rx="16" fill="#fff" stroke={INK} strokeWidth="1.5" />
      <rect x="208" y="150" width="36" height="5" rx="2.5" fill={INK} />
      <circle cx="226" cy="200" r="24" fill="none" stroke={INK} strokeWidth="1.5" />
      <circle cx="226" cy="200" r="15" fill="#f6f6f9" stroke={INK} strokeWidth="1.2" />
      <path d="M226 186v6M226 208v6M212 200h6M234 200h6" stroke={INK} strokeWidth="1.4" strokeLinecap="round" />
      <rect x="220" y="194" width="12" height="11" rx="2.5" fill="#5b5bd6" />
      <path d="M222.5 194v-2.5a3.5 3.5 0 0 1 7 0v2.5" fill="none" stroke="#5b5bd6" strokeWidth="1.6" />
      {/* Coins */}
      {[0, 1, 2, 3].map(i => (
        <g key={i}>
          <path d={`M78 ${238 - i * 13}v8c0 5 12.5 9 28 9s28-4 28-9v-8`} fill="#fff" stroke={INK} strokeWidth="1.4" />
          <ellipse cx="106" cy={238 - i * 13} rx="28" ry="9" fill="#fff" stroke={INK} strokeWidth="1.4" />
        </g>
      ))}
      <ellipse cx="106" cy="199" rx="14" ry="4" fill="none" stroke={LINE} strokeWidth="1.2" />
      {/* A coin dropping into the slot */}
      <g transform="rotate(-18 226 112)">
        <ellipse cx="226" cy="112" rx="16" ry="16" fill="#fff" stroke={INK} strokeWidth="1.4" />
        <ellipse cx="226" cy="112" rx="9" ry="9" fill="none" stroke={LINE} strokeWidth="1.2" />
      </g>
      <path d="M226 132v8" stroke={LINE} strokeWidth="1.4" strokeDasharray="2 3" />
    </svg>
  );
}

/** One approval fanning out to the whole team. */
export function ApproveArt() {
  const people: Array<[number, number, boolean]> = [
    [70, 96, true],
    [58, 182, true],
    [118, 250, true],
    [330, 92, true],
    [346, 176, false],
    [288, 248, false],
  ];
  return (
    <svg viewBox="0 0 400 300" aria-hidden className="h-full w-full">
      <ellipse cx="200" cy="268" rx="150" ry="10" fill="#e4e4ee" />
      {people.map(([x, y, paid]) => (
        <path key={`${x}-${y}`} d={`M200 160L${x} ${y}`} stroke={paid ? '#8e90e8' : LINE} strokeWidth="1.4" strokeDasharray="3 5" />
      ))}
      <Glow cx={200} cy={52} id="glow-approve" />
      <rect x="150" y="104" width="112" height="124" rx="14" fill="#ececf4" />
      <rect x="140" y="96" width="112" height="124" rx="14" fill="#fff" stroke={INK} strokeWidth="1.5" />
      <rect x="156" y="114" width="52" height="6" rx="3" fill={INK} />
      {[132, 146, 160].map(y => (
        <g key={y}>
          <rect x="156" y={y} width="44" height="5" rx="2.5" fill="#dcdce6" />
          <rect x="212" y={y} width="24" height="5" rx="2.5" fill="#c3c5fa" />
        </g>
      ))}
      <path d="M158 196c6-10 10-10 12-2s5 8 10-1 9-6 11 1 6 5 12-3 8-4 12 2" fill="none" stroke="#5b5bd6" strokeWidth="2" strokeLinecap="round" />
      <path d="M156 206h80" stroke={LINE} strokeWidth="1.2" />
      {people.map(([x, y, paid]) => (
        <Person key={`p-${x}-${y}`} x={x} y={y} paid={paid} />
      ))}
    </svg>
  );
}

/** Ciphertext turning into a number, in the employee's own browser. */
export function DecryptArt() {
  const chips: Array<[number, number, string, number]> = [
    [34, 92, '9f3a', 0.55],
    [70, 148, 'c21e', 0.8],
    [40, 206, '07b4', 0.65],
  ];
  return (
    <svg viewBox="0 0 400 300" aria-hidden className="h-full w-full">
      <ellipse cx="236" cy="270" rx="130" ry="10" fill="#e4e4ee" />
      <Glow cx={344} cy={66} id="glow-decrypt" />
      <path d="M118 112C150 130 160 146 176 150M136 160h40M118 214C150 196 160 170 176 168" fill="none" stroke={LINE} strokeWidth="1.4" strokeDasharray="3 5" />
      {chips.map(([x, y, text, opacity]) => (
        <g key={text} opacity={opacity}>
          <rect x={x} y={y - 15} width="70" height="28" rx="8" fill="#fff" stroke={LINE} strokeWidth="1.2" />
          <text x={x + 35} y={y + 4} textAnchor="middle" fontSize="13" fill={INK} style={{ fontFamily: 'var(--font-geist-mono), monospace' }}>
            {text}
          </text>
        </g>
      ))}
      {/* The employee's browser */}
      <rect x="190" y="58" width="150" height="196" rx="20" fill="#ececf4" />
      <rect x="180" y="50" width="150" height="196" rx="20" fill="#fff" stroke={INK} strokeWidth="1.5" />
      <circle cx="198" cy="68" r="3" fill="#dcdce6" />
      <circle cx="208" cy="68" r="3" fill="#dcdce6" />
      <circle cx="218" cy="68" r="3" fill="#dcdce6" />
      <path d="M180 82h150" stroke="#ececf4" strokeWidth="1.4" />
      <rect x="196" y="100" width="54" height="6" rx="3" fill="#dcdce6" />
      <text x="196" y="146" fontSize="30" fontWeight="600" fill={INK} letterSpacing="-1.2" style={{ fontFamily: 'var(--font-geist), sans-serif' }}>
        4,200
      </text>
      <text x="196" y="166" fontSize="12" fill="#676a80" style={{ fontFamily: 'var(--font-geist), sans-serif' }}>
        sUSD · yours only
      </text>
      <rect x="196" y="188" width="118" height="34" rx="17" fill={INK} />
      <text x="255" y="210" textAnchor="middle" fontSize="12.5" fontWeight="500" fill="#fff" style={{ fontFamily: 'var(--font-geist), sans-serif' }}>
        Collect pay
      </text>
      {/* Key */}
      <g transform="translate(150 236) rotate(-30)">
        <circle cx="0" cy="0" r="10" fill="#fff" stroke={INK} strokeWidth="1.5" />
        <circle cx="0" cy="0" r="3.5" fill="#5b5bd6" />
        <path d="M10 0h22M26 0v6M31 0v5" fill="none" stroke={INK} strokeWidth="1.5" strokeLinecap="round" />
      </g>
    </svg>
  );
}

/** Small, static previews of each role's page, with the seeded demo's numbers. */
export function AdminPreview() {
  return (
    <div aria-hidden className="w-full max-w-[19rem] rounded-2xl bg-white p-4 text-left shadow-[0_20px_40px_-20px_rgba(30,30,70,0.35)]">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold tracking-tight">October payroll</span>
        <span className="rounded-full bg-ok-soft px-2 py-0.5 text-[11px] font-medium text-ok">Completed</span>
      </div>
      <div className="mt-3 flex items-baseline justify-between text-xs text-muted">
        <span>10 of 10 paid</span>
        <span className="font-mono text-ink">50,600.00 sUSD</span>
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-accent" />
      <div className="mt-3 grid gap-1.5">
        {[
          ['Arjun Mehta', '5,100.00'],
          ['Sara Lindqvist', '6,300.00'],
          ['Kwame Mensah', '4,800.00'],
        ].map(([name, amount]) => (
          <div key={name} className="flex justify-between text-xs">
            <span>{name}</span>
            <span className="font-mono text-muted">{amount}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function EmployeePreview() {
  return (
    <div aria-hidden className="w-full max-w-[17rem] rounded-2xl bg-white p-4 text-left shadow-[0_20px_40px_-20px_rgba(30,30,70,0.35)]">
      <span className="text-xs text-muted">New pay</span>
      <div className="mt-1 text-2xl font-semibold tracking-tight">
        4,200.00 <span className="text-sm font-normal text-muted">sUSD</span>
      </div>
      <div className="mt-1 text-xs text-muted">Only you can see this</div>
      <div className="mt-4 flex items-center justify-between">
        <span className="rounded-full bg-ink px-3.5 py-1.5 text-xs font-medium text-white">Collect pay</span>
        <span className="text-[11px] text-muted">0 SOL in fees</span>
      </div>
    </div>
  );
}

export function AccountantPreview() {
  return (
    <div aria-hidden className="w-full max-w-[19rem] rounded-2xl bg-white p-4 text-left shadow-[0_20px_40px_-20px_rgba(30,30,70,0.35)]">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold tracking-tight">Payments</span>
        <span className="rounded-full border border-line px-2.5 py-0.5 text-[11px] font-medium">Export CSV</span>
      </div>
      <div className="mt-3 grid gap-1.5">
        {[
          ['Diego Alvarez', '3,600.00'],
          ['Neha Iyer', '5,400.00'],
          ['Tom Becker', '4,500.00'],
          ['Aisha Rahman', '3,900.00'],
        ].map(([name, amount]) => (
          <div key={name} className="flex justify-between text-xs">
            <span>{name}</span>
            <span className="font-mono text-muted">{amount}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 border-t border-line pt-2 text-right text-xs">
        Total <span className="font-mono">92,800.00 sUSD</span>
      </div>
    </div>
  );
}
