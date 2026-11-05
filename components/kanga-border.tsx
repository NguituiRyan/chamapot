/** A thin kanga-style border strip (zig-zag + dots). Decorative only. */
export function KangaBorder({ className = '' }: { className?: string }) {
  return (
    <svg className={`block h-3 w-full ${className}`} aria-hidden preserveAspectRatio="none">
      <defs>
        <pattern id="kanga" width="24" height="12" patternUnits="userSpaceOnUse">
          <path d="M0 12 L6 2 L12 12 L18 2 L24 12" fill="none" stroke="var(--marigold)" strokeWidth="2" />
          <circle cx="12" cy="3" r="1.4" fill="var(--pot)" />
        </pattern>
      </defs>
      <rect width="100%" height="12" fill="url(#kanga)" />
    </svg>
  );
}
