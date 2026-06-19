import { useRef, useState, type ChangeEvent, type DragEvent, type FormEvent, type KeyboardEvent } from "react";
import { Switch } from "../../components/Switch.tsx";
import { CameraCapture } from "../../components/CameraCapture.tsx";
import { MathInput } from "../../components/MathInput.tsx";
import { Canvas } from "../canvas/Canvas.tsx";
import { toast } from "../../components/toast.ts";
import { isImage, thumbUrl, uploadFiles, type UploadedFile } from "./attachments.ts";

interface Props {
  streaming: boolean;
  onSend: (text: string, attachments: UploadedFile[]) => void;
  onStop: () => void;
  agentMode: boolean;
  setAgentMode: (v: boolean) => void;
  planMode: boolean;
  setPlanMode: (v: boolean) => void;
}

/**
 * The chat composer: message box + mode toggles + attachments. Files upload immediately
 * on pick/drop (optimistic chips, like the legacy UI) and their upload ids ride along
 * with the next send. Enter sends, Shift+Enter newlines, Escape stops a running stream.
 */
export function Composer({ streaming, onSend, onStop, agentMode, setAgentMode, planMode, setPlanMode }: Props) {
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function addFiles(files: File[]) {
    if (files.length === 0) return;
    setUploading(true);
    try {
      const up = await uploadFiles(files);
      setAttachments((a) => [...a, ...up]);
    } catch {
      toast.error("Upload failed — file too large or unsupported.");
    } finally {
      setUploading(false);
    }
  }

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    void addFiles(Array.from(e.target.files ?? []));
    e.target.value = ""; // allow re-picking the same file
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    void addFiles(Array.from(e.dataTransfer.files));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || streaming || uploading) return;
    onSend(text, attachments);
    setInput("");
    setAttachments([]);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit(e);
    } else if (e.key === "Escape" && streaming) {
      onStop();
    }
  }

  return (
    <form className="chat-composer" onSubmit={submit}>
      <div className="chat-modes">
        <Switch checked={agentMode} onChange={setAgentMode} label="Agent" ariaLabel="Agent mode" />
        {agentMode && (
          <Switch checked={planMode} onChange={setPlanMode} label="Plan (read-only)" ariaLabel="Plan mode" />
        )}
        {/* Webcam shot enters the EXACT same path as a picked file (F4). */}
        <CameraCapture label="Take photo" onAccept={(files) => void addFiles(files)} />
        {/* The third input mode (F4): typed math appends delimited LaTeX into the message. */}
        <MathInput onInsert={(eq) => setInput((s) => (s ? s + " " : "") + eq)} />
        {/* The draw surface (F4): a sketch enters the SAME upload path as a photo. */}
        <Canvas onAccept={(files) => void addFiles(files)} />
      </div>

      {attachments.length > 0 && (
        <ul className="chat-attachments" data-testid="attachments">
          {attachments.map((f) => (
            <li key={f.id} className="chat-attachment">
              {isImage(f) && <img src={thumbUrl(f)} alt="" className="chat-attachment-thumb" />}
              <span className="chat-attachment-name">{f.name}</span>
              <button
                type="button"
                className="chat-attachment-remove"
                onClick={() => setAttachments((a) => a.filter((x) => x.id !== f.id))}
                aria-label={`Remove ${f.name}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div
        className={`chat-composer-row ${dragging ? "chat-composer-row--drag" : ""}`.trim()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <input ref={fileRef} type="file" multiple hidden onChange={onPick} aria-label="Attach files" />
        <button
          type="button"
          className="chat-attach"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          title="Attach files — photos of worksheets and handwritten work are fine"
          aria-label="Attach"
        >
          {uploading ? "…" : "+"}
        </button>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={agentMode ? "Ask the agent…" : "Ask anything, or attach a photo of your work…"}
          rows={2}
          aria-label="Message"
        />
        {streaming ? (
          <button type="button" className="chat-stop" onClick={onStop}>
            Stop
          </button>
        ) : (
          <button type="submit" disabled={!input.trim() || uploading}>
            Send
          </button>
        )}
      </div>
    </form>
  );
}
