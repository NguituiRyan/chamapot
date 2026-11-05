// Small presentational primitives shared by every ChamaPot page.

export const btn = {
  base: 'inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] px-4 text-sm font-semibold transition-[background-color,box-shadow,transform,color] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 cursor-pointer',
  primary: 'bg-pot text-white shadow-sm hover:bg-pot-deep',
  secondary: 'border border-line bg-card text-ink hover:border-pot/40 hover:bg-pot-soft',
  ghost: 'text-ink hover:bg-sunken',
  danger: 'border border-danger/30 bg-card text-danger hover:bg-danger-soft',
  accent: 'bg-marigold text-[#3b2400] shadow-sm hover:brightness-95',
};

export function buttonClass(variant: Exclude<keyof typeof btn, 'base'> = 'primary', extra = '') {
  return `${btn.base} ${btn[variant]} ${extra}`;
}

export function Card({
  children,
  className = '',
  as: Tag = 'section',
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
  as?: 'section' | 'div' | 'article' | 'aside' | 'li';
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag className={`rounded-[14px] border border-line bg-card shadow-card ${className}`} {...rest}>
      {children}
    </Tag>
  );
}

export function Eyebrow({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={`text-xs font-semibold uppercase tracking-[0.14em] text-pot-ink ${className}`}>{children}</p>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <h1 className="mt-1.5 font-display text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-4xl">
          {title}
        </h1>
        {description ? <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

export function SectionTitle({
  children,
  aside,
  id,
}: {
  children: React.ReactNode;
  aside?: React.ReactNode;
  id?: string;
}) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 id={id} className="font-display text-xl font-semibold tracking-tight text-ink">
        {children}
      </h2>
      {aside ? <div className="text-sm text-muted">{aside}</div> : null}
    </div>
  );
}
