// Shared footer credit, rendered from the root layout so every page (dashboard, 404 included) has it.
export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-[var(--line,#E6DED0)] px-4 py-5 text-center text-xs text-[var(--muted,#5E6B66)]">
      <span>ChamaPot · PayPal sandbox demo for the PayPal AI Hackathon 2026 · </span>
      <a
        href="https://rytrix.co.ke"
        target="_blank"
        rel="noopener"
        className="underline decoration-dotted underline-offset-2 hover:text-[var(--pot,#0E7C66)]"
      >
        Built by Rytrix
      </a>
    </footer>
  );
}
