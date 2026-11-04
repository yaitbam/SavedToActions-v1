// Small line icons for the new save dialog. They follow the text color.
const base = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

export const CloseIcon = () => <svg {...base}><path d="M6 6l12 12M18 6L6 18" /></svg>;
export const CropIcon = () => <svg {...base}><path d="M6 2v14a2 2 0 002 2h14M2 6h14a2 2 0 012 2v14" /></svg>;
export const SwapIcon = () => <svg {...base}><path d="M4 8h13l-3-3M20 16H7l3 3" /></svg>;
export const LinkIcon = () => <svg {...base}><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" /></svg>;
export const ImageIcon = () => <svg {...base} width={30} height={30}><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="9" cy="10" r="1.6" /><path d="M21 16l-5-5-8 8" /></svg>;
