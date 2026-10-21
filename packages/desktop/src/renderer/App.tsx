import { useEffect } from "react";
import { Console } from "@table-craft/desktop/renderer/console/Console.js";
import { ResultGrid } from "@table-craft/desktop/renderer/grid/ResultGrid.js";
import { useResults } from "@table-craft/desktop/renderer/state/results.js";

export function App() {
  const connect = useResults((state) => state.connect);
  useEffect(() => {
    void connect();
  }, [connect]);

  return (
    <main className="flex h-full flex-col bg-canvas text-ink">
      <Console />
      <ResultGrid />
    </main>
  );
}
