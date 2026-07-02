// controls.tsx — putty-ai form & control primitives, ported to ESM from the
// kit (putty-ai-design/ui_kits/putty-app/controls.tsx). Styles live in
// styles/components.css (class names are pa-*).
import type {
  ButtonHTMLAttributes,
  CSSProperties,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

/* ---- shared extra icons (stroke, currentColor, 24 grid) ------------------ */
type IP = { size?: number; sw?: number };
const svg = (size: number, sw: number, kids: ReactNode) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    {kids}
  </svg>
);

export const PAIcons = {
  check: ({ size = 16, sw = 3 }: IP) => svg(size, sw, <polyline points="20 6 9 17 4 12" />),
  x: ({ size = 16, sw = 2.2 }: IP) => svg(size, sw, <><line x1={18} y1={6} x2={6} y2={18} /><line x1={6} y1={6} x2={18} y2={18} /></>),
  chevronDown: ({ size = 12, sw = 2.4 }: IP) => svg(size, sw, <polyline points="6 9 12 15 18 9" />),
  search: ({ size = 15, sw = 2 }: IP) => svg(size, sw, <><circle cx={11} cy={11} r={7} /><path d="M21 21l-4.35-4.35" /></>),
  info: ({ size = 18, sw = 2 }: IP) => svg(size, sw, <><circle cx={12} cy={12} r={9} /><line x1={12} y1={11} x2={12} y2={16} /><circle cx={12} cy={7.5} r={0.6} fill="currentColor" /></>),
  alertTri: ({ size = 18, sw = 2 }: IP) => svg(size, sw, <><path d="M10.3 3.8 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0z" /><line x1={12} y1={9} x2={12} y2={13} /><circle cx={12} cy={16.5} r={0.6} fill="currentColor" /></>),
  alertCircle: ({ size = 18, sw = 2 }: IP) => svg(size, sw, <><circle cx={12} cy={12} r={9} /><line x1={12} y1={8} x2={12} y2={13} /><circle cx={12} cy={16} r={0.6} fill="currentColor" /></>),
  checkCircle: ({ size = 18, sw = 2 }: IP) => svg(size, sw, <><path d="M21 11.5A9 9 0 1 1 12 3a9 9 0 0 1 6 2.3" /><polyline points="21 5 12 14 9 11" /></>),
  trash: ({ size = 15, sw = 2 }: IP) => svg(size, sw, <><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>),
  copy: ({ size = 15, sw = 2 }: IP) => svg(size, sw, <><rect x={9} y={9} width={12} height={12} rx={2} /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>),
  download: ({ size = 15, sw = 2 }: IP) => svg(size, sw, <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1={12} y1={15} x2={12} y2={3} /></>),
  plus: ({ size = 16, sw = 2.4 }: IP) => svg(size, sw, <><line x1={12} y1={5} x2={12} y2={19} /><line x1={5} y1={12} x2={19} y2={12} /></>),
  sparkle: ({ size = 16, sw = 2 }: IP) => svg(size, sw, <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />),
  inbox: ({ size = 22, sw = 1.8 }: IP) => svg(size, sw, <><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.5 5.5 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.5A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.5z" /></>),
  arrowLeft: ({ size = 14, sw = 2.4 }: IP) => svg(size, sw, <><line x1={19} y1={12} x2={5} y2={12} /><polyline points="12 19 5 12 12 5" /></>),
  arrowRight: ({ size = 14, sw = 2.4 }: IP) => svg(size, sw, <><line x1={5} y1={12} x2={19} y2={12} /><polyline points="12 5 19 12 12 19" /></>),
};

/* ---- Button -------------------------------------------------------------- */
type BtnProps = {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
  block?: boolean;
  iconOnly?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>;

export function Button({ variant = "secondary", size = "md", icon, block, iconOnly, children, className = "", ...rest }: BtnProps) {
  const cls = ["pa-btn", `pa-btn-${variant}`, size !== "md" ? `pa-btn-${size}` : "", block ? "pa-btn-block" : "", iconOnly ? "pa-btn-icon" : "", className]
    .filter(Boolean)
    .join(" ");
  return (
    <button className={cls} {...rest}>
      {icon}
      {children}
    </button>
  );
}

/* ---- Field wrapper -------------------------------------------------------- */
export function Field({ label, hint, error, required, htmlFor, children }: { label?: string; hint?: string; error?: string; required?: boolean; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="pa-field">
      {label && (
        <label className="pa-label" htmlFor={htmlFor}>
          {label}
          {required && <span className="pa-req">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <span className="pa-error-text">
          <PAIcons.alertCircle size={13} sw={2.2} />
          {error}
        </span>
      ) : hint ? (
        <span className="pa-hint">{hint}</span>
      ) : null}
    </div>
  );
}

/* ---- Input / Textarea / Select ------------------------------------------- */
type InputProps = { icon?: ReactNode; invalid?: boolean } & InputHTMLAttributes<HTMLInputElement>;
export function Input({ icon, invalid, className = "", ...rest }: InputProps) {
  const input = <input className={`pa-input ${className}`} aria-invalid={invalid || undefined} {...rest} />;
  if (!icon) return input;
  return (
    <div className="pa-input-wrap">
      {icon}
      {input}
    </div>
  );
}
export function Textarea({ invalid, className = "", ...rest }: { invalid?: boolean } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`pa-textarea ${className}`} aria-invalid={invalid || undefined} {...rest} />;
}
export function Select({ children, className = "", ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="pa-select-wrap">
      <select className={`pa-select-native ${className}`} {...rest}>
        {children}
      </select>
      <span className="pa-chev">
        <PAIcons.chevronDown />
      </span>
    </div>
  );
}

/* ---- Checkbox / Radio / Switch ------------------------------------------- */
export function Checkbox({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className={"pa-control" + (disabled ? " is-disabled" : "")}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="pa-check">
        <PAIcons.check size={12} />
      </span>
      {label && <span>{label}</span>}
    </label>
  );
}
export function Radio({ checked, onChange, label, name, disabled }: { checked: boolean; onChange: () => void; label?: ReactNode; name?: string; disabled?: boolean }) {
  return (
    <label className={"pa-control" + (disabled ? " is-disabled" : "")}>
      <input type="radio" name={name} checked={checked} disabled={disabled} onChange={onChange} />
      <span className="pa-radio">
        <span className="pa-dot" />
      </span>
      {label && <span>{label}</span>}
    </label>
  );
}
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className={"pa-control" + (disabled ? " is-disabled" : "")}>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="pa-switch" />
      {label && <span>{label}</span>}
    </label>
  );
}

