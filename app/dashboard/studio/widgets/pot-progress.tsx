'use client';

// Pot progress: a ring that fills toward the cycle's pot target. Shows the USD collected, the KES
// equivalent and how many members still owe, and animates whenever a payment lands (a PayPal
// webhook becomes a Studio Live Data transaction, which reaches this widget through onDataUpdated).

import { useEffect, useId, useRef, useState } from 'react';
import type { AgWidgetData, AgWidgetDataFormat, AgWidgetField, AgWidgetFieldReference, AgWidgetParams } from 'ag-studio';
import type { AgWidgetDefinition } from 'ag-studio-react';
import { AgIncompleteDataMappingOverlay } from 'ag-studio-react';
import { BRAND } from '../theme';
import { baseFormatFields, formatShapeFrom, formWithExtras, kes0, num, useCountUp, usd0, useWidgetRows } from './shared';

export interface PotProgressStyle {
  /** Show the approximate Kenyan shilling value under the USD amount. */
  showKes?: boolean;
  /** Short label under the ring, e.g. "November pot". */
  label?: string;
}

export interface PotProgressDataMapping {
  collected: AgWidgetFieldReference[];
  target?: AgWidgetFieldReference[];
  kes?: AgWidgetFieldReference[];
  outstanding?: AgWidgetFieldReference[];
}

export type PotProgressWidget = AgWidgetData<PotProgressDataMapping, AgWidgetDataFormat<PotProgressStyle>> & { type: 'pot-progress' };

