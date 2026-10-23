// Tiny stroke icon set (24px grid, 2px stroke). No icon library: ~12 icons are all the product needs.
const PATHS = {
  logo: 'M5 12.5l4.5 4.5L19 7.5',
  back: 'M15 5l-7 7 7 7',
  upload: 'M12 16V4m0 0l-4.5 4.5M12 4l4.5 4.5M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3',
  file: 'M7 3h7l5 5v12a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1zM14 3v5h5',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  plus: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6L6 18',
  out: 'M10 5H6a1 1 0 00-1 1v12a1 1 0 001 1h4M15 8l4 4-4 4M19 12H9',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4',
  refresh: 'M20 11a8 8 0 00-14.5-4M4 4v4h4M4 13a8 8 0 0014.5 4M20 20v-4h-4',
  download: 'M12 4v12m0 0l-4.5-4.5M12 16l4.5-4.5M4 20h16',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4',
  inbox: 'M4 13l2-8h12l2 8M4 13v6h16v-6M4 13h5l1 2h4l1-2h5',
  clock: 'M12 7v5l3 2M12 3a9 9 0 100 18 9 9 0 000-18z',
};

export default function Icon({ name, size, className }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d={PATHS[name] || ''} />
    </svg>
  );
}
