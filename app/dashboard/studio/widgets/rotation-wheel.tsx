'use client';

// Rotation wheel: the members of the chama around a wheel in payout order. The member receiving the
// current pot sits at the top in marigold, the next one is ringed in pot green, and those already
// paid out are dimmed. Click a member to cross-filter the page to her; right-click for the
// treasurer's actions (reminder, record cash, statement) from the Studio context menu.

import { useState } from 'react';
import type { AgWidgetData, AgWidgetDataFormat, AgWidgetField, AgWidgetFieldReference, AgWidgetParams } from 'ag-studio';
import type { AgWidgetDefinition } from 'ag-studio-react';
import { AgIncompleteDataMappingOverlay, AgNoDataOverlay } from 'ag-studio-react';
import { BRAND } from '../theme';
import { avatarColor, baseFormatFields, formatShapeFrom, formWithExtras, initials, num, text, useWidgetRows } from './shared';

export interface RotationWheelStyle {
  /** Turn the wheel so the member receiving now sits at the top. */
  currentAtTop?: boolean;
}

export interface RotationWheelDataMapping {
  member: AgWidgetFieldReference[];
  order: AgWidgetFieldReference[];
  status: AgWidgetFieldReference[];
  month?: AgWidgetFieldReference[];
}

export type RotationWheelWidget = AgWidgetData<RotationWheelDataMapping, AgWidgetDataFormat<RotationWheelStyle>> & {
  type: 'rotation-wheel';
};

type Slot = { name: string; order: number; status: string; month: string };

const isReceived = (status: string) => /received|paid out/i.test(status);
const isCurrent = (status: string) => /receiving|current/i.test(status);
const isNext = (status: string) => /next/i.test(status);