const RADIUS = 78;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function PotProgress(props: AgWidgetParams<PotProgressWidget>) {
  const { widgetApi, dataMapping, format } = props;
  const collectedField = dataMapping.collected?.[0];
  const targetField = dataMapping.target?.[0];
  const kesField = dataMapping.kes?.[0];
  const outstandingField = dataMapping.outstanding?.[0];
  const fields = [collectedField, targetField, kesField, outstandingField].filter((f): f is AgWidgetField => f != null);
  const gradientId = useId();

  const { rows } = useWidgetRows(
    widgetApi,
    collectedField ? { kind: 'flat', fields } : null,
    { queryId: 'pot', crossFilter: format?.crossFilter ?? 'none' },
    props,
  );

  const row = rows?.[0] ?? {};
  const collected = collectedField ? num(row[collectedField.key]) : 0;
  const target = targetField ? num(row[targetField.key]) : 0;
  const kes = kesField ? num(row[kesField.key]) : null;
  const outstanding = outstandingField ? num(row[outstandingField.key]) : null;
  const ratio = target > 0 ? Math.min(1, collected / target) : 0;

  // Flash a "+$50" and a glow on the ring each time the collected amount goes up.
  const previous = useRef<number | null>(null);
  const [bump, setBump] = useState<{ id: number; amount: number } | null>(null);
  useEffect(() => {
    if (rows == null) return;
    const before = previous.current;
    previous.current = collected;
    if (before != null && collected > before) setBump({ id: Date.now(), amount: collected - before });
  }, [collected, rows]);

  const shownCollected = useCountUp(collected);
  const shownRatio = useCountUp(ratio * 100);

  if (!collectedField) return <AgIncompleteDataMappingOverlay />;

  const complete = target > 0 && collected >= target;
  const showKes = format?.style?.showKes !== false && kes != null;
  const offset = CIRCUMFERENCE * (1 - (rows ? ratio : 0));
  const angle = ratio * 2 * Math.PI - Math.PI / 2;
  const tip = { x: 100 + RADIUS * Math.cos(angle), y: 100 + RADIUS * Math.sin(angle) };
  const label = format?.style?.label;

  return (
    <div className="cp-widget">
    <div className="flex h-full items-center justify-center gap-4 overflow-hidden px-2 pb-1 @max-[340px]:flex-col @max-[340px]:gap-2">
      <div className="relative aspect-square h-full max-h-[220px] min-h-[120px] max-w-[60%] shrink-0 @max-[340px]:h-[62%] @max-[340px]:max-w-full">
        <svg viewBox="0 0 200 200" className="h-full w-full" role="img" aria-label={`Pot ${Math.round(ratio * 100)}% full: ${usd0.format(collected)} of ${usd0.format(target)}`}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={BRAND.pot} />
              <stop offset="100%" stopColor={complete ? BRAND.success : BRAND.potDeep} />
            </linearGradient>
          </defs>
          <circle cx="100" cy="100" r={RADIUS} fill="none" stroke={BRAND.lineSoft} strokeWidth="16" />
          {/* Tick marks: one per $50 share of the pot. */}
          {target > 0 &&
            Array.from({ length: Math.min(20, Math.round(target / 50)) }, (_, i) => {
              const a = (i / Math.min(20, Math.round(target / 50))) * 2 * Math.PI - Math.PI / 2;
              return (
                <line
                  key={i}
                  x1={100 + 92 * Math.cos(a)}
                  y1={100 + 92 * Math.sin(a)}
                  x2={100 + 97 * Math.cos(a)}
                  y2={100 + 97 * Math.sin(a)}
                  stroke={BRAND.line}
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              );
            })}
          <circle
            className="cp-ring-progress"
            cx="100"
            cy="100"
            r={RADIUS}
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth="16"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={offset}
            transform="rotate(-90 100 100)"
          />
          {bump && (
            <circle
              key={bump.id}
              className="cp-ring-glow"
              style={{ transformOrigin: '100px 100px' }}
              cx="100"
              cy="100"
              r={RADIUS}
              fill="none"
              stroke={BRAND.marigold}
              strokeWidth="6"
            />
          )}
          {ratio > 0.02 && <circle cx={tip.x} cy={tip.y} r="6" fill={BRAND.marigold} stroke="#fff" strokeWidth="2.5" />}
          <text x="100" y="92" textAnchor="middle" fontSize="34" fontWeight="600" fill={BRAND.ink} style={{ fontFamily: 'var(--cp-display)' }}>
            {usd0.format(Math.round(shownCollected))}
          </text>
          <text x="100" y="115" textAnchor="middle" fontSize="12.5" fill={BRAND.muted} style={{ fontFamily: 'var(--cp-sans)' }}>
            of {usd0.format(target)} pot
          </text>
          <text x="100" y="138" textAnchor="middle" fontSize="13" fontWeight="700" fill={complete ? BRAND.success : BRAND.potDeep} style={{ fontFamily: 'var(--cp-sans)' }}>
            {Math.round(shownRatio)}% full
          </text>
        </svg>
        {bump && (
          <span
            key={bump.id}
            className="cp-bump pointer-events-none absolute left-1/2 top-[6%] -translate-x-1/2 rounded-full px-2.5 py-0.5 text-xs font-bold text-[var(--cp-ink)]"
            style={{ background: BRAND.marigold }}
          >
            +{usd0.format(bump.amount)}
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-2 @max-[340px]:items-center @max-[340px]:text-center">
        {label && <p className="text-xs font-semibold uppercase tracking-wider text-[var(--cp-muted)]">{label}</p>}
        <p className="cp-display text-2xl leading-tight text-[var(--cp-ink)]">
          {usd0.format(collected)}
          <span className="text-base text-[var(--cp-muted)]"> / {usd0.format(target)}</span>
        </p>
        {showKes && <p className="text-sm text-[var(--cp-muted)]">≈ KES {kes0.format(kes ?? 0)} collected</p>}
        {outstanding != null &&
          (complete || outstanding === 0 ? (
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-[var(--cp-pot-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--cp-success)]">
              ✓ Pot complete · ready to propose payout
            </span>
          ) : (
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-[var(--cp-clay-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--cp-clay)]">
              {outstanding} {outstanding === 1 ? 'member' : 'members'} still to pay · {usd0.format(Math.max(0, target - collected))}
            </span>
          ))}
      </div>
    </div>
    </div>
  );
}

const ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="8" opacity=".3"/><path d="M12 4a8 8 0 0 1 7.6 10.5"/></svg>';

export const potProgressWidget: AgWidgetDefinition<'pot-progress', PotProgressWidget> = {
  id: 'pot-progress',
  label: 'Pot progress',
  icon: ICON,
  dataMapping: {
    collected: {
      type: 'field',
      supportedRoles: ['numeric'],
      requires: { cardinality: 'one' },
      required: true,
      aiDescription: 'Amount collected so far, in USD. Default: the potCollected measure (this cycle).',
    },
    target: {
      type: 'field',
      supportedRoles: ['numeric'],
      requires: { cardinality: 'one' },
      aiDescription: 'The pot target the ring fills toward, in USD. Default: the potTarget measure.',
    },
    kes: {
      type: 'field',
      supportedRoles: ['numeric'],
      requires: { cardinality: 'one' },
      aiDescription: 'Optional Kenyan shilling equivalent of the amount collected. Default: potCollectedKes.',
    },
    outstanding: {
      type: 'field',
      supportedRoles: ['numeric'],
      requires: { cardinality: 'one' },
      aiDescription: 'Optional count of members who still owe. Default: membersOutstanding.',
    },
  },
  defaultState: {
    dataMapping: {
      collected: [{ id: 'potCollected' }],
      target: [{ id: 'potTarget' }],
      kes: [{ id: 'potCollectedKes' }],
      outstanding: [{ id: 'membersOutstanding' }],
    },
    format: { title: { enabled: true, text: 'This cycle’s pot' }, style: { showKes: true } },
  },
  formatShape: formatShapeFrom((s) =>
    s.object({
      ...baseFormatFields(s),
      style: s.object({ showKes: s.boolean().optional(), label: s.string().optional() }).optional(),
    }),
  ),
  form: (params) =>
    formWithExtras(
      params,
      [
        { key: 'collected', label: 'Collected' },
        { key: 'target', label: 'Target' },
        { key: 'kes', label: 'KES equivalent' },
        { key: 'outstanding', label: 'Members outstanding' },
      ],
      [
        { type: 'checkbox', id: 'format.style.showKes', label: 'Show KES equivalent', defaultValue: true },
        { type: 'textfield', id: 'format.style.label', label: 'Label' },
      ],
    ),
  comp: PotProgress,
  defaultSize: { width: 420, height: 320 },
  minSize: { width: 220, height: 220 },
  ai: {
    label: 'Pot progress ring',
    description:
      'A ring that fills toward the chama pot target, with the USD collected, the approximate KES equivalent and how many members still owe. It animates and flashes "+$50" when a payment lands live.',
    usage:
      'Use for "how full is the pot", "how much have we collected this cycle", or as the hero of a cycle overview. Shows one total, not history; use a column chart for collection across cycles.',
    configuration:
      'Map collected → potCollected and target → potTarget (both measures already limited to the current cycle). Optionally kes → potCollectedKes and outstanding → membersOutstanding. Give it about a third of the page width and a title such as "This cycle’s pot".',
  },
};
