/* ============================================================
   Cartoon red Ford Raptor — reusable inline SVG.
   Side view, facing right. Built from simple shapes with a bold
   dark outline for a clean cartoon look. Used on the loading
   screen (doing a burnout) and on the hero (parked).
   ============================================================ */

function wheel(cx, cy, spinClass) {
  const spokes = [0, 1, 2, 3, 4]
    .map(
      (k) =>
        `<rect x="${cx - 3}" y="${cy - 26}" width="6" height="22" rx="2" fill="#3c4046" stroke="none" transform="rotate(${k * 72} ${cx} ${cy})"/>`
    )
    .join('');
  return `
    <g>
      <circle cx="${cx}" cy="${cy}" r="46" fill="#17150f" stroke="#0a0906" stroke-width="3"/>
      <circle cx="${cx}" cy="${cy}" r="35" fill="#211d15" stroke="none"/>
      <g class="raptor__wheel ${spinClass}" style="transform-box:fill-box;transform-origin:center">
        <circle cx="${cx}" cy="${cy}" r="27" fill="#6b7177" stroke="#2c2f34" stroke-width="3"/>
        ${spokes}
        <circle cx="${cx}" cy="${cy}" r="9" fill="#3c4046" stroke="#23262b" stroke-width="2"/>
        <circle cx="${cx}" cy="${cy}" r="4.5" fill="#ff7a1a" stroke="none"/>
      </g>
    </g>`;
}

export function raptorSVG({ burnout = false } = {}) {
  const motion = burnout
    ? `
    <g class="raptor__motion" stroke="none" fill="#d8c8ac">
      <rect x="20" y="150" width="30" height="5" rx="2.5"/>
      <rect x="14" y="166" width="38" height="5" rx="2.5"/>
      <rect x="24" y="182" width="26" height="5" rx="2.5"/>
    </g>`
    : '';

  return `
  <svg class="raptor ${burnout ? 'is-burnout' : ''}" viewBox="0 0 460 260"
       xmlns="http://www.w3.org/2000/svg" role="img"
       aria-label="Cartoon red Ford Raptor doing a burnout"
       stroke="#160b07" stroke-width="4" stroke-linejoin="round" stroke-linecap="round">
    <ellipse class="raptor__shadow" cx="238" cy="238" rx="166" ry="13" fill="rgba(0,0,0,0.4)" stroke="none"/>

    ${wheel(138, 198, 'raptor__wheel--rear')}
    ${wheel(340, 198, 'raptor__wheel--front')}

    <g class="raptor__body">
      <!-- lower body -->
      <path d="M76 132 Q76 119 92 119 L398 119 Q414 119 414 138 L414 160 Q414 176 396 176 L92 176 Q76 176 76 161 Z" fill="#e11d2a"/>
      <!-- lower shadow -->
      <path d="M80 159 L410 159 L410 160 Q410 176 396 176 L92 176 Q80 176 80 161 Z" fill="#a3162a" stroke="none"/>
      <!-- racing stripe -->
      <rect x="92" y="150" width="300" height="5" rx="2" fill="#ff7a1a" stroke="none" opacity="0.85"/>
      <!-- bed wall -->
      <path d="M78 120 L78 104 Q78 100 84 100 L176 100 L176 120 Z" fill="#c71a2b"/>
      <!-- cab -->
      <path d="M176 120 L194 74 Q196 70 202 70 L278 70 Q284 70 288 76 L308 120 Z" fill="#e11d2a"/>
      <!-- windows -->
      <path d="M200 113 L210 83 L250 83 L250 113 Z" fill="#1a2a36" stroke="#0e1820" stroke-width="2"/>
      <path d="M256 83 L276 83 L298 113 L256 113 Z" fill="#1a2a36" stroke="#0e1820" stroke-width="2"/>
      <path d="M203 110 L211 86 L226 86 Z" fill="#33505f" stroke="none" opacity="0.6"/>
      <!-- hood scoop -->
      <rect x="322" y="110" width="58" height="12" rx="4" fill="#c71a2b"/>
      <!-- grille -->
      <path d="M398 124 L414 130 L414 156 L398 160 Z" fill="#241712" stroke="#0a0906" stroke-width="2"/>
      <rect x="401" y="127" width="9" height="6" rx="1.5" fill="#ffae3a" stroke="none"/>
      <rect x="401" y="136" width="9" height="6" rx="1.5" fill="#ffae3a" stroke="none"/>
      <rect x="401" y="145" width="9" height="6" rx="1.5" fill="#ffae3a" stroke="none"/>
      <!-- headlight -->
      <path d="M384 118 L400 121 L400 131 L384 130 Z" fill="#ffe9b0" stroke="#0a0906" stroke-width="2"/>
      <!-- front skid -->
      <rect x="392" y="158" width="26" height="13" rx="3" fill="#14110d"/>
      <!-- door line + handle -->
      <path d="M250 120 L250 150" stroke="#0a0906" stroke-width="2" fill="none" opacity="0.5"/>
      <rect x="214" y="128" width="16" height="4" rx="2" fill="#7c0e1c" stroke="none"/>
      <!-- light bar -->
      <rect class="raptor__lightbar" x="206" y="62" width="78" height="8" rx="3" fill="#ffc24a" stroke="#0a0906" stroke-width="2"/>
      <!-- fender flares -->
      <path d="M88 178 A 52 46 0 0 1 188 178" fill="none" stroke="#14110d" stroke-width="15" stroke-linecap="round"/>
      <path d="M290 178 A 52 46 0 0 1 390 178" fill="none" stroke="#14110d" stroke-width="15" stroke-linecap="round"/>
    </g>

    ${motion}
  </svg>`;
}
