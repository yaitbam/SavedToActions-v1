import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const base = { viewBox: "0 0 24 24", width: 24, height: 24, "aria-hidden": true, focusable: false } as const;
const line = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

// Simple hand drawn glyphs that suggest each platform. They are not official logos.
export const InstagramIcon = (p: IconProps) => <svg {...base} {...line} {...p}><rect x="3.5" y="3.5" width="17" height="17" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.3" cy="6.7" r="1" fill="currentColor" stroke="none" /></svg>;
export const XIcon = (p: IconProps) => <svg {...base} fill="currentColor" {...p}><path d="M17.8 3h3L14.2 10.5 22 21h-6.1l-4.8-6.3L5.6 21h-3l7.1-8.1L2.2 3h6.3l4.3 5.8L17.8 3zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5z" /></svg>;
export const LinkedInIcon = (p: IconProps) => <svg {...base} fill="currentColor" {...p}><path d="M4.5 3a1.9 1.9 0 1 0 0 3.8 1.9 1.9 0 0 0 0-3.8zM2.9 8.5h3.2V21H2.9V8.5zm5.2 0h3v1.7h.1c.4-.8 1.5-1.9 3.2-1.9 3.4 0 4 2.2 4 5.1V21h-3.2v-6.8c0-1.6 0-3.7-2.3-3.7s-2.6 1.8-2.6 3.6V21H8.1V8.5z" /></svg>;
export const TikTokIcon = (p: IconProps) => <svg {...base} {...line} strokeWidth={2} {...p}><path d="M14.5 3.5v11.2a3.7 3.7 0 1 1-3.7-3.7" /><path d="M14.5 3.5c.3 2.4 1.8 3.9 4.2 4.1" /></svg>;
export const ScreenshotIcon = (p: IconProps) => <svg {...base} {...line} {...p}><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" /><rect x="8" y="9" width="8" height="6" rx="1.5" /></svg>;
export const HeartIcon = (p: IconProps) => <svg {...base} {...line} {...p}><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z" /></svg>;
export const CommentIcon = (p: IconProps) => <svg {...base} {...line} {...p}><path d="M20 11.5a7.5 7.5 0 0 1-11 6.6L4 19.5l1.4-4.5A7.5 7.5 0 1 1 20 11.5z" /></svg>;
export const SendIcon = (p: IconProps) => <svg {...base} {...line} {...p}><path d="M21 3 10 14M21 3l-6.5 18-4-7-7-4L21 3z" /></svg>;
export const RepostIcon = (p: IconProps) => <svg {...base} {...line} {...p}><path d="m17 3 3 3-3 3M4 11V9a3 3 0 0 1 3-3h13M7 21l-3-3 3-3M20 13v2a3 3 0 0 1-3 3H4" /></svg>;
export const BookmarkIcon = ({ filled = false, ...p }: IconProps & { filled?: boolean }) => <svg {...base} {...line} fill={filled ? "currentColor" : "none"} {...p}><path d="M6.5 3.5h11v17L12 16.5l-5.5 4z" /></svg>;
export const PlayIcon = (p: IconProps) => <svg {...base} fill="currentColor" {...p}><path d="M8 5.5v13l11-6.5z" /></svg>;
export const GoogleIcon = (p: IconProps) => <svg {...base} viewBox="0 0 48 48" {...p}><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" /><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.6z" /><path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.9-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z" /><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" /></svg>;
export const GoogleCalendarIcon =(p: IconProps) => <svg {...base} {...p}><rect x="3" y="4" width="18" height="17" rx="3" fill="#fff" stroke="#CBD5E1" /><path d="M3 7a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v2H3z" fill="#4285F4" /><rect x="3" y="9" width="3" height="9" fill="#34A853" /><rect x="18" y="9" width="3" height="9" fill="#FBBC04" /><path d="M3 18h18v0a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z" fill="#EA4335" /><rect x="8" y="12" width="8" height="2.2" rx="1.1" fill="#334155" /><rect x="8" y="15.6" width="5" height="2.2" rx="1.1" fill="#94A3B8" /></svg>;
