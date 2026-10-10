import { Eye, EyeOff } from 'lucide-react';

export const PANELS = {
  filters: 'Filters',
  list: 'Event list',
  side: 'Side panel',
  strip: 'Recently updated',
  legend: 'Legend',
} as const;
export type PanelId = keyof typeof PANELS;

/** Hide control that sits on the panel it affects. */
export function HidePanel({ label, onHide }: { label: string; onHide: () => void }) {
  return (
    <button type="button" className="hide-panel" onClick={onHide} aria-label={`Hide ${label}`}>
      <EyeOff size={14} aria-hidden="true" />
    </button>
  );
}

/** Shown only after a panel is hidden, so it can be brought back without a header menu. */
export function HiddenDock({ hidden, onShow }: { hidden: Set<PanelId>; onShow: (id: PanelId) => void }) {
  if (hidden.size === 0) return null;
  return (
    <div className="hidden-dock" aria-label="Hidden panels">
      {(Object.keys(PANELS) as PanelId[]).filter((id) => hidden.has(id)).map((id) => (
        <button type="button" key={id} className="hidden-chip" onClick={() => onShow(id)}>
          <Eye size={12} aria-hidden="true" /> Show {PANELS[id].toLowerCase()}
        </button>
      ))}
    </div>
  );
}
