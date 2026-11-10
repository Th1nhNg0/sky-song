import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 18, children, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export const PlayIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M8 5.5v13l10.5-6.5L8 5.5Z" fill="currentColor" stroke="none" />
  </Svg>
);

export const PauseIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="7" y="5" width="3.6" height="14" rx="1" fill="currentColor" stroke="none" />
    <rect x="13.4" y="5" width="3.6" height="14" rx="1" fill="currentColor" stroke="none" />
  </Svg>
);

export const StopIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="6.5" y="6.5" width="11" height="11" rx="1.6" fill="currentColor" stroke="none" />
  </Svg>
);

export const RecordIcon = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="5.4" fill="currentColor" stroke="none" />
  </Svg>
);

export const UndoIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M9 7 4.5 11.5 9 16" />
    <path d="M4.8 11.5h8.4a5.2 5.2 0 0 1 0 10.4H9.5" transform="translate(0,-4)" />
  </Svg>
);

export const RedoIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="m15 7 4.5 4.5L15 16" />
    <path d="M19.2 11.5h-8.4a5.2 5.2 0 0 0 0 10.4h3.7" transform="translate(0,-4)" />
  </Svg>
);

export const LoopIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M17 3.5 20.5 7 17 10.5" />
    <path d="M4 11V9.5A2.5 2.5 0 0 1 6.5 7H20" />
    <path d="M7 20.5 3.5 17 7 13.5" />
    <path d="M20 13v1.5a2.5 2.5 0 0 1-2.5 2.5H4" />
  </Svg>
);

export const MetronomeIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M9 21 11.3 3h1.4L15 21" />
    <path d="m12 13 5.5-6" />
    <path d="M7 21h10" />
    <circle cx="12" cy="13" r="1.1" fill="currentColor" stroke="none" />
  </Svg>
);

export const PlusIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const CloseIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Svg>
);

export const LibraryIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M4 5.5h5v15H4zM10.5 5.5h4v15h-4z" />
    <path d="m16.5 5.8 3.8 1.2-3.6 13.2-3.2-1" />
  </Svg>
);

export const MusicIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M9 18V6.5l10-2.2v11" />
    <circle cx="6.5" cy="18.2" r="2.6" />
    <circle cx="16.5" cy="15.6" r="2.6" />
  </Svg>
);

export const DownloadIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M12 3.5v11M7.5 10.5 12 15l4.5-4.5" />
    <path d="M4.5 17.5v2.2h15v-2.2" />
  </Svg>
);

export const UploadIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M12 14.5v-11M7.5 8 12 3.5 16.5 8" />
    <path d="M4.5 17.5v2.2h15v-2.2" />
  </Svg>
);

export const HelpIcon = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M9.6 9.2a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .9-1 1.7v.4" />
    <circle cx="12" cy="16.7" r=".9" fill="currentColor" stroke="none" />
  </Svg>
);

export const SettingsIcon = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.8v2.3M12 18.9v2.3M4.5 7.3l2 1.2M17.5 15.5l2 1.2M2.8 12h2.3M18.9 12h2.3M4.5 16.7l2-1.2M17.5 8.5l2-1.2" />
  </Svg>
);

export const TrashIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M4.5 6.5h15M9 6.5V4.2h6v2.3M6.5 6.5l1 14h9l1-14" />
    <path d="M10 10v6.5M14 10v6.5" />
  </Svg>
);

export const CopyIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
    <path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
  </Svg>
);

export const CheckIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="m5 12.5 4.5 4.5L19 6.5" />
  </Svg>
);

export const ChevronDownIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="m6 9.5 6 6 6-6" />
  </Svg>
);

export const ArrowUpIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M12 19V5M6.5 10.5 12 5l5.5 5.5" />
  </Svg>
);

export const ArrowDownIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M12 5v14M6.5 13.5 12 19l5.5-5.5" />
  </Svg>
);

export const VolumeIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M4 9.5h3.5L12 5.8v12.4L7.5 14.5H4z" />
    <path d="M15.5 9a4.4 4.4 0 0 1 0 6M18 6.4a8 8 0 0 1 0 11.2" />
  </Svg>
);

export const MuteIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M4 9.5h3.5L12 5.8v12.4L7.5 14.5H4z" />
    <path d="m16 9.5 5 5M21 9.5l-5 5" />
  </Svg>
);

export const KeyboardIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="2.8" y="6" width="18.4" height="12" rx="2" />
    <path d="M6.5 10h.1M10 10h.1M13.5 10h.1M17 10h.1M6.5 13.5h.1M10 13.5h.1M13.5 13.5h.1M17 13.5h.1M8 16.5h8" />
  </Svg>
);

export const StarIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="m12 3.5 2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8L12 3.5Z" />
  </Svg>
);

export const SparkIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M12 2.8c.6 4.8 2.4 6.6 7.2 7.2-4.8.6-6.6 2.4-7.2 7.2-.6-4.8-2.4-6.6-7.2-7.2 4.8-.6 6.6-2.4 7.2-7.2Z" />
    <path d="M18.5 16.5c.2 1.8.9 2.5 2.7 2.7-1.8.2-2.5.9-2.7 2.7-.2-1.8-.9-2.5-2.7-2.7 1.8-.2 2.5-.9 2.7-2.7Z" />
  </Svg>
);

export const AudioIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M4 14v-4M8 17V7M12 20V4M16 17V7M20 14v-4" />
  </Svg>
);

export const PasteIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M9 4.5h6v3H9z" />
    <path d="M8 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-2" />
    <path d="M9 12h6M9 15.5h6" />
  </Svg>
);

export const DuplicateIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="8" y="8" width="11" height="11" rx="2" />
    <path d="M15 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
    <path d="M11.5 13.5h4M13.5 11.5v4" />
  </Svg>
);

export const MoreIcon = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
  </Svg>
);

export const CursorIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M6.5 4.8v12.4l3.1-3.1 2.2 4.5 2.7-1.3-2.2-4.5h4.3L6.5 4.8Z" />
  </Svg>
);

export const FitIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M4 12h16M4 12l3.5-3.5M4 12l3.5 3.5M20 12l-3.5-3.5M20 12l-3.5 3.5M4 5v14M20 5v14" />
  </Svg>
);

export const KeysIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="4" y="5" width="16" height="14" rx="2.5" />
    <path d="M9.3 5v14M14.7 5v14M4 12h16" />
  </Svg>
);

export const SheetIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="3.5" y="5" width="7" height="6" rx="1.6" />
    <rect x="13.5" y="5" width="7" height="6" rx="1.6" />
    <rect x="3.5" y="13" width="7" height="6" rx="1.6" />
    <rect x="13.5" y="13" width="7" height="6" rx="1.6" />
    <circle cx="7" cy="8" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="18" cy="8" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="6" cy="16" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="16" cy="16" r="0.9" fill="currentColor" stroke="none" />
  </Svg>
);

export const PrintIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M7 8V4h10v4" />
    <rect x="4" y="8" width="16" height="8" rx="2" />
    <path d="M7 14h10v6H7z" />
  </Svg>
);

export const InfoIcon = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5.5" />
    <circle cx="12" cy="7.8" r="0.6" fill="currentColor" />
  </Svg>
);
