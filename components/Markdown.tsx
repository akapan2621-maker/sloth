"use client";

import { Check, Copy } from "lucide-react";
import { memo, useMemo, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { isSafeExternalLink } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/* Code block                                                                 */
/* -------------------------------------------------------------------------- */

function CodeBlock({
  code,
  language,
}: {
  code: string;
  language: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="group relative overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/80 px-4 py-2">
        <span className="font-mono text-[11px] uppercase tracking-wider text-slate-400">
          {language || "code"}
        </span>
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium text-slate-300 transition hover:bg-slate-800 hover:text-white"
          aria-label="Copy code"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-emerald-400" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 text-[13px] leading-6 text-slate-100">
        <code className="font-mono">{code}</code>
      </pre>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Markdown                                                                   */
/* -------------------------------------------------------------------------- */

interface MarkdownProps {
  children: string;
  className?: string;
}

function MarkdownImpl({ children, className }: MarkdownProps) {
  const components = useMemo(
    () =>
      ({
        pre({ node }: { node?: { children?: Array<Record<string, unknown>> } }) {
          const codeNode = node?.children?.[0] as
            | {
                type?: string;
                properties?: { className?: string[] };
                children?: Array<{ value?: string }>;
              }
            | undefined;

          const raw =
            codeNode?.children?.[0]?.value ??
            (typeof codeNode?.children?.[0] === "string"
              ? String(codeNode.children[0])
              : "");
          const classNameValue = codeNode?.properties?.className?.[0] ?? "";
          const language = /language-([\w+#.-]+)/.exec(classNameValue)?.[1] ?? "";

          return <CodeBlock code={raw.replace(/\n$/, "")} language={language} />;
        },
        code({ children }: { children?: ReactNode }) {
          return (
            <code className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[13px] text-pink-600">
              {children}
            </code>
          );
        },
        a({ href, children }: { href?: string; children?: ReactNode }) {
          const url = href ?? "";
          // Models sometimes invent download links ("sandbox:/mnt/data/x.pptx",
          // relative paths, blob: …). Navigating to them opens a blank page and
          // drops the user out of the workspace, so only real web links are
          // rendered as anchors.
          if (!isSafeExternalLink(url)) {
            return (
              <span
                className="cursor-not-allowed font-medium text-slate-500 underline decoration-dotted decoration-slate-300 underline-offset-2"
                title="ลิงก์นี้ไม่มีไฟล์จริง — โมเดลสร้างลิงก์ขึ้นมาเอง ไม่มีการดาวน์โหลดเกิดขึ้น"
              >
                {children}
              </span>
            );
          }
          return (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-purple-700 underline decoration-purple-200 underline-offset-2 transition hover:decoration-purple-400"
            >
              {children}
            </a>
          );
        },
        table({ children }: { children?: ReactNode }) {
          return (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full border-collapse text-sm">{children}</table>
            </div>
          );
        },
        img({ src, alt }: { src?: string | Blob; alt?: string }) {
          const source = typeof src === "string" ? src : undefined;
          return (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={source}
              alt={alt ?? ""}
              className="max-w-full rounded-xl border border-slate-200"
            />
          );
        },
      }) as unknown as Components,
    [],
  );

  return (
    <div className={className ?? "prose-luxury"}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

export const Markdown = memo(MarkdownImpl);
export default Markdown;
