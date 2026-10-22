/**
 * The DYOR Owl: detective owl in a deerstalker and trench coat.
 * Pure SVG so it stays sharp at any size. `blink` animates the eyelids.
 */
type Props = { className?: string; blink?: boolean; title?: string };

const tan = "#b8925a";
const tanD = "#8f6c3c";
const tanDD = "#6b4f2a";

export function Owl({ className, blink = true, title = "DYOR Owl, a detective owl with a magnifying glass" }: Props) {
  return (
    <svg className={className} viewBox="0 0 200 236" role="img" aria-label={title} xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="100" cy="135" rx="82" ry="92" fill="#5d4c96" />
      <ellipse cx="24" cy="160" rx="21" ry="50" fill={tanD} transform="rotate(12 24 160)" />
      <ellipse cx="176" cy="160" rx="21" ry="50" fill={tanD} transform="rotate(-12 176 160)" />
      <path d="M28 152 Q26 226 100 230 Q174 226 172 152 Q142 128 100 132 Q58 128 28 152 Z" fill={tan} />
      <polygon points="76,132 100,178 124,132" fill="#efe3c6" />
      <polygon points="96,140 104,140 106,168 100,176 94,168" fill="#ffb330" />
      <polygon points="60,134 100,178 82,192 48,152" fill={tanD} />
      <polygon points="140,134 100,178 118,192 152,152" fill={tanD} />
      <path d="M33 194 Q100 204 167 194 L166 205 Q100 215 34 205 Z" fill={tanDD} />
      <rect x="91" y="196" width="18" height="14" rx="2" fill="none" stroke="#ffb330" strokeWidth="3" />
      <circle cx="78" cy="218" r="3.5" fill={tanDD} />
      <circle cx="122" cy="218" r="3.5" fill={tanDD} />

      <circle cx="70" cy="96" r="38" fill="#efe3c6" />
      <circle cx="130" cy="96" r="38" fill="#efe3c6" />
      <circle cx="70" cy="96" r="27" fill="#ffb330" />
      <circle cx="130" cy="96" r="27" fill="#ffb330" />
      <g className="owl-pupils">
        <circle cx="66" cy="98" r="13" fill="#0c0f2e" />
        <circle cx="61" cy="92" r="4.5" fill="#fff" />
        <circle cx="126" cy="98" r="13" fill="#0c0f2e" />
        <circle cx="121" cy="92" r="4.5" fill="#fff" />
      </g>
      {blink && (
        <g className="owl-lids" fill="#3f3370">
          <rect x="42" y="68" width="56" height="56" rx="28" />
          <rect x="102" y="68" width="56" height="56" rx="28" />
        </g>
      )}
      <polygon points="90,118 110,118 100,140" fill="#e2861a" />

      <path d="M38 66 Q36 8 100 8 Q164 8 162 66 Z" fill={tan} />
      <path
        d="M54 20 L58 64 M78 10 L80 64 M100 8 V64 M122 10 L120 64 M146 20 L142 64 M42 34 H158 M38 52 H162"
        stroke={tanDD}
        strokeWidth="2.5"
        opacity="0.55"
        fill="none"
      />
      <path d="M30 64 Q100 50 170 64 Q100 84 30 64 Z" fill={tanD} />
      <path d="M100 8 l-16 -6 l2 12 Z M100 8 l16 -6 l-2 12 Z" fill={tanDD} />
      <circle cx="100" cy="8" r="4" fill={tanDD} />
      <path d="M106 76 Q130 64 156 74" fill="none" stroke="#3f3370" strokeWidth="7" strokeLinecap="round" />

      <line x1="155" y1="210" x2="138" y2="230" stroke={tanDD} strokeWidth="8" strokeLinecap="round" />
      <circle cx="168" cy="196" r="18" fill="#f3eedd" opacity="0.22" />
      <circle cx="168" cy="196" r="18" fill="none" stroke="#ffb330" strokeWidth="6" />
      <path d="M160 188 q5 -5 12 -3" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" opacity="0.8" />
      <path
        d="M78 228l-6 7M86 228v8M94 228l6 7M106 228l-6 7M114 228v8M122 228l6 7"
        stroke="#e2861a"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}
