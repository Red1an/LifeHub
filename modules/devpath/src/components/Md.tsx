import { useMemo } from "react";
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

const md = new Marked({ gfm: true, breaks: false });
md.use({
  renderer: {
    code({ text, lang }) {
      return `<pre><code class="hljs">${highlight(text, lang)}</code></pre>`;
    },
    // Сырой HTML от нейронки не исполняем — показываем как текст.
    html({ text }) {
      return esc(text);
    },
    link({ href, text }) {
      return `<a href="${esc(href)}" target="_blank" rel="noreferrer">${esc(text)}</a>`;
    },
  },
});

export function Md({ text, className }: { text: string; className?: string }) {
  const html = useMemo(() => md.parse(text || "") as string, [text]);
  return <div className={cn("dp-prose", className)} dangerouslySetInnerHTML={{ __html: html }} />;
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
