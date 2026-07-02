// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderWithProviders } from "@/test/render";
import { Skeleton, SkeletonText } from "./Skeleton";

describe("Skeleton", () => {
  it("renders an aria-hidden placeholder", () => {
    const { container } = renderWithProviders(<Skeleton />);
    const el = container.firstElementChild as HTMLElement;
    expect(el).toBeTruthy();
    expect(el).toHaveAttribute("aria-hidden", "true");
  });

  it("applies numeric width/height as pixel styles", () => {
    const { container } = renderWithProviders(<Skeleton width={120} height={20} />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.width).toBe("120px");
    expect(el.style.height).toBe("20px");
  });

  it("applies string width values verbatim", () => {
    const { container } = renderWithProviders(<Skeleton width="50%" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.width).toBe("50%");
  });

  it("merges a custom className", () => {
    const { container } = renderWithProviders(<Skeleton className="my-class" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el).toHaveClass("my-class");
  });
});

describe("SkeletonText", () => {
  it("renders the default number of lines (3)", () => {
    const { container } = renderWithProviders(<SkeletonText />);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper).toHaveAttribute("aria-hidden", "true");
    expect(wrapper.children).toHaveLength(3);
  });

  it("renders the requested number of lines", () => {
    const { container } = renderWithProviders(<SkeletonText lines={5} />);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.children).toHaveLength(5);
  });
});
