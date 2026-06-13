import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CameraCapture } from "./CameraCapture.tsx";

/** Wire up a fake camera: getUserMedia resolves a stub stream, canvas capture yields a
 * blob, and object URLs are stubbed (jsdom implements none of these). */
function mockCamera() {
  const stop = vi.fn();
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
  const getUserMedia = vi.fn().mockResolvedValue(stream);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
    cb(new Blob(["png-bytes"], { type: "image/png" }));
  };
  // jsdom's URL lacks the object-URL statics — define them in place (URL itself must
  // stay constructible for everything else).
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: vi.fn(() => "blob:fake"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
  return { getUserMedia, stop };
}

beforeEach(() => {
  // jsdom has no mediaDevices by default — each test sets what it needs.
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CameraCapture", () => {
  it("shows the setup hint instead of a dead button when the camera API is unavailable", () => {
    render(<CameraCapture onAccept={() => undefined} />);
    expect(screen.getByText(/camera needs HTTPS or localhost/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Take photo" })).not.toBeInTheDocument();
  });

  it("captures a photo: open → capture → preview → accept hands back one file", async () => {
    const { getUserMedia, stop } = mockCamera();
    const onAccept = vi.fn();
    render(<CameraCapture onAccept={onAccept} />);

    await userEvent.click(screen.getByRole("button", { name: "Take photo" }));
    expect(getUserMedia).toHaveBeenCalledWith({ video: { facingMode: "environment" } });
    expect(await screen.findByTestId("camera-video")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Capture" }));
    expect(await screen.findByAltText("Captured page")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Use photo" }));
    expect(onAccept).toHaveBeenCalledTimes(1);
    const files = onAccept.mock.calls[0][0] as File[];
    expect(files).toHaveLength(1);
    expect(files[0].type).toBe("image/png");
    expect(stop).toHaveBeenCalled(); // camera released
  });

  it("multi-shot: add page loops, done accepts all pages as one batch", async () => {
    mockCamera();
    const onAccept = vi.fn();
    render(<CameraCapture multi onAccept={onAccept} />);

    await userEvent.click(screen.getByRole("button", { name: "Take photo" }));
    await screen.findByTestId("camera-video");

    // Page 1: capture → add page (back to live).
    await userEvent.click(screen.getByRole("button", { name: "Capture" }));
    await userEvent.click(await screen.findByRole("button", { name: "Add page" }));
    expect(await screen.findByTestId("camera-video")).toBeInTheDocument();
    expect(screen.getByText("1 page")).toBeInTheDocument();

    // Page 2: capture → done.
    await userEvent.click(screen.getByRole("button", { name: "Capture" }));
    await userEvent.click(await screen.findByRole("button", { name: "Done" }));

    expect(onAccept).toHaveBeenCalledTimes(1);
    const files = onAccept.mock.calls[0][0] as File[];
    expect(files.map((f) => f.name)).toEqual(["capture-1.png", "capture-2.png"]);
  });

  it("retake discards the shot and returns to the live view", async () => {
    mockCamera();
    render(<CameraCapture onAccept={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: "Take photo" }));
    await screen.findByTestId("camera-video");
    await userEvent.click(screen.getByRole("button", { name: "Capture" }));
    await userEvent.click(await screen.findByRole("button", { name: "Retake" }));
    expect(await screen.findByTestId("camera-video")).toBeInTheDocument();
    expect(screen.queryByAltText("Captured page")).not.toBeInTheDocument();
  });
});