function RotationWheel(props: AgWidgetParams<RotationWheelWidget>) {
  const { widgetApi, dataMapping, format } = props;
  const memberField = dataMapping.member?.[0];
  const orderField = dataMapping.order?.[0];
  const statusField = dataMapping.status?.[0];
  const monthField = dataMapping.month?.[0];
  const fields = [memberField, orderField, statusField, monthField].filter((f): f is AgWidgetField => f != null);
  const ready = !!(memberField && orderField && statusField);
  const [hovered, setHovered] = useState<string | null>(null);

  const { rows } = useWidgetRows(
    widgetApi,
    ready ? { kind: 'flat', fields } : null,
    { queryId: 'rotation', crossFilter: format?.crossFilter ?? 'none' },
    props,
  );

  if (!ready) return <AgIncompleteDataMappingOverlay />;
  if (rows && rows.length === 0) return <AgNoDataOverlay />;

  const slots: Slot[] = (rows ?? [])
    .map((r) => ({
      name: text(r[memberField.key]),
      order: num(r[orderField.key]),
      status: text(r[statusField.key]),
      month: monthField ? text(r[monthField.key]) : '',
    }))
    .sort((a, b) => a.order - b.order);

  const n = slots.length || 1;
  const currentIndex = Math.max(0, slots.findIndex((s) => isCurrent(s.status)));
  const current = slots.find((s) => isCurrent(s.status));
  const next = slots.find((s) => isNext(s.status)) ?? slots[(currentIndex + 1) % n];
  const received = slots.filter((s) => isReceived(s.status)).length;
  const rotate = format?.style?.currentAtTop !== false ? currentIndex : 0;

  const R = 112; // ring radius
  const node = 19; // node radius
  const position = (i: number) => {
    const a = ((i - rotate) / n) * 2 * Math.PI - Math.PI / 2;
    return { x: 160 + R * Math.cos(a), y: 160 + R * Math.sin(a) };
  };
  // Progress arc: how much of the rotation has been paid out.
  const progressAngle = (received / n) * 2 * Math.PI;
  const arcStart = -Math.PI / 2 - (rotate / n) * 2 * Math.PI;
  const arcEnd = arcStart + progressAngle;
  const arc =
    received > 0
      ? `M ${160 + R * Math.cos(arcStart)} ${160 + R * Math.sin(arcStart)} A ${R} ${R} 0 ${progressAngle > Math.PI ? 1 : 0} 1 ${160 + R * Math.cos(arcEnd)} ${160 + R * Math.sin(arcEnd)}`
      : '';

  const crossFilter = (name: string) => {
    if (format?.triggerCrossFilter === false) return;
    widgetApi.toggleCrossFilter({ type: 'value', group: 0, field: memberField, value: name });
  };
  const contextMenu = (event: React.MouseEvent, name: string) => {
    event.preventDefault();
    widgetApi.showContextMenu({
      event: event.nativeEvent,
      filter: { field: memberField, operator: 'equals', value: name },
      context: { member: name },
    });
  };

  const selected = new Set(
    (widgetApi.getCrossFilterSelections() ?? []).flatMap((selection) =>
      selection.type === 'value' ? selection.values.map((value) => String(value)) : [],
    ),
  );

  const focus = hovered ? slots.find((s) => s.name === hovered) : current;

  return (
    <div className="cp-widget">
      <div className="flex h-full items-center justify-center overflow-hidden">
        <svg viewBox="0 0 320 320" className="h-full max-h-full w-full max-w-full" role="list" aria-label="Payout rotation">
          <circle cx="160" cy="160" r={R} fill="none" stroke={BRAND.lineSoft} strokeWidth="10" />
          {arc && <path d={arc} fill="none" stroke={BRAND.pot} strokeOpacity="0.28" strokeWidth="10" strokeLinecap="round" />}
          <circle cx="160" cy="160" r="70" fill={BRAND.cream} />

          {/* Centre: who is receiving now (or the member under the pointer). */}
          {focus && (
            <g style={{ fontFamily: 'var(--cp-sans)' }}>
              <text x="160" y="134" textAnchor="middle" fontSize="10" fontWeight="700" letterSpacing="1.2" fill={BRAND.muted}>
                {focus === current ? 'RECEIVING NOW' : focus.status.toUpperCase()}
              </text>
              <text x="160" y="160" textAnchor="middle" fontSize="20" fontWeight="600" fill={BRAND.ink} style={{ fontFamily: 'var(--cp-display)' }}>
                {focus.name.split(' ')[0]}
              </text>
              <text x="160" y="178" textAnchor="middle" fontSize="11" fill={BRAND.muted}>
                {focus.month || `Turn ${focus.order}`}
              </text>
              {focus === current && next && (
                <text x="160" y="198" textAnchor="middle" fontSize="10.5" fill={BRAND.potDeep} fontWeight="600">
                  Next: {next.name.split(' ')[0]}
                </text>
              )}
            </g>
          )}

          {slots.map((slot, i) => {
            const { x, y } = position(i);
            const done = isReceived(slot.status);
            const now = isCurrent(slot.status);
            const upNext = isNext(slot.status);
            const picked = selected.has(slot.name);
            const r = now ? node + 4 : node;
            return (
              <g
                key={slot.name}
                role="listitem"
                aria-label={`${slot.order}. ${slot.name}: ${slot.status}${slot.month ? `, ${slot.month}` : ''}`}
                className="cp-wheel-node cursor-pointer"
                style={{ transform: `translate(${x}px, ${y}px)` }}
                onMouseEnter={() => setHovered(slot.name)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => crossFilter(slot.name)}
                onContextMenu={(e) => contextMenu(e, slot.name)}
              >
                <title>{`${slot.name} · turn ${slot.order}${slot.month ? ` · ${slot.month}` : ''} · ${slot.status}`}</title>
                {now && <circle className="cp-pulse-ring" r={r + 4} fill="none" stroke={BRAND.marigold} strokeWidth="3" />}
                {(now || upNext || picked) && (
                  <circle r={r + 4} fill="#fff" stroke={picked ? BRAND.ink : now ? BRAND.marigold : BRAND.pot} strokeWidth={picked ? 2.5 : 3} />
                )}
                <circle className="cp-wheel-disc" r={r} fill={done ? '#CFC7BA' : avatarColor(slot.name)} />
                <text
                  textAnchor="middle"
                  dy="0.35em"
                  fontSize={now ? 13 : 11.5}
                  fontWeight="700"
                  fill="#fff"
                  style={{ fontFamily: 'var(--cp-sans)', pointerEvents: 'none' }}
                >
                  {initials(slot.name)}
                </text>
                {done && (
                  <g transform={`translate(${r * 0.72}, ${-r * 0.72})`}>
                    <circle r="7" fill={BRAND.pot} stroke="#fff" strokeWidth="1.5" />
                    <path d="M -3 0 L -1 2.2 L 3 -2" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </g>
                )}
                <text
                  y={r + 14}
                  textAnchor="middle"
                  fontSize="10"
                  fontWeight={now ? 700 : 500}
                  fill={now ? BRAND.ink : BRAND.muted}
                  style={{ fontFamily: 'var(--cp-sans)', pointerEvents: 'none' }}
                >
                  {slot.name.split(' ')[0]}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

const ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="7.5" stroke-dasharray="3 2.4"/><circle cx="12" cy="4.5" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2.5"/></svg>';

export const rotationWheelWidget: AgWidgetDefinition<'rotation-wheel', RotationWheelWidget> = {
  id: 'rotation-wheel',
  label: 'Rotation wheel',
  icon: ICON,
  dataMapping: {
    member: {
      type: 'field',
      supportedRoles: ['category'],
      requires: { cardinality: 'many' },
      required: true,
      aiDescription: 'One node per member on the wheel. Default: members.full_name.',
    },
    order: {
      type: 'field',
      supportedRoles: ['numeric'],
      requires: { per: 'dataMapping.member', cardinality: 'one' },
      required: true,
      aiDescription: 'Position in the payout rotation, used to order members around the wheel. Default: members.rotation_position (min).',
    },
    status: {
      type: 'field',
      supportedRoles: ['category'],
      requires: { per: 'dataMapping.member', cardinality: 'one' },
      required: true,
      aiDescription:
        'Payout status per member. Values containing "Received" are dimmed, "Receiving" is highlighted as the current recipient, "Next" is ringed. Default: members.payout_state (aggregation first).',
    },
    month: {
      type: 'field',
      supportedRoles: ['category'],
      requires: { per: 'dataMapping.member', cardinality: 'one' },
      aiDescription: 'Optional payout month per member, shown in the centre. Default: members.payout_month (aggregation first).',
    },
  },
  defaultState: {
    dataMapping: {
      member: [{ id: 'members.full_name' }],
      order: [{ id: 'members.rotation_position', aggregation: 'min' }],
      status: [{ id: 'members.payout_state', aggregation: 'first' }],
      month: [{ id: 'members.payout_month', aggregation: 'first' }],
    },
    format: { title: { enabled: true, text: 'Payout rotation' }, style: { currentAtTop: true } },
  },
  formatShape: formatShapeFrom((s) =>
    s.object({
      ...baseFormatFields(s),
      style: s.object({ currentAtTop: s.boolean().optional() }).optional(),
    }),
  ),
  form: (params) =>
    formWithExtras(
      params,
      [
        { key: 'member', label: 'Member' },
        { key: 'order', label: 'Rotation order' },
        { key: 'status', label: 'Payout status' },
        { key: 'month', label: 'Payout month' },
      ],
      [{ type: 'checkbox', id: 'format.style.currentAtTop', label: 'Current recipient at the top', defaultValue: true }],
      { highlight: false, trigger: true },
    ),
  comp: RotationWheel,
  defaultSize: { width: 420, height: 360 },
  minSize: { width: 220, height: 220 },
  ai: {
    label: 'Payout rotation wheel',
    description:
      'The chama members arranged around a wheel in payout order. The member receiving the current pot is highlighted at the top in marigold, the next recipient is ringed in green, members already paid out are dimmed with a check, and an arc shows how far through the rotation the group is.',
    usage:
      'Use for "whose turn is it", "who is next", "where are we in the rotation". Clicking a member cross-filters other widgets to her. Not for money totals.',
    configuration:
      'Map member → members.full_name, order → members.rotation_position (aggregation min), status → members.payout_state (first), month → members.payout_month (first). A square-ish slot about a third of the page wide works best. Title: "Payout rotation".',
  },
};
