import { toPng, toSvg } from "html-to-image";

/** Trigger a browser download of a data URL via a temporary anchor. */
function downloadDataUrl(dataUrl: string, filename: string): void {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Render an element to PNG and download it. Uses a white background and 2x
 * pixel ratio for a crisp raster image.
 */
export async function exportElementPng(el: HTMLElement, filename: string): Promise<void> {
  const dataUrl = await toPng(el, { backgroundColor: "#ffffff", pixelRatio: 2 });
  downloadDataUrl(dataUrl, filename);
}

/** Render an element to SVG and download it. Uses a white background. */
export async function exportElementSvg(el: HTMLElement, filename: string): Promise<void> {
  const dataUrl = await toSvg(el, { backgroundColor: "#ffffff" });
  downloadDataUrl(dataUrl, filename);
}
