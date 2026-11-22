import { setMuted, useMuted } from "../lib/sound";

/** Sound on/off, remembered on this device. */
export function MuteButton({ className = "" }: { className?: string }) {
  const muted = useMuted();
  return (
    <button
      type="button"
      onClick={() => setMuted(!muted)}
      aria-pressed={muted}
      aria-label="Mute sounds"
      title={muted ? "Sound is off" : "Sound is on"}
      className={`inline-flex min-h-9 min-w-9 items-center justify-center px-1 leading-none text-cloud-50/80 hover:text-cloud-50 focus-visible:outline-2 focus-visible:outline-sun-300 ${className}`}
    >
      <span aria-hidden="true">{muted ? "🔇" : "🔊"}</span>
    </button>
  );
}
