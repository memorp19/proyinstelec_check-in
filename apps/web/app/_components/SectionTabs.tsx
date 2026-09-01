"use client";

import { usePathname, useRouter } from "next/navigation";

interface Section {
  href: string;
  label: string;
  prefix: string;
}

export function SectionTabs({ sections }: { sections: Section[] }) {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <nav className="hidden md:flex items-center gap-1">
      {sections.map((s) => {
        const active = pathname === s.href || pathname.startsWith(s.prefix + "/");
        return (
          <button
            key={s.href}
            onClick={() => router.push(s.href)}
            className={`px-3 py-1.5 rounded-lg font-mono text-xs transition-colors ${
              active
                ? "bg-blue/20 text-blue border border-blue/30"
                : "text-white/50 hover:text-white/80 hover:bg-white/10"
            }`}
          >
            {s.label}
          </button>
        );
      })}
    </nav>
  );
}