/* ---- Badge --------------------------------------------------------------- */
export function Badge({ variant = "neutral", dot, children }: { variant?: "neutral" | "accent" | "success" | "warn" | "error" | "solid"; dot?: boolean; children: ReactNode }) {
  const map: Record<string, string> = { neutral: "", accent: "pa-badge-accent", success: "pa-badge-success", warn: "pa-badge-warn", error: "pa-badge-error", solid: "pa-badge-solid" };
  const dotColor: Record<string, string> = { success: "var(--green)", warn: "var(--gold)", error: "var(--error)", accent: "var(--accent)", neutral: "var(--muted)", solid: "#fff" };
  return (
    <span className={`pa-badge ${map[variant]}`}>
      {dot && <span className="pa-dot8" style={{ background: dotColor[variant] } as CSSProperties} />}
      {children}
    </span>
  );
}

/* ---- Avatar -------------------------------------------------------------- */
function initials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
export function Avatar({ name = "?", variant = "coral", size = "md", status, ring }: { name?: string; variant?: "coral" | "slate"; size?: "sm" | "md" | "lg"; status?: boolean; ring?: boolean }) {
  const cls = ["pa-avatar", `pa-avatar-${variant}`, size !== "md" ? `pa-avatar-${size}` : "", status ? "pa-avatar-status" : "", ring ? "pa-avatar-ring" : ""].filter(Boolean).join(" ");
  return (
    <span className={cls} title={name}>
      {initials(name)}
    </span>
  );
}
export function AvatarStack({ names }: { names: string[] }) {
  return (
    <span className="pa-avatar-stack">
      {names.map((n, i) => (
        <Avatar key={i} name={n} variant={i % 2 ? "slate" : "coral"} size="sm" />
      ))}
    </span>
  );
}
