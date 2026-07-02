// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen } from "@/test/render";
import { CellViewerPanel } from "./CellViewerPanel";

describe("CellViewerPanel", () => {
  it("shows the column name, header, and the text value in the default Text tab", () => {
    renderWithProviders(
      <CellViewerPanel columnName="bio" value="hello world" onClose={vi.fn()} />
    );
    expect(screen.getByText("bio")).toBeInTheDocument();
    expect(screen.getByText("Cell viewer")).toBeInTheDocument();
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(ta.value).toBe("hello world");
    expect(ta).toHaveAttribute("readonly");
  });

  it("editable Text tab forwards edits via onChange", async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(
      <CellViewerPanel columnName="bio" value="hi" editable onChange={onChange} onClose={vi.fn()} />
    );
    const ta = screen.getByRole("textbox");
    expect(ta).not.toHaveAttribute("readonly");
    await user.type(ta, "!");
    expect(onChange).toHaveBeenCalled();
    const last = vi.mocked(onChange).mock.calls[vi.mocked(onChange).mock.calls.length - 1];
    expect(last[0]).toBe("hi!");
  });

  it("JSON tab pretty-prints valid JSON", async () => {
    const { user } = renderWithProviders(
      <CellViewerPanel columnName="meta" value='{"a":1}' onClose={vi.fn()} />
    );
    await user.click(screen.getByRole("button", { name: "JSON" }));
    expect(screen.getByText(/"a": 1/)).toBeInTheDocument();
  });

  it("JSON tab reports invalid JSON", async () => {
    const { user } = renderWithProviders(
      <CellViewerPanel columnName="meta" value="not json {" onClose={vi.fn()} />
    );
    await user.click(screen.getByRole("button", { name: "JSON" }));
    expect(screen.getByText("Not valid JSON")).toBeInTheDocument();
  });

  it("Hex tab shows an offset-prefixed hex dump", async () => {
    const { user } = renderWithProviders(
      <CellViewerPanel columnName="blob" value="Hi" onClose={vi.fn()} />
    );
    await user.click(screen.getByRole("button", { name: "Hex" }));
    // "Hi" => 48 69 with offset 00000000 and ascii panel |Hi|
    expect(screen.getByText(/00000000/)).toBeInTheDocument();
    expect(screen.getByText(/48 69/)).toBeInTheDocument();
  });

  it("Image tab shows the not-an-image notice for non-image data", async () => {
    const { user } = renderWithProviders(
      <CellViewerPanel columnName="blob" value="just text" onClose={vi.fn()} />
    );
    await user.click(screen.getByRole("button", { name: "Image" }));
    expect(screen.getByText("Not an image")).toBeInTheDocument();
  });

  it("fires onClose from the close button", async () => {
    const onClose = vi.fn();
    const { user } = renderWithProviders(
      <CellViewerPanel columnName="bio" value="x" onClose={onClose} />
    );
    await user.click(screen.getByTitle("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
