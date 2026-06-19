import { useRef, useState, type ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import { copyText } from "../lib/clipboard.ts";

/** Fenced code block with a hover copy button (legacy-frontend parity). */
function Pre(props: ComponentProps<"pre">) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    const text = ref.current?.innerText ?? "";
    if (await copyText(text.replace(/\n$/, ""))) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  return (
    <div className="codeblock">
      <button type="button" className="codeblock-copy" onClick={onCopy} aria-label="Copy code">
        {copied ? "Copied" : "Copy"}
      </button>
      <pre ref={ref} {...props} />
    </div>
  );
}

/**
 * Markdown renderer for chat messages (and anywhere else): GitHub-flavored markdown
 * (tables, task lists, strikethrough, autolinks) + syntax-highlighted code blocks +
 * LaTeX math rendered with KaTeX (T5/F4). Only block `$$…$$` math renders; single-dollar
 * inline math is OFF (`singleDollarTextMath: false`) so currency prose like "$5 and $10"
 * stays literal everywhere. KaTeX is bounded (maxSize/maxExpand) against an untrusted-input
 * layout bomb; raw HTML in the source is NOT rendered (react-markdown default) — safe for LLM output.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }]]}
        rehypePlugins={[
          [rehypeHighlight, { detect: false, ignoreMissing: true }],
          [rehypeKatex, { maxSize: 50, maxExpand: 1000 }],
        ]}
        components={{
          pre: Pre,
          // External links open in a new tab; same-page anchors stay put.
          a: ({ href, children: kids, ...rest }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
              {kids}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
