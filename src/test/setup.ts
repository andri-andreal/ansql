// Global Vitest setup. Runs for EVERY test file, in that file's environment.
//
// The pure-logic suite (*.test.ts) runs in the `node` environment, where there
// is no `document`; UI tests (*.test.tsx) opt into `jsdom` with a
// `// @vitest-environment jsdom` docblock. We gate all DOM/RTL wiring on a real
// `document` so the node suite is completely unaffected (no slowdown, no DOM
// globals leaking in).

import { afterEach } from "vitest";

if (typeof document !== "undefined") {
  // jest-dom matchers (toBeInTheDocument, toHaveTextContent, ...).
  await import("@testing-library/jest-dom/vitest");

  const { cleanup } = await import("@testing-library/react");
  const { clearMocks } = await import("@tauri-apps/api/mocks");

  // jsdom is missing a handful of browser APIs several components touch.
  const g = globalThis as Record<string, unknown>;
  if (typeof g.ResizeObserver === "undefined") {
    g.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (typeof window.matchMedia === "undefined") {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    })) as typeof window.matchMedia;
  }
  if (typeof Element.prototype.scrollIntoView === "undefined") {
    Element.prototype.scrollIntoView = function scrollIntoView() {};
  }

  // Unmount React trees and clear the Tauri IPC mock between tests so cases
  // stay isolated.
  afterEach(() => {
    cleanup();
    clearMocks();
  });
}
