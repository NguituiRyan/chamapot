'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import {
  Bot,
  CircleAlert,
  CircleCheck,
  ClipboardPaste,
  FileText,
  FileUp,
  LoaderCircle,
  Lock,
  ScrollText,
  ShieldCheck,
  TriangleAlert,
  X,
} from 'lucide-react';
import { ConfidenceMeter, SourceQuote } from '@/components/confidence-meter';
import { formatUsd } from '@/components/format';
import type { ExtractedSettings, ExtractionResponse } from '@/components/rule-keys';
import { ruleOrder } from '@/components/rule-keys';
import { SAMPLE_CONSTITUTION_TEXT } from '@/components/sample-constitution';
import { Pill } from '@/components/status-pill';
import { Card, buttonClass } from '@/components/ui';

interface CurrentRule {
  key: string;
  label: string;
  value: string;
  source_quote: string | null;
  confidence: number | null;
}

interface Props {
  slug: string;
  aiReady: boolean;
  currentRules: CurrentRule[];
  currentSettings: ExtractedSettings;
  acting: { handle: string; name: string; roleLabel: string; official: boolean } | null;
}

type Phase = 'idle' | 'reading' | 'review' | 'applying' | 'applied';

const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp';
const MAX_BYTES = 8 * 1024 * 1024;
const SAMPLE_PDF = '/demo/umoja-sisters-constitution.pdf';

const sameValue = (a: string, b: string) =>
  a.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.]$/, '') ===
  b.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.]$/, '');

const fmtSize = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

const SETTING_ROWS: { key: keyof ExtractedSettings; label: string; fmt: (v: number) => string }[] = [
  { key: 'contribution_amount', label: 'Contribution', fmt: (v) => formatUsd(v) },
  { key: 'grace_days', label: 'Grace period', fmt: (v) => `${v} days` },
  { key: 'late_fine', label: 'Late fine', fmt: (v) => formatUsd(v) },
  { key: 'approvals_required', label: 'Approvals per payout', fmt: (v) => `${v} officials` },
];

const READING_STEPS = ['Reading the document', 'Finding the rules', 'Quoting every source line', 'Scoring confidence'];

