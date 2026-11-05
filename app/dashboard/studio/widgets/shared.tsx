'use client';

// Building blocks shared by the ChamaPot custom widgets: the format shape every widget declares
// (so Studio's AI agents get a schema for `format` and can place and configure the widgets), a hook
// that loads widget data and keeps it live through Studio's `onDataUpdated` callback, and small
// presentational pieces (avatars, money).

import { useEffect, useRef, useState } from 'react';
import type {
  AgExternalShape,
  AgFormatShapeParams,
  AgShape,
  AgShapeBuilder,
  AgStudioApi,
  AgWidgetApi,
  AgWidgetCrossFilter,
  AgWidgetDataQuery,
  AgWidgetDataResponse,
  AgWidgetField,
  AgWidgetFormParams,
  AgWidgetTable,
} from 'ag-studio';

// --- Format shapes ------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyShape = AgShape<any>;

/**
 * Builds a widget's `formatShape` with Studio's own shape builder. Studio hands its builder to
 * `api.defineAiCommand` factories, so the shape is made there; the command itself is never used.
 * If the builder can't be reached the widget still works, it just has no AI schema.
 */
export function formatShapeFrom<TFormat>(build: (s: AgShapeBuilder) => AnyShape) {
  return (params: AgFormatShapeParams): AgExternalShape<TFormat> => {
    let shape: AnyShape | undefined;
    try {
      (params.api as unknown as AgStudioApi).defineAiCommand((s) => {
        shape = build(s);
        return { input: s.object({}), execute: () => ({ success: true as const, value: undefined }) };
      });
    } catch (error) {
      console.warn('[ChamaPot] could not build a widget format shape', error);
    }
    return shape as unknown as AgExternalShape<TFormat>;
  };
}

/** The title/subtitle/caption block every Studio widget format carries (AgTitle). */
export function titleShape(s: AgShapeBuilder) {
  return s
    .object({
      enabled: s.boolean().optional(),
      text: s.string().optional(),
      color: s.string().optional(),
      textAlign: s.enum(['left', 'center', 'right']).optional(),
      wrapping: s.boolean().optional(),
      typography: s
        .object({
          fontFamily: s.string().optional(),
          fontSize: s.number().optional(),
          fontWeight: s.enum(['normal', 'bold']).optional(),
          fontStyle: s.enum(['normal', 'italic']).optional(),
        })
        .optional(),
    })
    .optional();
}

/** Format shape fields shared by every ChamaPot widget: titles plus cross-filter behaviour. */
export function baseFormatFields(s: AgShapeBuilder) {
  return {
    title: titleShape(s),
    subtitle: titleShape(s),
    caption: titleShape(s),
    crossFilter: s.enum(['filter', 'highlight', 'none']).optional(),
    triggerCrossFilter: s.boolean().optional(),
  };
}

/** The standard Setup / Format tabs, plus extra Format-tab controls. */
export function formWithExtras<P extends AgWidgetFormParams>(
  params: P,
  dataMappingItems: { key: string; label: string }[],
  extras: Record<string, unknown>[] = [],
  crossFilter = { highlight: false, trigger: false },
): ReturnType<P['createDefaults']> {
  const form = params.createDefaults({
    dataMappingItems: dataMappingItems as never,
    supportsCrossHighlight: crossFilter.highlight,
    supportsTriggerCrossFilter: crossFilter.trigger,
  });
  if (extras.length) {
    const formatTab = form.items[1];
    formatTab?.items.push({
      type: 'section',
      key: 'chamapot',
      label: 'ChamaPot',
      items: extras,
    } as never);
  }
  return form as ReturnType<P['createDefaults']>;
}

// --- Data ---------------------------------------------------------------------------

export type Row = Record<string, unknown>;

/**
 * Loads rows for a widget and keeps them live: the first response comes from `getData`, every
 * newer one (a PayPal webhook landing as a Studio transaction, a filter change) arrives through
 * `onDataUpdated` without the widget being refreshed. The query is asked for again whenever Studio
 * refreshes the widget with new params, which keeps it registered as live.
 */
export function useWidgetRows(
  widgetApi: AgWidgetApi,
  query: AgWidgetDataQuery | null,
  options: { queryId: string; crossFilter?: AgWidgetCrossFilter; filter?: boolean },
  refreshToken: unknown,
): { rows: Row[] | null; error: boolean } {
  const [state, setState] = useState<{ rows: Row[] | null; error: boolean }>({ rows: null, error: false });
  const key = query ? queryKey(query) : '';
  useEffect(() => {
    if (!query) return;
    let active = true;
    const apply = (response: AgWidgetDataResponse) => {
      if (!active || response.replaced) return;
      const error = !!response.results.metadata?.error;
      setState({ rows: response.results.rows, error });
    };
    widgetApi
      .getData(query, { ...options, onDataUpdated: apply })
      .then(apply)
      .catch((error: unknown) => {
        if (!active) return;
        console.warn(`[ChamaPot] widget query ${options.queryId} failed`, error);
        setState({ rows: [], error: true });
      });
    return () => {
      active = false;
    };
    // `query` is described by `key`; `refreshToken` changes whenever Studio refreshes the widget.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widgetApi, key, options.queryId, options.crossFilter, options.filter, refreshToken]);
  return state;
}

const queryKey = (query: AgWidgetDataQuery) =>
  JSON.stringify({
    fields: query.fields.map((f) => [f.key, f.aggregation ?? null]),
    filter: query.filter?.map((f) => ('field' in f ? [f.field.key, f.operator, f.value] : f.operator)),
    sort: query.sort?.length ?? 0,
  });

/** A field from the report schema by id ('payouts.status', or a measure id like 'potCollected'). */
export function schemaField(schema: AgWidgetTable[], id: string): AgWidgetField | undefined {
  for (const table of schema) {
    const found = table.fields.find((f) => f.fieldId === id);
    if (found) return found;
  }
  return undefined;
}

export const num = (value: unknown) => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
};
export const text = (value: unknown) => (value == null ? '' : String(value));

/** Counts from `from` to `to` over `ms`, for numbers that should visibly tick up on a payment. */
export function useCountUp(to: number, ms = 1200) {
  const [value, setValue] = useState(to);
  const fromRef = useRef(to);
  useEffect(() => {
    const from = fromRef.current;
    if (from === to) return;
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      fromRef.current = to;
      setValue(to);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(from + (to - from) * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
      else fromRef.current = to;
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      fromRef.current = to;
    };
  }, [to, ms]);
  return value;
}

// --- Presentation -------------------------------------------------------------------

const AVATAR_COLORS = ['#0E7C66', '#B45309', '#7C3AED', '#DB2777', '#0369A1', '#15803D', '#C2410C', '#4338CA', '#A21CAF', '#0F766E'];

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

export function avatarColor(name: string) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export function Avatar({ name, size = 36, muted = false, ring }: { name: string; size?: number; muted?: boolean; ring?: string }) {
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: muted ? '#C9C2B6' : avatarColor(name),
        boxShadow: ring ? `0 0 0 2px #fff, 0 0 0 4px ${ring}` : undefined,
      }}
    >
      {initials(name)}
    </span>
  );
}

export const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
export const kes0 = new Intl.NumberFormat('en-KE', { maximumFractionDigits: 0 });
