"use client";

type Props = {
  open: boolean;
  onClose: () => void;
};

const SHORTCUTS: { keys: string[]; description: string }[] = [
  { keys: ["j", "↓"], description: "Siguiente conversación" },
  { keys: ["k", "↑"], description: "Conversación anterior" },
  { keys: ["r"], description: "Responder (focus al input)" },
  { keys: ["a"], description: "Archivar conversación" },
  { keys: ["?"], description: "Mostrar esta ayuda" },
  { keys: ["/"], description: "Abrir templates en el input" },
  { keys: ["Esc"], description: "Cerrar menús" },
];

export function ShortcutsCheatsheet({ open, onClose }: Props) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl border border-gray-800 bg-gray-900 p-6 shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">
            Atajos de teclado
          </h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-gray-500 hover:bg-gray-800 hover:text-white"
          >
            ✕
          </button>
        </div>
        <ul className="space-y-2">
          {SHORTCUTS.map((s, i) => (
            <li key={i} className="flex items-center justify-between">
              <span className="text-sm text-gray-300">{s.description}</span>
              <span className="flex gap-1">
                {s.keys.map((k) => (
                  <kbd
                    key={k}
                    className="rounded border border-gray-700 bg-gray-800 px-2 py-0.5 text-xs font-mono text-gray-200"
                  >
                    {k}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-gray-500">
          Los atajos se desactivan mientras escribes en un campo de texto.
        </p>
      </div>
    </div>
  );
}
