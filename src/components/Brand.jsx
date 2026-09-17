export default function Brand({ size = "sm", subtitle = "Jellyfish" }) {
  const mark = size === "lg" ? "h-12 w-12" : "h-10 w-10";
  return (
    <div className="flex min-w-[120px] items-center gap-2.5">
      <img
        src="/logo.png?v=2"
        alt="MyIDE"
        className={`${mark} rounded-[10px] object-cover shadow-[0_0_18px_rgba(0,255,255,0.35)]`}
      />
      <div className="leading-tight">
        <div className={size === "lg" ? "text-xl font-semibold" : "text-sm font-semibold tracking-wide"}>
          MyIDE
        </div>
        <div className={size === "lg" ? "text-sm text-cyan" : "text-[10px] font-medium uppercase tracking-[0.16em] text-cyan"}>
          {subtitle}
        </div>
      </div>
    </div>
  );
}
