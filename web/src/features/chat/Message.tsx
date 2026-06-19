import { useState } from "react";
import { Markdown } from "../../components/Markdown.tsx";
import { copyText } from "../../lib/clipboard.ts";

interface Props {
  role: string;
  content: string;
}

/**
 * One transcript message. Assistant turns render as markdown (code blocks, tables, KaTeX
 * block `$$…$$` math); user turns stay verbatim pre-wrap so nothing they typed is mangled
 * (newlines preserved, prose not markdown-interpreted). A submitted `$$…$$` thus shows as
 * literal text in the user's own bubble — an accepted v1 tradeoff (the MathInput preview
 * rendered it pre-submit; the tutor's reply renders math). A hover copy grabs the raw text.
 */
export function Message({ role, content }: Props) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    if (await copyText(content)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  return (
    <div className={`msg msg--${role}`}>
      <div className="msg-head">
        <span className="msg-role">{role}</span>
        <button type="button" className="msg-copy" onClick={onCopy} aria-label="Copy message">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {role === "assistant" ? (
        <div className="msg-content">
          <Markdown>{content}</Markdown>
        </div>
      ) : (
        <div className="msg-content msg-content--plain">{content}</div>
      )}
    </div>
  );
}
