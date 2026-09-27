import { ChordDiagram } from "./ChordDiagram";

export function ChordBottomSheet({
  chord,
  onClose,
}: {
  chord: string | null;
  onClose: () => void;
}) {
  if (!chord) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xs rounded-t-2xl bg-white dark:bg-zinc-900 p-6 pb-8 sm:rounded-2xl sm:pb-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <span className="text-lg font-semibold">{chord}</span>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 text-sm"
            aria-label="Закрыть"
          >
            ✕
          </button>
        </div>
        <div className="flex justify-center">
          <ChordDiagram chord={chord} size={180} />
        </div>
      </div>
    </div>
  );
}
