/**
 * Icon set — hand-tuned 24×24 stroke SVGs so the whole app shares one icon
 * dependency-free module and a consistent 1.7px weight (Apple's UI weight).
 *
 * Every icon is `aria-hidden` by default; a label belongs on the surrounding
 * button, not the glyph.
 */
import type { ReactElement, SVGProps } from 'react';

export type IconName =
  | 'calendar'
  | 'plus'
  | 'close'
  | 'chevronLeft'
  | 'chevronRight'
  | 'chevronDown'
  | 'chevronUp'
  | 'search'
  | 'settings'
  | 'sparkles'
  | 'clock'
  | 'pin'
  | 'repeat'
  | 'bell'
  | 'trash'
  | 'pencil'
  | 'copy'
  | 'check'
  | 'alert'
  | 'info'
  | 'cloud'
  | 'cloudOff'
  | 'device'
  | 'sun'
  | 'moon'
  | 'monitor'
  | 'user'
  | 'logout'
  | 'menu'
  | 'list'
  | 'grid'
  | 'columns'
  | 'square'
  | 'today'
  | 'filter'
  | 'grip'
  | 'send'
  | 'google'
  | 'link'
  | 'unlink'
  | 'refresh'
  | 'shield'
  | 'download'
  | 'arrowRight'
  | 'dot'
  | 'flag'
  | 'notes'
  | 'eye'
  | 'eyeOff';

