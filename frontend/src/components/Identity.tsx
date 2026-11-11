export function EyeMark() {
  return <svg width="26" height="25" viewBox="0 0 26 25" fill="none" aria-hidden="true">
    <path d="M1 12 Q13 -1 25 12 Q13 25 1 12 M13 7 A5 5 0 1 1 12.9 7" stroke="currentColor" strokeWidth="1.5" />
  </svg>;
}

// Mesma geometria da OverviewView Avalonia; ilustração estática em repouso.
export function Orbit() {
  return <svg className="orbit" viewBox="0 0 220 220" fill="none" role="img" aria-label="Olho orbital do Hórus">
    <circle className="orbit-outer" cx="110" cy="110" r="92" />
    <circle className="orbit-inner" cx="110" cy="110" r="70" />
    <g className="orbit-rings">
      <ellipse cx="110" cy="110" rx="98" ry="38" transform="rotate(35 110 110)" />
      <ellipse cx="110" cy="110" rx="98" ry="38" transform="rotate(-35 110 110)" />
      <circle cx="110" cy="18" r="4" fill="currentColor" stroke="none" />
    </g>
    <path className="orbit-eye" d="M60 110 Q110 65 160 110 Q110 155 60 110 M110 94 A16 16 0 1 1 109.9 94 M110 126 L97 154 L119 143" />
  </svg>;
}
