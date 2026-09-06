/* Solar Task Tracker skin — tokens from the skin pack's design-tokens.json.
   One place for colours, radii, sizes and the shared control recipes so the
   tracker's screens (projects list, map, status sheet, modals) all draw from
   the same palette. Phase colours are semantic and must not be reused. */

export const TT = {
  orange: '#FF6B00', amber: '#FF9400', orangeDark: '#B93B00', cyan: '#00A8FF',
  canvas: '#030D18', panel: '#061525', elevated: '#0A1D30', control: '#0B2136', selectedWarm: '#492007',
  scrim: 'rgba(2,7,13,.72)',
  text: '#F5F8FC', text2: '#B9C4D3', muted: '#7F8EA3', onOrange: '#111820',
  border: '#29445F', borderStrong: '#456682', divider: '#173149',
  pile: '#D6DCE4', pileShadow: '#667280', postCap: '#008CFF', postCapHi: '#38B8FF',
  torqueTube: '#B834F5', torqueTubeHi: '#E05BFF', module: '#1ED6A3', moduleGrid: '#7BFFE0',
  success: '#31D39A', warning: '#FFB020', danger: '#FF4F4F', focus: '#6ED0FF',
  radiusSmall: 6, radiusControl: 10, radiusPanel: 14,
  touchMin: 48, toolHeight: 76,
  display: "'Barlow Condensed', 'Roboto Condensed', sans-serif",
  body: "'Barlow', Roboto, sans-serif",
};

export const GRAD_PRIMARY = `linear-gradient(180deg, ${TT.amber} 0%, ${TT.orange} 58%, #D94A00 100%)`;
export const GRAD_PANEL = `linear-gradient(180deg, ${TT.elevated} 0%, ${TT.panel} 100%)`;
export const GRAD_CONTROL = `linear-gradient(180deg, ${TT.control} 0%, ${TT.panel} 100%)`;
export const GRAD_SELECTED = 'linear-gradient(180deg, #5B2808 0%, #271509 100%)';
export const GLOW = '0 0 4px rgba(255,107,0,.65), 0 0 16px rgba(255,107,0,.25)';
export const PANEL_SHADOW = '0 5px 14px rgba(0,0,0,.56)';

/* translucent surface for controls floating over the map */
export const FLOAT = { background: 'rgba(6,21,37,.88)', border: '1px solid ' + TT.border, borderRadius: TT.radiusControl, boxShadow: PANEL_SHADOW, backdropFilter: 'blur(4px)' };

/* uppercase condensed label */
export function label(size, extra) {
  return { fontFamily: TT.display, fontWeight: 700, fontSize: size || 14, letterSpacing: '0.08em', textTransform: 'uppercase', ...extra };
}

/* segmented control container + segment */
export const SEG_WRAP = { display: 'flex', background: TT.panel, border: '1px solid ' + TT.borderStrong, borderRadius: TT.radiusControl, padding: 3, gap: 2, overflow: 'hidden' };
export function seg(active) {
  return {
    ...label(13), minHeight: 42, padding: '0 14px', border: 'none', borderRadius: TT.radiusControl - 3, cursor: 'pointer',
    color: active ? TT.onOrange : TT.text, background: active ? GRAD_PRIMARY : 'transparent', boxShadow: active ? GLOW : 'none',
    transition: 'color 160ms ease-out, background 160ms ease-out',
  };
}

/* the big field tools (brush / fill / pan / delete) */
export function tool(active) {
  return {
    minHeight: TT.toolHeight, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, padding: '6px 4px',
    borderRadius: TT.radiusSmall + 2, cursor: 'pointer',
    border: active ? '2px solid ' + TT.orange : '1px solid ' + TT.border,
    background: active ? GRAD_SELECTED : GRAD_CONTROL,
    color: active ? TT.orange : TT.text, boxShadow: active ? GLOW : 'none',
    transition: 'border-color 160ms ease-out, background 160ms ease-out',
  };
}

export const BTN_PRIMARY = { ...label(14), background: GRAD_PRIMARY, color: TT.onOrange, border: 'none', borderRadius: TT.radiusControl, padding: '13px 18px', minHeight: TT.touchMin, cursor: 'pointer', whiteSpace: 'nowrap', boxShadow: GLOW };
export const BTN_OUTLINE = { ...label(13), background: 'rgba(255,107,0,.06)', color: TT.orange, border: '1px solid ' + TT.orange, borderRadius: TT.radiusControl, padding: '11px 16px', minHeight: TT.touchMin, cursor: 'pointer', whiteSpace: 'nowrap' };
export const BTN_QUIET = { ...label(13), background: 'transparent', color: TT.text, border: '1px solid ' + TT.border, borderRadius: TT.radiusControl, padding: '11px 16px', minHeight: TT.touchMin, cursor: 'pointer', whiteSpace: 'nowrap' };

export const PANEL_STYLE = { background: GRAD_PANEL, border: '1px solid ' + TT.border, borderRadius: TT.radiusPanel, boxShadow: PANEL_SHADOW };