const PATHS: Record<IconName, ReactElement> = {
  calendar: (
    <>
      <rect x="3" y="4.75" width="18" height="16.25" rx="3.25" />
      <path d="M3 9.5h18M8 2.75v4M16 2.75v4" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  chevronLeft: <path d="M14.5 5.5L8 12l6.5 6.5" />,
  chevronRight: <path d="M9.5 5.5L16 12l-6.5 6.5" />,
  chevronDown: <path d="M5.5 9.5L12 16l6.5-6.5" />,
  chevronUp: <path d="M5.5 14.5L12 8l6.5 6.5" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M15.8 15.8L21 21" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .32 1.77l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.6 1.6 0 0 0-1.77-.32 1.6 1.6 0 0 0-.97 1.47V21a2 2 0 1 1-4 0v-.11a1.6 1.6 0 0 0-1.05-1.46 1.6 1.6 0 0 0-1.77.32l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.6 1.6 0 0 0 4.6 15a1.6 1.6 0 0 0-1.47-.97H3a2 2 0 1 1 0-4h.11A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.32-1.77l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.6 1.6 0 0 0 9 4.6h.08A1.6 1.6 0 0 0 10 3.13V3a2 2 0 1 1 4 0v.11a1.6 1.6 0 0 0 .97 1.47 1.6 1.6 0 0 0 1.77-.32l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.6 1.6 0 0 0 19.4 9v.08a1.6 1.6 0 0 0 1.47.97H21a2 2 0 1 1 0 4h-.11a1.6 1.6 0 0 0-1.49.95Z" />
    </>
  ),
  sparkles: (
    <>
      <path d="M12 3.5l1.7 4.4 4.4 1.7-4.4 1.7L12 15.7l-1.7-4.4L5.9 9.6l4.4-1.7L12 3.5Z" />
      <path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2ZM5.5 14l.6 1.5 1.5.6-1.5.6L5.5 18l-.6-1.3-1.4-.6 1.4-.6.6-1.5Z" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.75" />
      <path d="M12 7.25V12l3.25 2" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.6" />
    </>
  ),
  repeat: (
    <>
      <path d="M4 9.5A3.5 3.5 0 0 1 7.5 6H19" />
      <path d="M16 3l3 3-3 3M20 14.5a3.5 3.5 0 0 1-3.5 3.5H5" />
      <path d="M8 21l-3-3 3-3" />
    </>
  ),
  bell: (
    <>
      <path d="M18 8.75a6 6 0 1 0-12 0c0 5.25-2 6.75-2 6.75h16s-2-1.5-2-6.75Z" />
      <path d="M13.7 19a2 2 0 0 1-3.4 0" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M9.5 7V4.75A.75.75 0 0 1 10.25 4h3.5a.75.75 0 0 1 .75.75V7" />
      <path d="M6.5 7l.8 12.3a1.7 1.7 0 0 0 1.7 1.6h6a1.7 1.7 0 0 0 1.7-1.6L17.5 7" />
      <path d="M10.5 11v6M13.5 11v6" />
    </>
  ),
  pencil: (
    <>
      <path d="M16.5 3.9a2.05 2.05 0 0 1 2.9 2.9L7.6 18.6l-4 1 1-4L16.5 3.9Z" />
      <path d="M14.8 5.6l3.6 3.6" />
    </>
  ),
  copy: (
    <>
      <rect x="8.75" y="8.75" width="12" height="12" rx="2.5" />
      <path d="M15.25 5.5a2 2 0 0 0-2-2h-7.5a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2" />
    </>
  ),
  check: <path d="M4.5 12.5l5 5L20 6.5" />,
  alert: (
    <>
      <path d="M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20.2h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4.5M12 17h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.75" />
      <path d="M12 11v5.5M12 7.75h.01" />
    </>
  ),
  cloud: <path d="M6.5 18.5A4.5 4.5 0 0 1 6 9.6a6 6 0 0 1 11.6 1.5 3.9 3.9 0 0 1-.5 7.4H6.5Z" />,
  cloudOff: (
    <>
      <path d="M17.5 17.5H7a4.4 4.4 0 0 1-1.4-8.6" />
      <path d="M9.6 6.4A6 6 0 0 1 17.6 11a3.9 3.9 0 0 1 2.3 6.1" />
      <path d="M3 3l18 18" />
    </>
  ),
  device: (
    <>
      <rect x="6.5" y="2.75" width="11" height="18.5" rx="2.75" />
      <path d="M10.75 18.5h2.5" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" />
    </>
  ),
  moon: <path d="M20 14.3A8.3 8.3 0 0 1 9.7 4a8.5 8.5 0 1 0 10.3 10.3Z" />,
  monitor: (
    <>
      <rect x="2.75" y="4" width="18.5" height="12.5" rx="2.25" />
      <path d="M8.5 20.5h7M12 16.5v4" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.75" />
      <path d="M4.75 20.25a7.25 7.25 0 0 1 14.5 0" />
    </>
  ),
  logout: (
    <>
      <path d="M9.5 20.25H6a2.25 2.25 0 0 1-2.25-2.25V6A2.25 2.25 0 0 1 6 3.75h3.5" />
      <path d="M15.5 16l4-4-4-4M19.5 12H9.5" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  list: (
    <>
      <path d="M8.5 6.5h12M8.5 12h12M8.5 17.5h12" />
      <path d="M4 6.5h.01M4 12h.01M4 17.5h.01" />
    </>
  ),
  grid: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.75" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.75" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.75" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.75" />
    </>
  ),
  columns: (
    <>
      <rect x="3.5" y="4" width="17" height="16" rx="2.5" />
      <path d="M9.2 4v16M14.8 4v16" />
    </>
  ),
  square: <rect x="4" y="4" width="16" height="16" rx="3" />,
  today: (
    <>
      <rect x="3" y="4.75" width="18" height="16.25" rx="3.25" />
      <path d="M3 9.5h18M8 2.75v4M16 2.75v4" />
      <circle cx="12" cy="15" r="2" fill="currentColor" stroke="none" />
    </>
  ),
  filter: <path d="M3.5 5.5h17l-6.6 7.8v5.4l-3.8 2v-7.4L3.5 5.5Z" />,
  grip: (
    <>
      <circle cx="9" cy="6" r="1.35" fill="currentColor" stroke="none" />
      <circle cx="15" cy="6" r="1.35" fill="currentColor" stroke="none" />
      <circle cx="9" cy="12" r="1.35" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1.35" fill="currentColor" stroke="none" />
      <circle cx="9" cy="18" r="1.35" fill="currentColor" stroke="none" />
      <circle cx="15" cy="18" r="1.35" fill="currentColor" stroke="none" />
    </>
  ),
  send: <path d="M4.5 12 20 4.5 15 20l-3.6-5.6L4.5 12Z" />,
  google: (
    <path
      fill="currentColor"
      stroke="none"
      d="M21.35 11.1H12v2.9h5.35c-.5 2.5-2.6 3.9-5.35 3.9a5.9 5.9 0 0 1 0-11.8c1.5 0 2.85.55 3.9 1.55l2.15-2.15A8.9 8.9 0 0 0 12 3a9 9 0 1 0 0 18c5.2 0 8.6-3.65 8.6-8.8 0-.4-.05-.75-.25-1.1Z"
    />
  ),
  link: (
    <>
      <path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 1 0-5.7-5.7L11.7 6.6" />
      <path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 1 0 5.7 5.7l1.4-1.4" />
    </>
  ),
  unlink: (
    <>
      <path d="M9.5 14.5 7.9 16.1a4 4 0 0 1-5.7-5.7l2.6-2.6a4 4 0 0 1 4.3-1" />
      <path d="M14.5 9.5l1.6-1.6a4 4 0 0 1 5.7 5.7l-2.6 2.6a4 4 0 0 1-4.3 1" />
      <path d="M3 3l18 18" />
    </>
  ),
  refresh: (
    <>
      <path d="M20.5 12a8.5 8.5 0 1 1-2.5-6" />
      <path d="M20.5 3.5V9H15" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 5 5.8v5.4c0 4.3 2.9 8.3 7 9.5 4.1-1.2 7-5.2 7-9.5V5.8L12 3Z" />
      <path d="M9.25 12.25 11.25 14.25 15 10.5" />
    </>
  ),
  download: (
    <>
      <path d="M12 3.75v11.5M7.75 11 12 15.25 16.25 11" />
      <path d="M4.5 19.25h15" />
    </>
  ),
  arrowRight: <path d="M4.5 12h15M13.5 6l6 6-6 6" />,
  dot: <circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none" />,
  flag: (
    <>
      <path d="M5.5 21V4.25" />
      <path d="M5.5 5h11l-1.6 3.4L16.5 12h-11" />
    </>
  ),
  notes: (
    <>
      <rect x="4.5" y="3.5" width="15" height="17" rx="2.5" />
      <path d="M8 8.5h8M8 12h8M8 15.5h5" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.75 12 5.75 21.5 12 21.5 12 18 18.25 12 18.25 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M9.9 5.95A9.6 9.6 0 0 1 12 5.75c6 0 9.5 6.25 9.5 6.25a17 17 0 0 1-3.2 3.9M6.2 7.9A16.8 16.8 0 0 0 2.5 12S6 18.25 12 18.25a9.4 9.4 0 0 0 3.9-.8" />
      <path d="M10 10a2.8 2.8 0 0 0 4 4M3 3l18 18" />
    </>
  ),
};

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
  /** Stroke width; 1.7 matches Apple's UI icons. */
  weight?: number;
  title?: string;
}

export function Icon({ name, size = 20, weight = 1.7, title, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={weight}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {PATHS[name]}
    </svg>
  );
}

/** The multicolour Google "G" used on the sign-in button. */
export function GoogleMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
