import { useEffect, useRef, useState } from "react";

interface Props {
  /** Multi-shot mode: capture pages in a loop ("add page" → "done") and accept them
   * all at once — the materials path, where N images become ONE material. */
  multi?: boolean;
  label?: string;
  onAccept: (files: File[]) => void;
}

type Phase = "idle" | "live" | "preview";

/** Camera support requires a secure context (HTTPS or localhost) AND the API itself. */
function cameraSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    window.isSecureContext !== false
  );
}

/**
 * CameraCapture — "the webcam is a scanner" (SPEC F4). A take-photo button that opens a
 * getUserMedia view: capture → preview → retake/accept. Accepted shots are plain `File`s,
 * so they enter the system exactly like picked files (no parallel path). In an insecure
 * context the button is replaced by a setup hint — never a dead control.
 */
export function CameraCapture({ multi = false, label = "Take photo", onAccept }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [shots, setShots] = useState<File[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const shotRef = useRef<File | null>(null);

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  function clearPreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    shotRef.current = null;
  }

  function reset() {
    stopStream();
    clearPreview();
    setShots([]);
    setError(null);
    setPhase("idle");
  }

  // Release the camera + blob URLs if the component unmounts mid-capture.
  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  async function openCamera() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      setPhase("live");
    } catch {
      setError("Could not open the camera — check browser permissions.");
      setPhase("idle");
    }
  }

  // Attach the stream once the <video> exists (it mounts with the "live" phase).
  useEffect(() => {
    const el = videoRef.current;
    if (phase !== "live" || !el || !streamRef.current) return;
    try {
      el.srcObject = streamRef.current;
      const p = el.play?.();
      if (p && typeof p.catch === "function") p.catch(() => undefined);
    } catch {
      /* non-fatal: capture still works once frames arrive */
    }
  }, [phase]);

  function capture() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 960;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setError("Capture failed — canvas unavailable.");
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) {
        setError("Capture failed — try again.");
        return;
      }
      const file = new File([blob], `capture-${shots.length + 1}.png`, { type: "image/png" });
      shotRef.current = file;
      setPreviewUrl(URL.createObjectURL(blob));
      setPhase("preview");
    }, "image/png");
  }

  function retake() {
    clearPreview();
    setPhase("live");
  }

  /** Multi mode: keep this page and go take the next one. (Capture the file locally —
   * the setState updater runs after clearPreview() has nulled the ref.) */
  function addPage() {
    const file = shotRef.current;
    if (file) setShots((s) => [...s, file]);
    clearPreview();
    setPhase("live");
  }

  /** Accept everything captured so far (current preview included). */
  function accept() {
    const all = shotRef.current ? [...shots, shotRef.current] : shots;
    reset();
    if (all.length > 0) onAccept(all);
  }

  if (!cameraSupported()) {
    return (
      <span className="camera-hint" role="note">
        Camera needs HTTPS or localhost — currently served over HTTP.
      </span>
    );
  }

  if (phase === "idle") {
    return (
      <span className="camera">
        <button type="button" className="camera-open" onClick={() => void openCamera()}>
          {label}
        </button>
        {error && <span className="camera-error" role="alert">{error}</span>}
      </span>
    );
  }

  return (
    <div className="camera camera--active" data-testid="camera">
      {phase === "live" && (
        <>
          <video ref={videoRef} className="camera-video" muted playsInline data-testid="camera-video" />
          <div className="camera-actions">
            {multi && shots.length > 0 && (
              <span className="camera-count">
                {shots.length} page{shots.length === 1 ? "" : "s"}
              </span>
            )}
            <button type="button" onClick={capture}>Capture</button>
            {multi && shots.length > 0 && (
              <button type="button" onClick={accept}>Done</button>
            )}
            <button type="button" onClick={reset}>Cancel</button>
          </div>
        </>
      )}
      {phase === "preview" && previewUrl && (
        <>
          <img src={previewUrl} alt="Captured page" className="camera-preview" />
          <div className="camera-actions">
            <button type="button" onClick={retake}>Retake</button>
            {multi ? (
              <>
                <button type="button" onClick={addPage}>Add page</button>
                <button type="button" onClick={accept}>Done</button>
              </>
            ) : (
              <button type="button" onClick={accept}>Use photo</button>
            )}
            <button type="button" onClick={reset}>Cancel</button>
          </div>
        </>
      )}
      {error && <span className="camera-error" role="alert">{error}</span>}
    </div>
  );
}
