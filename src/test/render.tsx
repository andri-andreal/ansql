// renderWithProviders — render a component under the app's root context
// providers (i18n + Toast), the two that App mounts above everything. Add more
// here if a tree under test needs additional context.
//
// Returns the usual RTL result plus a ready `user` (user-event) instance. Also
// re-exports everything from RTL so tests can `import { screen, ... }` from here.

import { render, type RenderOptions } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement, ReactNode } from "react";
import { I18nProvider } from "../i18n";
import { ToastProvider, DialogProvider } from "../components/ui";

function AllProviders({ children }: { children: ReactNode }) {
  return (
    <I18nProvider>
      <ToastProvider>
        <DialogProvider>{children}</DialogProvider>
      </ToastProvider>
    </I18nProvider>
  );
}

export function renderWithProviders(
  ui: ReactElement,
  options?: Omit<RenderOptions, "wrapper">,
) {
  return {
    user: userEvent.setup(),
    ...render(ui, { wrapper: AllProviders, ...options }),
  };
}

export * from "@testing-library/react";
export { userEvent };
