export default function VisualizerBrand() {
  return (
    <span className="inline-flex shrink-0 items-center gap-2 text-left text-white md:gap-2.5">
      <span className="visualizer-brand-icon grid h-8 w-8 shrink-0 place-items-center rounded-[10px] border border-cyan/50 text-cyan transition group-hover:border-cyan group-hover:bg-cyan/10 md:h-10 md:w-10">
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 19V9m6 10V5m6 14v-7m6 7V3M1 21h22" />
        </svg>
      </span>
      <span className="whitespace-nowrap leading-tight">
        <span className="block text-sm font-semibold tracking-wide">Code</span>
        <span className="block text-[10px] font-medium uppercase tracking-[0.16em] text-cyan">
          Visualizer
        </span>
      </span>
    </span>
  );
}
