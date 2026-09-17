import type { FC } from 'hono/jsx';

type IconProps = { class?: string; title?: string };

const base = (props: IconProps) => ({
  class: props.class,
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': 2.2,
  'stroke-linecap': 'round' as const,
  'stroke-linejoin': 'round' as const,
  'aria-hidden': props.title ? undefined : 'true',
  role: props.title ? 'img' : undefined,
});

/** Original brand mark: a circular arrow with a spark, the "reset" symbol. */
export const ResetMark: FC<IconProps> = (p) => (
  <svg {...base(p)} viewBox="0 0 24 24">
    {p.title ? <title>{p.title}</title> : null}
    <path d="M20 12a8 8 0 1 1-2.6-5.9" />
    <path d="M20 4v5h-5" />
    <path d="M12 8.5v3.8l2.4 1.6" />
  </svg>
);

export const GlobeIcon: FC<IconProps> = (p) => (
  <svg {...base(p)}>
    {p.title ? <title>{p.title}</title> : null}
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
  </svg>
);

export const XIcon: FC<IconProps> = (p) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    {p.title ? <title>{p.title}</title> : null}
    <path d="M17.5 3h3.1l-6.8 7.8L21.8 21h-6.3l-4.9-6.4L5 21H1.9l7.3-8.3L1.5 3h6.4l4.4 5.9L17.5 3zm-1.1 16.2h1.7L6.9 4.7H5.1l11.3 14.5z" />
  </svg>
);

export const SunIcon: FC<IconProps> = (p) => (
  <svg {...base(p)}>
    {p.title ? <title>{p.title}</title> : null}
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);

export const MoonIcon: FC<IconProps> = (p) => (
  <svg {...base(p)}>
    {p.title ? <title>{p.title}</title> : null}
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5z" />
  </svg>
);

export const BellIcon: FC<IconProps> = (p) => (
  <svg {...base(p)}>
    {p.title ? <title>{p.title}</title> : null}
    <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16z" />
    <path d="M10 20a2 2 0 0 0 4 0" />
  </svg>
);

export const SendIcon: FC<IconProps> = (p) => (
  <svg {...base(p)}>
    {p.title ? <title>{p.title}</title> : null}
    <path d="M21 3 3 10.5l7.5 2.5L13 20.5 21 3z" />
    <path d="M10.5 13 21 3" />
  </svg>
);

export const RssIcon: FC<IconProps> = (p) => (
  <svg {...base(p)}>
    {p.title ? <title>{p.title}</title> : null}
    <circle cx="5.5" cy="18.5" r="1.6" fill="currentColor" stroke="none" />
    <path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16" />
  </svg>
);

export const CupIcon: FC<IconProps> = (p) => (
  <svg {...base(p)}>
    {p.title ? <title>{p.title}</title> : null}
    <path d="M4 9h12v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V9z" />
    <path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16" />
    <path d="M7 3.5c0 1 .8 1 .8 2s-.8 1-.8 2M11 3.5c0 1 .8 1 .8 2s-.8 1-.8 2" />
  </svg>
);

export const ArrowIcon: FC<IconProps> = (p) => (
  <svg {...base(p)}>
    {p.title ? <title>{p.title}</title> : null}
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export const DownIcon: FC<IconProps> = (p) => (
  <svg {...base(p)}>
    {p.title ? <title>{p.title}</title> : null}
    <path d="M12 5v14M6 13l6 6 6-6" />
  </svg>
);

export const UpIcon: FC<IconProps> = (p) => (
  <svg {...base(p)}>
    {p.title ? <title>{p.title}</title> : null}
    <path d="M12 19V5M6 11l6-6 6 6" />
  </svg>
);

export const CloseIcon: FC<IconProps> = (p) => (
  <svg {...base(p)}>
    {p.title ? <title>{p.title}</title> : null}
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const CheckIcon: FC<IconProps> = (p) => (
  <svg {...base(p)}>
    {p.title ? <title>{p.title}</title> : null}
    <path d="M5 12.5 10 17l9-10" />
  </svg>
);
