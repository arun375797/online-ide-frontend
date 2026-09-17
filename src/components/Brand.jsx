export default function Brand({ size = "sm", subtitle = "Jellyfish" }) {
  const px = size === "lg" ? 48 : 40;
  return (
    <div className="flex min-w-[120px] items-center gap-2.5">
      <img
        src="/logo.png"
        alt="MyIDE"
        width={px}
        height={px}
        decoding="async"
        fetchPriority={size === "lg" ? "high" : "auto"}
        className="rounded-[10px] object-cover shadow-[0_0_18px_rgba(0,255,255,0.35)]"
        style={{ width: px, height: px }}
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
