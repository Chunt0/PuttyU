// icons.tsx — putty-ai iconography, ported to ESM from the kit
// (putty-ai-design/ui_kits/putty-app/icons.tsx). Feather/Lucide line-stroke
// set + the putty mascot. Icons inherit currentColor, stroke-width 2, round caps.
import type { ReactNode } from "react";

type IconProps = { size?: number; sw?: number; className?: string };

const S = (size: number, sw: number, children: ReactNode, cls?: string) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={sw}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={cls}
  >
    {children}
  </svg>
);

export const Icons = {
  Menu: ({ size = 18, sw = 2.5, className }: IconProps) =>
    S(size, sw, <><line x1={3} y1={6} x2={21} y2={6} /><line x1={3} y1={12} x2={21} y2={12} /><line x1={3} y1={18} x2={21} y2={18} /></>, className),
  Pencil: ({ size = 15, sw = 2.2, className }: IconProps) =>
    S(size, sw, <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></>, className),
  Search: ({ size = 14, sw = 2, className }: IconProps) =>
    S(size, sw, <><circle cx={11} cy={11} r={7} /><path d="M21 21l-4.35-4.35" /></>, className),
  Chat: ({ size = 14, sw = 2, className }: IconProps) =>
    S(size, sw, <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />, className),
  Brain: ({ size = 14, sw = 2, className }: IconProps) =>
    S(size, sw, <><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" /><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" /></>, className),
  Calendar: ({ size = 14, sw = 2, className }: IconProps) =>
    S(size, sw, <><rect x={3} y={4} width={18} height={18} rx={2} /><line x1={16} y1={2} x2={16} y2={6} /><line x1={8} y1={2} x2={8} y2={6} /><line x1={3} y1={10} x2={21} y2={10} /></>, className),
  Library: ({ size = 14, sw = 2, className }: IconProps) =>
    S(size, sw, <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></>, className),
  Notes: ({ size = 14, sw = 2, className }: IconProps) =>
    S(size, sw, <><path d="M5 3h10l4 4v14H5z" /><path d="M15 3v5h5" /><path d="M8 17.5 15.5 10l2.5 2.5L10.5 20H8z" /></>, className),
  Tasks: ({ size = 14, sw = 2, className }: IconProps) =>
    S(size, sw, <><rect x={3} y={4} width={18} height={18} rx={2} /><line x1={3} y1={10} x2={21} y2={10} /><path d="M9 16l2 2 4-4" /></>, className),
  Theme: ({ size = 14, sw = 2, className }: IconProps) =>
    S(size, sw, <><circle cx={12} cy={12} r={10} /><path d="M12 2a7 7 0 0 0 0 20 4 4 0 0 1 0-8 4 4 0 0 0 0-8" /><circle cx={8} cy={9} r={1.4} fill="currentColor" /><circle cx={15} cy={14} r={1.4} fill="currentColor" /></>, className),
  Tool: ({ size = 12, sw = 2, className }: IconProps) =>
    S(size, sw, <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />, className),
  Chevron: ({ size = 10, sw = 2.6, className }: IconProps) =>
    S(size, sw, <polyline points="6 9 12 15 18 9" />, className),
  Shell: ({ size = 16, sw = 2, className }: IconProps) =>
    S(size, sw, <><polyline points="4 17 10 11 4 5" /><line x1={12} y1={19} x2={20} y2={19} /></>, className),
  Plus: ({ size = 16, sw = 2.4, className }: IconProps) =>
    S(size, sw, <><line x1={12} y1={5} x2={12} y2={19} /><line x1={5} y1={12} x2={19} y2={12} /></>, className),
  Send: ({ size = 15, sw = 2.4, className }: IconProps) =>
    S(size, sw, <><line x1={12} y1={19} x2={12} y2={5} /><polyline points="5 12 12 5 19 12" /></>, className),
  Settings: ({ size = 16, sw = 2, className }: IconProps) =>
    S(size, sw, <><circle cx={12} cy={12} r={3} /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.82 1.17V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15H4.5a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 6 9.4a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 11 4.6V4.5a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 2.82 1.17l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 11h.1a2 2 0 1 1 0 4h-.1z" /></>, className),
  Minimize: ({ size = 14, sw = 2.4, className }: IconProps) =>
    S(size, sw, <line x1={5} y1={19} x2={19} y2={19} />, className),
  Close: ({ size = 14, sw = 2.2, className }: IconProps) =>
    S(size, sw, <><line x1={18} y1={6} x2={6} y2={18} /><line x1={6} y1={6} x2={18} y2={18} /></>, className),
};

// The brand mark — the putty blob mascot. Body inherits currentColor (tint via
// CSS); face stays ink. `Boat` is the kit's legacy name for it.
export const Putty = ({ size = 24, className }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" className={className} aria-hidden>
    <path
      d="M50 5 C61 4 64 -1 73 5 C82 10 78 19 86 24 C95 30 91 40 93 48 C95 57 99 63 92 71 C86 78 77 73 70 81 C63 89 59 96 49 93 C40 90 36 96 28 89 C21 83 26 75 18 70 C9 65 7 56 9 48 C11 40 3 35 10 27 C16 20 25 25 31 17 C37 10 39 6 50 5 Z"
      fill="currentColor"
    />
    <ellipse cx={39} cy={47} rx={6} ry={7.5} fill="#161719" />
    <ellipse cx={62} cy={47} rx={6} ry={7.5} fill="#161719" />
    <circle cx={41} cy={44} r={2} fill="#fff" />
    <circle cx={64} cy={44} r={2} fill="#fff" />
    <path d="M41 63 q4.5 5.5 9 0" fill="none" stroke="#161719" strokeWidth={3.2} strokeLinecap="round" />
  </svg>
);
