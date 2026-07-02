// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  renderWithProviders,
  screen,
  waitFor,
} from "@/test/render";

// Mock the provider client so no real network is hit. aiChatStream resolves to
// a reply (and may deliver chunks); aiChat is the non-streaming fallback.
const aiChatStream = vi.fn();
const aiChat = vi.fn();
vi.mock("../../lib/aiProviders", () => ({
  aiChatStream: (...a: unknown[]) => aiChatStream(...a),
  aiChat: (...a: unknown[]) => aiChat(...a),
}));

import { AiAssistantPane } from "./AiAssistantPane";
import type { AiConfig } from "../../lib/aiProviders";

const config: AiConfig = {
  provider: "anthropic",
  model: "claude-opus-4-8",
  apiKey: "sk-test",
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("AiAssistantPane", () => {
  it("shows the not-configured state and routes to settings", async () => {
    const onOpenSettings = vi.fn();
    const { user } = renderWithProviders(
      <AiAssistantPane
        config={config}
        isConfigured={false}
        onOpenSettings={onOpenSettings}
        onClose={() => {}}
      />,
    );

    expect(
      screen.getByText("AI assistant not configured"),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: /Configure AI/ }),
    );
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    // No input rendered in the empty state.
    expect(
      screen.queryByPlaceholderText(/Ask the assistant/),
    ).not.toBeInTheDocument();
  });

  it("renders the empty hint with the provider name when configured", () => {
    renderWithProviders(
      <AiAssistantPane
        config={config}
        isConfigured
        onOpenSettings={() => {}}
        onClose={() => {}}
      />,
    );

    expect(
      screen.getByText(/Your messages are sent to anthropic\./),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/Ask the assistant/),
    ).toBeInTheDocument();
  });

  it("sends a prompt, shows the user turn and the streamed assistant reply", async () => {
    aiChatStream.mockResolvedValue("Here is your answer");
    const { user } = renderWithProviders(
      <AiAssistantPane
        config={config}
        isConfigured
        onOpenSettings={() => {}}
        onClose={() => {}}
      />,
    );

    const box = screen.getByPlaceholderText(/Ask the assistant/);
    await user.type(box, "explain this query");
    await user.click(screen.getByTitle("Send"));

    expect(screen.getByText("explain this query")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("Here is your answer")).toBeInTheDocument();
    });
    expect(aiChatStream).toHaveBeenCalledTimes(1);
    // Input cleared after send.
    expect((box as HTMLTextAreaElement).value).toBe("");
  });

  it("surfaces an error when the provider call fails", async () => {
    aiChatStream.mockRejectedValue(new Error("401 unauthorized"));
    aiChat.mockRejectedValue(new Error("401 unauthorized"));
    const { user } = renderWithProviders(
      <AiAssistantPane
        config={config}
        isConfigured
        onOpenSettings={() => {}}
        onClose={() => {}}
      />,
    );

    const box = screen.getByPlaceholderText(/Ask the assistant/);
    await user.type(box, "hi");
    await user.click(screen.getByTitle("Send"));

    await waitFor(() => {
      expect(screen.getByText("401 unauthorized")).toBeInTheDocument();
    });
  });

  it("offers Insert into editor for fenced SQL and fires onInsertSql", async () => {
    aiChatStream.mockResolvedValue(
      "Sure:\n```sql\nSELECT 1;\n```",
    );
    const onInsertSql = vi.fn();
    const { user } = renderWithProviders(
      <AiAssistantPane
        config={config}
        isConfigured
        onOpenSettings={() => {}}
        onInsertSql={onInsertSql}
        onClose={() => {}}
      />,
    );

    const box = screen.getByPlaceholderText(/Ask the assistant/);
    await user.type(box, "give me sql");
    await user.click(screen.getByTitle("Send"));

    const insertBtn = await screen.findByRole("button", {
      name: /Insert into editor/,
    });
    await user.click(insertBtn);
    expect(onInsertSql).toHaveBeenCalledWith("SELECT 1;");
  });

  it("restores persisted chat turns from localStorage on mount", () => {
    localStorage.setItem(
      "ansql.aiChat",
      JSON.stringify([
        { role: "user", content: "prior question" },
        { role: "assistant", content: "prior answer" },
      ]),
    );
    renderWithProviders(
      <AiAssistantPane
        config={config}
        isConfigured
        onOpenSettings={() => {}}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText("prior question")).toBeInTheDocument();
    expect(screen.getByText("prior answer")).toBeInTheDocument();
  });

  it("invokes onClose from the header close button", async () => {
    const onClose = vi.fn();
    const { user } = renderWithProviders(
      <AiAssistantPane
        config={config}
        isConfigured
        onOpenSettings={() => {}}
        onClose={onClose}
      />,
    );

    await user.click(screen.getByTitle("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
