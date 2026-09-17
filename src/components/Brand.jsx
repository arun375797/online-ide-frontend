export default function Brand({ size = "sm", subtitle = "Jellyfish" }) {
  const large = size === "lg";
  return (
    <div className={`flex min-w-0 items-center gap-2 ${large ? "" : "md:min-w-[120px] md:gap-2.5"}`}>
      <img
        src="/logo.png"
        alt="MyIDE"
        width={large ? 48 : 40}
        height={large ? 48 : 40}
        decoding="async"
        fetchPriority={large ? "high" : "auto"}
        className={`shrink-0 rounded-[10px] object-cover shadow-[0_0_18px_rgba(0,255,255,0.35)] ${large ? "h-12 w-12" : "h-8 w-8 md:h-10 md:w-10"}`}
      />
      <div className="min-w-0 leading-tight">
        <div className={large ? "text-xl font-semibold" : "truncate text-sm font-semibold tracking-wide"}>
          MyIDE
        </div>
        <div className={large ? "text-sm text-cyan" : "hidden text-[10px] font-medium uppercase tracking-[0.16em] text-cyan sm:block"}>
          {subtitle}
        </div>
      </div>
    </div>
  );
}