export function ConstitutionPanel({ slug, aiReady, currentRules, currentSettings, acting }: Props) {
  const router = useRouter();
  const fileInputId = useId();
  const textId = useId();
  const resultRef = useRef<HTMLDivElement>(null);

  const [mode, setMode] = useState<'upload' | 'paste'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractionResponse | null>(null);
  const [sourceLabel, setSourceLabel] = useState('');
  const [include, setInclude] = useState<Record<string, boolean>>({});
  const [elapsed, setElapsed] = useState(0);
  const [appliedSummary, setAppliedSummary] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);

  useEffect(() => {
    if (phase !== 'reading') return;
    const start = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 500);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(() => {
    if (phase === 'review') resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [phase]);

  function pickFile(f: File | null | undefined) {
    setError(null);
    if (!f) return;
    if (!ACCEPT.split(',').includes(f.type)) {
      setError('Upload a PDF, JPG, PNG or WebP of the constitution.');
      return;
    }
    if (f.size > MAX_BYTES) {
      setError(`That file is ${fmtSize(f.size)}. The limit is 8 MB; try a smaller scan or paste the text.`);
      return;
    }
    setFile(f);
  }

  async function extract(input: { file?: File; text?: string }, label: string) {
    if (!aiReady) {
      setError('Claude is not connected on this server yet (ANTHROPIC_API_KEY is missing). The current rules still apply.');
      return;
    }
    setError(null);
    setPhase('reading');
    setElapsed(0);
    setResult(null);
    setAppliedSummary(null);
    setSourceLabel(label);
    try {
      let res: Response;
      if (input.file) {
        const fd = new FormData();
        fd.append('file', input.file);
        fd.append('slug', slug);
        res = await fetch('/api/ai/extract-rules', { method: 'POST', body: fd });
      } else {
        res = await fetch('/api/ai/extract-rules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: input.text, slug }),
        });
      }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `Reading failed (${res.status})`);
      const data = body as ExtractionResponse;
      setResult(data);
      setInclude(Object.fromEntries(data.rules.map((r) => [r.key, true])));
      setPhase('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reading the constitution failed. Try again.');
      setPhase('idle');
    }
  }

  async function readSample() {
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(SAMPLE_PDF);
      const type = res.headers.get('content-type') ?? '';
      if (!res.ok || !type.includes('pdf')) throw new Error('missing');
      const blob = await res.blob();
      const f = new File([blob], 'umoja-sisters-constitution.pdf', { type: 'application/pdf' });
      setMode('upload');
      setFile(f);
      await extract({ file: f }, 'Sample: Umoja Sisters constitution (PDF)');
    } catch {
      setMode('paste');
      setText(SAMPLE_CONSTITUTION_TEXT);
      setNotice('The sample PDF is not in this build, so Claude is reading the text version of the same constitution.');
      await extract({ text: SAMPLE_CONSTITUTION_TEXT }, 'Sample: Umoja Sisters constitution (text)');
    }
  }

  async function apply() {
    if (!result || !acting?.official) return;
    const rules = result.rules.filter((r) => include[r.key]);
    if (rules.length === 0) {
      setApplyError('Tick at least one rule to apply.');
      return;
    }
    setPhase('applying');
    setApplyError(null);
    try {
      const res = await fetch('/api/chama/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          appliedBy: acting.handle,
          rules: rules.map(({ key, label, value, source_quote, confidence }) => ({ key, label, value, source_quote, confidence })),
          settings: result.settings,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `Saving failed (${res.status})`);
      setAppliedSummary(body.summary ?? `${rules.length} rules applied`);
      setPhase('applied');
      router.refresh();
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : 'Saving the rules failed.');
      setPhase('review');
    }
  }

  function reset() {
    setPhase('idle');
    setResult(null);
    setError(null);
    setNotice(null);
    setAppliedSummary(null);
    setApplyError(null);
  }

  const busy = phase === 'reading' || phase === 'applying';
  const canSubmit = !busy && (mode === 'upload' ? !!file : text.trim().length >= 40);

  // ---- Diff model ----
  const current = new Map(currentRules.map((r) => [r.key, r]));
  const rows = result
    ? [
        ...result.rules.map((r) => {
          const now = current.get(r.key);
          const status = !now ? 'new' : sameValue(now.value, r.value) ? 'same' : 'changed';
          return { key: r.key, extracted: r, now: now ?? null, status } as const;
        }),
        ...currentRules
          .filter((r) => !result.rules.some((x) => x.key === r.key))
          .map((r) => ({ key: r.key, extracted: null, now: r, status: 'missing' as const })),
      ].sort((a, b) => ruleOrder(a.key) - ruleOrder(b.key))
    : [];
  const counts = result
    ? {
        total: result.rules.length,
        review: result.rules.filter((r) => r.needs_review).length,
        changed: rows.filter((r) => r.status === 'changed').length,
        added: rows.filter((r) => r.status === 'new').length,
        selected: result.rules.filter((r) => include[r.key]).length,
      }
    : null;

  return (
    <section aria-labelledby="reread-title" className="space-y-6">
      <Card className="overflow-hidden">
        <div className="grid gap-0 lg:grid-cols-[0.85fr_1.15fr]">
          {/* Explainer */}
          <div className="border-b border-line bg-pot-soft/50 p-5 sm:p-6 lg:border-b-0 lg:border-r">
            <span className="flex size-11 items-center justify-center rounded-[12px] bg-pot text-white">
              <ScrollText className="size-5" aria-hidden />
            </span>
            <h2 id="reread-title" className="mt-4 font-display text-2xl font-semibold tracking-tight text-ink">
              Re-read the constitution
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Claude reads the document and returns each rule with the exact sentence it came from and how sure it is.
              Nothing changes until an official reviews the differences and applies them.
            </p>
            <ul className="mt-4 space-y-2 text-sm text-ink">
              <li className="flex gap-2">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-pot-ink" aria-hidden />
                Every rule quotes its source, word for word
              </li>
              <li className="flex gap-2">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-clay" aria-hidden />
                Unclear clauses are flagged for review
              </li>
              <li className="flex gap-2">
                <Lock className="mt-0.5 size-4 shrink-0 text-pot-ink" aria-hidden />
                Only officials can apply new rules
              </li>
            </ul>
            <button
              type="button"
              onClick={readSample}
              disabled={busy}
              className={buttonClass('primary', 'mt-6 w-full sm:w-auto')}
            >
              <FileText className="size-4" aria-hidden />
              Use the sample constitution
            </button>
            {!aiReady ? (
              <p className="mt-3 flex gap-2 text-xs text-muted">
                <CircleAlert className="size-4 shrink-0 text-clay" aria-hidden />
                Claude is not connected on this server yet, so reading is switched off. The current rules still apply.
              </p>
            ) : null}
          </div>

          {/* Input */}
          <div className="p-5 sm:p-6">
            <div role="tablist" aria-label="How to provide the constitution" className="inline-flex rounded-[10px] bg-sunken p-1">
              {(
                [
                  { id: 'upload', label: 'Upload a file', icon: FileUp },
                  { id: 'paste', label: 'Paste text', icon: ClipboardPaste },
                ] as const
              ).map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={mode === id}
                  onClick={() => setMode(id)}
                  disabled={busy}
                  className={`inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-[8px] px-3 text-sm font-semibold transition-colors ${
                    mode === id ? 'bg-card text-ink shadow-sm' : 'text-muted hover:text-ink'
                  }`}
                >
                  <Icon className="size-4" aria-hidden />
                  {label}
                </button>
              ))}
            </div>

            {mode === 'upload' ? (
              <div className="mt-4">
                {file ? (
                  <div className="flex items-center gap-3 rounded-[12px] border border-line bg-sunken px-4 py-3">
                    <FileText className="size-6 shrink-0 text-pot-ink" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink">{file.name}</p>
                      <p className="text-xs text-muted">
                        {file.type === 'application/pdf' ? 'PDF' : 'Image'} · {fmtSize(file.size)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setFile(null)}
                      disabled={busy}
                      className="inline-flex size-10 cursor-pointer items-center justify-center rounded-[10px] text-muted hover:bg-card hover:text-ink"
                    >
                      <X className="size-4" aria-hidden />
                      <span className="sr-only">Remove {file.name}</span>
                    </button>
                  </div>
                ) : (
                  <label
                    htmlFor={fileInputId}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragging(true);
                    }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragging(false);
                      pickFile(e.dataTransfer.files?.[0]);
                    }}
                    className={`flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-[12px] border-2 border-dashed px-4 py-8 text-center transition-colors ${
                      dragging ? 'border-pot bg-pot-soft' : 'border-line bg-sunken/60 hover:border-pot/50'
                    }`}
                  >
                    <FileUp className="size-7 text-pot-ink" aria-hidden />
                    <span className="mt-2 text-sm font-semibold text-ink">Choose the constitution, or drop it here</span>
                    <span className="mt-1 text-xs text-muted">PDF, or a photo or scan (JPG, PNG, WebP), up to 8 MB</span>
                    <input
                      id={fileInputId}
                      type="file"
                      accept={ACCEPT}
                      className="sr-only"
                      onChange={(e) => {
                        pickFile(e.target.files?.[0]);
                        e.target.value = '';
                      }}
                    />
                  </label>
                )}
              </div>
            ) : (
              <div className="mt-4">
                <label htmlFor={textId} className="text-sm font-semibold text-ink">
                  Constitution text
                </label>
                <textarea
                  id={textId}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  disabled={busy}
                  rows={8}
                  placeholder="Paste the full constitution here…"
                  className="mt-1.5 block w-full resize-y rounded-[10px] border border-line bg-card px-3 py-2.5 font-mono text-[13px] leading-relaxed text-ink placeholder:text-muted/70 focus:border-pot"
                />
                <p className="mt-1 text-xs text-muted">{text.trim().length.toLocaleString()} characters · at least a few clauses</p>
              </div>
            )}

            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
              <button
                type="button"
                disabled={!canSubmit || !aiReady}
                onClick={() =>
                  mode === 'upload' && file
                    ? extract({ file }, file.name)
                    : extract({ text }, 'Pasted text')
                }
                className={buttonClass('secondary')}
              >
                {phase === 'reading' ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Bot className="size-4" aria-hidden />}
                {phase === 'reading' ? 'Claude is reading…' : 'Read with Claude'}
              </button>
              {phase !== 'idle' && !busy ? (
                <button type="button" onClick={reset} className={buttonClass('ghost')}>
                  Start over
                </button>
              ) : null}
            </div>

            {notice ? (
              <p className="mt-3 rounded-[10px] bg-marigold-soft px-3 py-2 text-sm text-marigold-ink" role="status">
                {notice}
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="mt-3 flex gap-2 rounded-[10px] border border-danger/25 bg-danger-soft px-3 py-2 text-sm text-ink">
                <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
                {error}
              </p>
            ) : null}
          </div>
        </div>
      </Card>

      {/* Reading progress */}
      {phase === 'reading' ? (
        <Card className="p-5 sm:p-6" aria-live="polite">
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-2 font-semibold text-ink">
              <LoaderCircle className="size-5 animate-spin text-pot-ink" aria-hidden />
              Claude is reading {sourceLabel.startsWith('Sample') ? 'the sample constitution' : sourceLabel}
            </p>
            <span className="tabular text-sm text-muted">{elapsed}s</span>
          </div>
          <ol className="mt-4 grid gap-2 sm:grid-cols-4">
            {READING_STEPS.map((step, i) => {
              const active = Math.min(READING_STEPS.length - 1, Math.floor(elapsed / 6)) === i;
              const done = Math.floor(elapsed / 6) > i;
              return (
                <li
                  key={step}
                  className={`flex items-center gap-2 rounded-[10px] px-3 py-2 text-sm ${
                    active ? 'bg-pot-soft font-semibold text-pot-ink' : done ? 'text-ink' : 'text-muted'
                  }`}
                >
                  {done ? (
                    <CircleCheck className="size-4 shrink-0 text-success" aria-hidden />
                  ) : (
                    <span className={`size-2 shrink-0 rounded-full ${active ? 'animate-live bg-pot' : 'bg-line'}`} aria-hidden />
                  )}
                  {step}
                </li>
              );
            })}
          </ol>
          <div className="mt-5 grid gap-3 md:grid-cols-2" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="space-y-2 rounded-[12px] border border-line p-4">
                <div className="h-3 w-24 animate-pulse rounded bg-sunken" />
                <div className="h-4 w-3/4 animate-pulse rounded bg-sunken" />
                <div className="h-10 w-full animate-pulse rounded bg-marigold-soft/70" />
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {/* Review diff */}
      {result && counts && (phase === 'review' || phase === 'applying' || phase === 'applied') ? (
        <div ref={resultRef} className="scroll-mt-24 space-y-4">
          <Card className="p-5 sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-pot-ink">Claude&apos;s reading</p>
                <h3 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink">
                  {counts.total} rules found
                  {counts.review > 0 ? `, ${counts.review} need${counts.review === 1 ? 's' : ''} review` : ''}
                </h3>
                <p className="mt-1 text-sm text-muted">
                  {sourceLabel} · {result.model} · {counts.changed} changed · {counts.added} new
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {counts.review > 0 ? (
                  <Pill tone="clay" icon={TriangleAlert}>
                    {counts.review} to review
                  </Pill>
                ) : (
                  <Pill tone="success" icon={CircleCheck}>
                    Nothing flagged
                  </Pill>
                )}
              </div>
            </div>

            <div className="mt-5 overflow-hidden rounded-[12px] border border-line">
              <table className="w-full text-sm">
                <caption className="sr-only">Settings the code enforces: now vs extracted</caption>
                <thead className="bg-sunken text-left text-xs text-muted">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">Enforced setting</th>
                    <th scope="col" className="px-3 py-2 font-medium">Now</th>
                    <th scope="col" className="px-3 py-2 font-medium">From the document</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {SETTING_ROWS.map(({ key, label, fmt }) => {
                    const now = currentSettings[key];
                    const next = result.settings[key];
                    const changed = next != null && now != null && next !== now;
                    return (
                      <tr key={key}>
                        <th scope="row" className="px-3 py-2.5 text-left font-medium text-ink">{label}</th>
                        <td className="tabular px-3 py-2.5 text-muted">{now == null ? '—' : fmt(now)}</td>
                        <td className={`tabular px-3 py-2.5 font-semibold ${changed ? 'text-clay' : 'text-ink'}`}>
                          {next == null ? <span className="font-normal text-muted">Not stated, unchanged</span> : fmt(next)}
                          {changed ? <span className="ml-1.5 text-xs font-medium">(changes)</span> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <ul className="space-y-3">
            {rows.map((row) => {
              const ex = row.extracted;
              const checkboxId = `include-${row.key}`;
              return (
                <Card
                  as="li"
                  key={row.key}
                  className={`p-4 sm:p-5 ${ex?.needs_review ? 'border-clay/40 ring-1 ring-clay/20' : ''}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="mr-auto font-semibold text-ink">{ex?.label ?? row.now?.label}</h4>
                    {row.status === 'same' ? <Pill tone="neutral">No change</Pill> : null}
                    {row.status === 'changed' ? <Pill tone="marigold">Changed</Pill> : null}
                    {row.status === 'new' ? <Pill tone="pot">New rule</Pill> : null}
                    {row.status === 'missing' ? <Pill tone="neutral">Not found in document</Pill> : null}
                    {ex?.needs_review ? (
                      <Pill tone="clay" icon={TriangleAlert}>
                        Needs review
                      </Pill>
                    ) : null}
                  </div>

                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div className="rounded-[10px] bg-sunken px-3 py-2.5">
                      <p className="text-xs font-medium text-muted">Now</p>
                      <p className={`mt-0.5 text-sm ${row.now ? 'text-ink' : 'italic text-muted'}`}>
                        {row.now?.value ?? 'Not in the current rules'}
                      </p>
                    </div>
                    <div
                      className={`rounded-[10px] px-3 py-2.5 ${
                        row.status === 'changed' || row.status === 'new' ? 'bg-pot-soft' : 'bg-sunken'
                      }`}
                    >
                      <p className="text-xs font-medium text-muted">From the constitution</p>
                      <p className={`mt-0.5 text-sm ${ex ? 'font-semibold text-ink' : 'italic text-muted'}`}>
                        {ex?.value ?? 'Claude did not find this rule. It stays as it is.'}
                      </p>
                    </div>
                  </div>

                  {ex ? (
                    <>
                      <SourceQuote className="mt-3">{ex.source_quote}</SourceQuote>
                      {ex.needs_review && ex.review_note ? (
                        <p className="mt-2 flex gap-2 rounded-[10px] bg-clay-soft px-3 py-2 text-sm text-ink">
                          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-clay" aria-hidden />
                          <span>
                            <span className="font-semibold">Check before applying: </span>
                            {ex.review_note}
                          </span>
                        </p>
                      ) : null}
                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                        <ConfidenceMeter value={ex.confidence} />
                        {ex.quote_verified === true ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                            <CircleCheck className="size-3.5" aria-hidden /> Quote found word for word
                          </span>
                        ) : ex.quote_verified === false ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-clay">
                            <TriangleAlert className="size-3.5" aria-hidden /> Quote not found verbatim
                          </span>
                        ) : null}
                        <label
                          htmlFor={checkboxId}
                          className="ml-auto inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium text-ink"
                        >
                          <input
                            id={checkboxId}
                            type="checkbox"
                            checked={!!include[row.key]}
                            disabled={phase !== 'review'}
                            onChange={(e) => setInclude((s) => ({ ...s, [row.key]: e.target.checked }))}
                            className="size-4 cursor-pointer accent-[var(--pot)]"
                          />
                          Apply this rule
                        </label>
                      </div>
                    </>
                  ) : null}
                </Card>
              );
            })}
          </ul>

          {/* Apply bar */}
          <div className="sticky bottom-3 z-10">
            <Card className="p-4">
            {applyError ? (
              <p role="alert" className="mb-3 flex gap-2 rounded-[10px] border border-danger/25 bg-danger-soft px-3 py-2 text-sm text-ink">
                <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
                {applyError}
              </p>
            ) : null}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              {phase === 'applied' ? (
                <p className="flex items-center gap-2 text-sm font-semibold text-success" role="status">
                  <CircleCheck className="size-5" aria-hidden />
                  {appliedSummary}. Logged in the activity feed.
                </p>
              ) : acting?.official ? (
                <p className="text-sm text-muted">
                  Applying as <span className="font-semibold text-ink">{acting.name}</span> ({acting.roleLabel}) ·{' '}
                  {counts.selected} of {counts.total} rules selected
                </p>
              ) : (
                <p className="flex items-start gap-2 text-sm text-muted">
                  <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>
                    You are viewing as {acting?.name ?? 'a member'}. Only officials (chair, treasurer or secretary) can apply
                    rules; switch with &ldquo;Viewing as&rdquo;.
                  </span>
                </p>
              )}
              <div className="flex gap-2">
                {phase === 'applied' ? (
                  <button type="button" onClick={reset} className={buttonClass('secondary')}>
                    Done
                  </button>
                ) : (
                  <>
                    <button type="button" onClick={reset} disabled={busy} className={buttonClass('ghost')}>
                      Discard
                    </button>
                    <button
                      type="button"
                      onClick={apply}
                      disabled={!acting?.official || busy || counts.selected === 0}
                      className={buttonClass('primary', 'flex-1 sm:flex-none')}
                    >
                      {phase === 'applying' ? (
                        <LoaderCircle className="size-4 animate-spin" aria-hidden />
                      ) : (
                        <CircleCheck className="size-4" aria-hidden />
                      )}
                      {phase === 'applying' ? 'Applying…' : `Apply ${counts.selected} rules`}
                    </button>
                  </>
                )}
              </div>
            </div>
            </Card>
          </div>
        </div>
      ) : null}
    </section>
  );
}
