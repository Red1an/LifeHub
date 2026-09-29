import { useMemo, useState } from "react";
import { Marked } from "marked";
import hljs from "highlight.js/lib/core";
import csharp from "highlight.js/lib/languages/csharp";
import sql from "highlight.js/lib/languages/sql";
import bash from "highlight.js/lib/languages/bash";
import yaml from "highlight.js/lib/languages/yaml";
import json from "highlight.js/lib/languages/json";
import xml from "highlight.js/lib/languages/xml";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import python from "highlight.js/lib/languages/python";
import typescript from "highlight.js/lib/languages/typescript";
import ini from "highlight.js/lib/languages/ini";
import { cn } from "@lifehub/sdk";
import { GLOSSARY } from "../data/glossary.ts";

hljs.registerLanguage("csharp", csharp);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("json", json);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("dockerfile", dockerfile);
hljs.registerLanguage("python", python);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("ini", ini);
hljs.registerAliases(["cs", "c#", "dotnet"], { languageName: "csharp" });
hljs.registerAliases(["sh", "shell", "powershell", "console"], { languageName: "bash" });
hljs.registerAliases(["yml", "helm"], { languageName: "yaml" });
hljs.registerAliases(["html", "csproj"], { languageName: "xml" });
hljs.registerAliases(["docker"], { languageName: "dockerfile" });
hljs.registerAliases(["toml"], { languageName: "ini" });

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function highlight(code: string, lang?: string) {
  const l = lang?.toLowerCase().trim();
  try {
    if (l && hljs.getLanguage(l)) return hljs.highlight(code, { language: l }).value;
    return hljs.highlightAuto(code, ["csharp", "sql", "bash", "yaml", "json", "dockerfile"]).value;
  } catch {
    return esc(code);
  }
}

const renderer = {
  code({ text, lang }: { text: string; lang?: string }) {
    return `<pre><code class="hljs">${highlight(text, lang)}</code></pre>`;
  },
  // Сырой HTML от нейронки не исполняем — показываем как текст.
  html({ text }: { text: string }) {
    return esc(text);
  },
  link({ href, text }: { href: string; text: string }) {
    return `<a href="${esc(href)}" target="_blank" rel="noreferrer">${esc(text)}</a>`;
  },
};

const md = new Marked({ gfm: true, breaks: false });
md.use({ renderer });

/* ───── Словарь терминов: первое упоминание подчёркивается, по нажатию — определение ───── */

const reEsc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const aliasPattern = (a: string) => (a.endsWith("*") ? `${reEsc(a.slice(0, -1))}\\p{L}{0,5}` : reEsc(a));
const TERM_RES = GLOSSARY.map(([aliases]) => new RegExp(`^(?:${aliases.map(aliasPattern).join("|")})$`, "iu"));
const ALL_TERMS = new RegExp(
  `(?<![\\p{L}\\p{N}_])(${GLOSSARY.flatMap(([a]) => a).sort((x, y) => y.length - x.length).map(aliasPattern).join("|")})(?![\\p{L}\\p{N}_])`,
  "giu",
);
let seenTerms = new Set<number>();
const termTitle = (t: string) => {
  const x = t.replace(/\*$/, "");
  return x[0].toUpperCase() + x.slice(1);
};

function markTerms(html: string) {
  return html.replace(ALL_TERMS, (m) => {
    const i = TERM_RES.findIndex((re) => re.test(m));
    if (i < 0 || seenTerms.has(i)) return m;
    seenTerms.add(i);
    return `<span class="dp-term" data-term="${i}">${m}</span>`;
  });
}

const mdTerms = new Marked({ gfm: true, breaks: false });
mdTerms.use({
  renderer: {
    ...renderer,
    text(token) {
      if ("tokens" in token && token.tokens) return this.parser.parseInline(token.tokens);
      return markTerms(esc(token.text));
    },
  },
});

/**
 * Markdown с подсветкой кода. terms — подчёркивать термины из словаря (для теории).
 */
export function Md({ text, className, terms }: { text: string; className?: string; terms?: boolean }) {
  const html = useMemo(() => {
    if (!terms) return md.parse(text || "") as string;
    seenTerms = new Set();
    return mdTerms.parse(text || "") as string;
  }, [text, terms]);
  const [open, setOpen] = useState<number | null>(null);
  return (
    <>
      <div
        className={cn("dp-prose", className)}
        dangerouslySetInnerHTML={{ __html: html }}
        onClick={terms ? (e) => {
          const el = (e.target as HTMLElement).closest("[data-term]") as HTMLElement | null;
          if (el) setOpen(Number(el.dataset.term));
        } : undefined}
      />
      {open !== null && GLOSSARY[open] && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 p-3 pb-[calc(72px+env(safe-area-inset-bottom))] sm:items-center sm:pb-3" onClick={() => setOpen(null)}>
          <div className="dp-panel dp-slide w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <div className="text-xs font-bold uppercase tracking-wider text-[var(--dp-cyan)]">Термин</div>
            <div className="mt-1 text-xl font-extrabold">{termTitle(GLOSSARY[open][0][0])}</div>
            <p className="mt-2 text-[15px] leading-relaxed">{GLOSSARY[open][1]}</p>
            <button className="dp-btn dp-btn-ghost mt-4 w-full" onClick={() => setOpen(null)}>Понятно</button>
          </div>
        </div>
      )}
    </>
  );
}

/** Блок кода с подсветкой. */
export function Code({ code, lang, className }: { code: string; lang?: string; className?: string }) {
  const html = useMemo(() => highlight(code, lang), [code, lang]);
  return (
    <pre className={cn("dp-code p-3", className)}>
      <code dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  );
}
