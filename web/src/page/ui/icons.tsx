import type { ComponentChildren } from "preact";

/** Line icons on a 20 by 20 grid. They take their colour from the text and carry no text of their own. */
function Svg({ children, size = 18, fill = "none" }: { children: ComponentChildren; size?: number; fill?: string }) {
  return (
    <svg class="icon" width={size} height={size} viewBox="0 0 20 20" fill={fill} stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export const PauseIcon = () => (
  <Svg>
    <path d="M7 4.5v11M13 4.5v11" />
  </Svg>
);
export const PlayIcon = () => (
  <Svg>
    <path d="M6.5 4.4v11.2l9-5.6z" />
  </Svg>
);
export const SunIcon = () => (
  <Svg>
    <circle cx="10" cy="10" r="3.4" />
    <path d="M10 2.4v1.8M10 15.8v1.8M2.4 10h1.8M15.8 10h1.8M4.6 4.6l1.3 1.3M14.1 14.1l1.3 1.3M4.6 15.4l1.3-1.3M14.1 5.9l1.3-1.3" />
  </Svg>
);
export const MoonIcon = () => (
  <Svg>
    <path d="M15.8 12.2A6.4 6.4 0 0 1 7.8 4.2a6.4 6.4 0 1 0 8 8z" />
  </Svg>
);
export const AutoIcon = () => (
  <Svg>
    <circle cx="10" cy="10" r="6.4" />
    <path d="M10 3.6v12.8" />
    <path d="M10 3.6a6.4 6.4 0 0 1 0 12.8z" fill="currentColor" />
  </Svg>
);
export const PlusIcon = () => (
  <Svg>
    <path d="M10 4.5v11M4.5 10h11" />
  </Svg>
);
export const MinusIcon = () => (
  <Svg>
    <path d="M4.5 10h11" />
  </Svg>
);
export const FitIcon = () => (
  <Svg>
    <path d="M3.5 7V3.5H7M13 3.5h3.5V7M16.5 13v3.5H13M7 16.5H3.5V13" />
  </Svg>
);
export const CloseIcon = () => (
  <Svg>
    <path d="M5 5l10 10M15 5L5 15" />
  </Svg>
);
export const BookIcon = () => (
  <Svg>
    <path d="M4.2 3.8h8.4a2 2 0 0 1 2 2v10.4H6.2a2 2 0 0 1-2-2z" />
    <path d="M6.6 16.2v-3.4h8M7.8 6.8h4.6" />
  </Svg>
);
export const PeopleIcon = () => (
  <Svg>
    <circle cx="7.4" cy="7" r="2.4" />
    <path d="M2.8 15.6c.4-2.6 2.2-4 4.6-4s4.2 1.4 4.6 4" />
    <circle cx="14" cy="7.8" r="1.9" />
    <path d="M13.4 12c2 .1 3.4 1.2 3.8 3.4" />
  </Svg>
);
export const BridgeIcon = () => (
  <Svg>
    <path d="M2.4 8.4h15.2" />
    <path d="M3.8 8.4c.4 4.4 3 6.8 6.2 6.8s5.8-2.4 6.2-6.8" />
    <path d="M5.4 8.4v-2.6M10 8.4V5.4M14.6 8.4V5.8" />
  </Svg>
);
export const CoinIcon = () => (
  <Svg>
    <circle cx="10" cy="10" r="6.6" />
    <path d="M7.6 8.2L10 11l2.4-2.8M10 11v3.4M8 11.8h4M8.4 13.4h3.2" />
  </Svg>
);
export const HourglassIcon = () => (
  <Svg>
    <path d="M5.4 3.6h9.2M5.4 16.4h9.2" />
    <path d="M6.4 3.6c0 3.2 2.2 4.4 3.6 6.4-1.4 2-3.6 3.2-3.6 6.4M13.6 3.6c0 3.2-2.2 4.4-3.6 6.4 1.4 2 3.6 3.2 3.6 6.4" />
  </Svg>
);
export const StartIcon = () => (
  <Svg>
    <path d="M5 4.5v11" />
    <path d="M15 4.6v10.8l-8-5.4z" />
  </Svg>
);
export const ReplayIcon = () => (
  <Svg>
    <path d="M4 10a6 6 0 1 0 1.9-4.4" />
    <path d="M4 3.6v3.2h3.2" />
    <path d="M8.6 7.4v5.2l4.2-2.6z" />
  </Svg>
);
export const CheckIcon = () => (
  <Svg>
    <path d="M4.4 10.4l3.8 3.8 7.4-8" />
  </Svg>
);
export const ClockIcon = () => (
  <Svg>
    <circle cx="10" cy="10" r="6.6" />
    <path d="M10 6v4.4l3 1.8" />
  </Svg>
);
export const SpeedIcon = () => (
  <Svg>
    <path d="M3.4 13.6a6.8 6.8 0 1 1 13.2 0" />
    <path d="M10 13.2l3.4-4.6" />
    <circle cx="10" cy="13.4" r="1.1" />
  </Svg>
);
