// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen } from "../../test/render";
import { makeConnection } from "../../test/fixtures";
import ConnectionCard from "./ConnectionCard";

const noop = () => {};

function renderCard(props: Partial<React.ComponentProps<typeof ConnectionCard>> = {}) {
  return renderWithProviders(
    <ConnectionCard
      connection={makeConnection()}
      onSelect={noop}
      onEdit={noop}
      onDelete={noop}
      onConnect={noop}
      {...props}
    />,
  );
}

describe("ConnectionCard", () => {
  it("renders the connection name and a human driver label", () => {
    renderCard({
      connection: makeConnection({ name: "Prod DB", driver: "postgres" }),
    });
    expect(screen.getByText("Prod DB")).toBeInTheDocument();
    expect(screen.getByText("PostgreSQL")).toBeInTheDocument();
  });

  it("labels each engine distinctly", () => {
    renderCard({ connection: makeConnection({ name: "Cache", driver: "mongodb" }) });
    expect(screen.getByText("MongoDB")).toBeInTheDocument();
  });

  it("calls onSelect with the connection when the card is clicked", async () => {
    const onSelect = vi.fn();
    const connection = makeConnection({ name: "Clickable" });
    const { user } = renderCard({ connection, onSelect });

    await user.click(screen.getByText("Clickable"));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(connection);
  });

  it("opens the menu and fires onEdit", async () => {
    const onEdit = vi.fn();
    const connection = makeConnection();
    const { user, container } = renderCard({ connection, onEdit });

    // The menu toggle is the first <button> in the card header.
    const menuButton = container.querySelector("button");
    expect(menuButton).not.toBeNull();
    await user.click(menuButton!);

    await user.click(screen.getByText(/edit/i));
    expect(onEdit).toHaveBeenCalledWith(connection);
  });
});
