import { Marker, type Map as MapLibre } from 'maplibre-gl';
import { STATUS_META } from '../config/status-meta.ts';
import { calloutModel } from '../lib/vehicle-details-model.ts';
import {
  selectedPosition,
  type LiveTrackingState,
  type LiveTrackingStore,
} from '../store/live-tracking-store.ts';

/**
 * Glass callout next to the selected marker: regno, status, `speed · SOC` (F07-R12). A MapLibre
 * marker so it follows the vehicle with the map, without React re-renders per frame.
 */
export function attachSelectedCallout(map: MapLibre, store: LiveTrackingStore) {
  const el = document.createElement('div');
  el.className =
    'glass pointer-events-none w-[168px] rounded-xl px-3 py-2.5 font-sans text-[11px] text-text';
  el.dataset.testid = 'selected-callout';
  el.setAttribute('aria-hidden', 'true');
  const regno = document.createElement('div');
  regno.className = 'truncate text-[10px] font-extrabold tracking-[0.1em] text-text-muted';
  const status = document.createElement('div');
  status.className = 'text-[15px] font-black uppercase';
  const meta = document.createElement('div');
  meta.className = 'text-text-muted';
  el.append(regno, status, meta);
  const marker = new Marker({ element: el, anchor: 'bottom-left', offset: [18, -14] });

  let key = '';
  const render = (s: LiveTrackingState) => {
    const pos = selectedPosition(s);
    const m = pos && calloutModel(s);
    const next = m ? `${pos.join()}|${m.regno}|${m.status}|${m.meta}` : '';
    if (next === key) return;
    key = next;
    if (!m || !pos) {
      marker.remove();
      return;
    }
    regno.textContent = m.regno;
    status.textContent = m.status ? STATUS_META[m.status].label : '—';
    status.style.color = m.status ? STATUS_META[m.status].color : '';
    meta.textContent = m.meta;
    marker.setLngLat(pos).addTo(map);
  };
  render(store.getSnapshot());
  const off = store.subscribe(() => render(store.getSnapshot()));
  return () => {
    off();
    marker.remove();
  };
}
