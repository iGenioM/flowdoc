import Link from "next/link";

export type Crumb = { label: string; href?: string };

/** Marca: dois nós ligados, o último em lima (o "ponto de atenção" do sistema). */
function Mark() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden>
      <rect width="26" height="26" rx="7" fill="#6420EF" />
      <path d="M8 13h6.5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="8" cy="13" r="3" fill="#fff" />
      <circle cx="18" cy="13" r="3.4" fill="#D3FC72" />
    </svg>
  );
}

export function TopBar({ trail = [], right }: { trail?: Crumb[]; right?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-[1400px] items-center gap-3 px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight" aria-label="FlowDoc, início">
          <Mark />
          <span className="hidden sm:inline">FlowDoc</span>
        </Link>
        {trail.map((c, i) => (
          <span key={i} className="flex min-w-0 items-center gap-3 text-sm">
            <span className="text-border" aria-hidden>/</span>
            {c.href ? <Link href={c.href} className="truncate text-muted-foreground hover:text-foreground">{c.label}</Link> : <span className="truncate font-medium">{c.label}</span>}
          </span>
        ))}
        <div className="ml-auto flex items-center gap-2">{right}</div>
      </div>
    </header>
  );
}
