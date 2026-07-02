// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Database, Settings } from "lucide-react";
import { renderWithProviders, screen } from "../../test/render";
import Sidebar from "./Sidebar";

const items = [
  { id: "connections", label: "Connections", icon: Database },
  { id: "settings", label: "Settings", icon: Settings },
];

beforeEach(() => {
  localStorage.clear();
});

describe("Sidebar", () => {
  it("renders every nav item label", () => {
    renderWithProviders(
      <Sidebar items={items} activeSection="connections" onSectionChange={() => {}} />,
    );
    expect(screen.getByText("Connections")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("fires onSectionChange with the item id when a nav item is clicked", async () => {
    const onSectionChange = vi.fn();
    const { user } = renderWithProviders(
      <Sidebar items={items} activeSection="connections" onSectionChange={onSectionChange} />,
    );

    await user.click(screen.getByText("Settings"));

    expect(onSectionChange).toHaveBeenCalledTimes(1);
    expect(onSectionChange).toHaveBeenCalledWith("settings");
  });

  it("shows the theme toggle (defaults to light → offers Dark Mode)", () => {
    renderWithProviders(
      <Sidebar items={items} activeSection="connections" onSectionChange={() => {}} />,
    );
    expect(screen.getByText("Dark Mode")).toBeInTheDocument();
  });

  it("toggles the theme label from Dark Mode to Light Mode on click", async () => {
    const { user } = renderWithProviders(
      <Sidebar items={items} activeSection="connections" onSectionChange={() => {}} />,
    );

    await user.click(screen.getByText("Dark Mode"));

    expect(screen.getByText("Light Mode")).toBeInTheDocument();
  });
});
