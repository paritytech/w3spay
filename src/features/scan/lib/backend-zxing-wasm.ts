import {
  acquireRearStreamWithRetry,
  classifyStartError,
  stopStream,
} from "@/features/scan/lib/camera-stream.ts";
import {
  ScannerError,
  type ScannerCallbacks,
  type ScannerHandle,
} from "@/features/scan/lib/scanner-types.ts";

type DecodeWorkerResponse =
  | { readonly type: "ready" }
  | { readonly type: "decode"; readonly id: number; readonly ok: true; readonly text: string | null }
  | { readonly type: "error"; readonly id?: number; readonly error: string };

type PendingDecode = {
  readonly resolve: (text: string | null) => void;
  readonly reject: (reason?: unknown) => void;
};

interface WorkerBridge {
  readonly ready: Promise<void>;
  decode(imageData: ImageData): Promise<string | null>;
  rejectAll(reason: unknown): void;
}

type FrameRequestKind = "video" | "animation";

type VideoFrameCallbackMetadata = { readonly mediaTime: number; readonly presentedFrames: number };
type VideoFrameCallback = (now: DOMHighResTimeStamp, metadata: VideoFrameCallbackMetadata) => void;
type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: VideoFrameCallback) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

type DecodeRegionName = "full" | "center-82" | "center-64";

type DecodeRegion = {
  readonly name: DecodeRegionName;
  readonly sourceScale: number;
};

export type DecodeCrop = {
  readonly sx: number;
  readonly sy: number;
  readonly sourceSide: number;
  readonly targetSide: number;
};

interface ActiveWasmScan {
  readonly worker: Worker;
  readonly video: HTMLVideoElement;
  stop(): void;
}

const DECODE_CANVAS_CAP = 2048;
const MAX_DECODE_FPS = 8;
const DECODE_INTERVAL_MS = 1_000 / MAX_DECODE_FPS;
const DECODE_PROBE_LOG_INTERVAL_MS = 2_000;
const DECODE_REGIONS: readonly DecodeRegion[] = [
  { name: "full", sourceScale: 1 },
  { name: "center-82", sourceScale: 0.82 },
  { name: "center-64", sourceScale: 0.64 },
];

let active: ActiveWasmScan | null = null;
let startupQueue: Promise<void> = Promise.resolve();
let nextDecodeId = 0;

function clearHostChildren(host: HTMLElement): void {
  while (host.firstChild) host.removeChild(host.firstChild);
}


function mountVideoInside(host: HTMLElement): HTMLVideoElement {
  const video = document.createElement("video");
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.muted = true;
  video.autoplay = true;
  // Suppress the iOS Safari/WKWebView ▶ overlay on inline <video>s. iOS
  // shows `-webkit-media-controls-start-playback-button` for any video it
  // considers pausable; the scanner is play-only so we strip controls
  // here and back it up with `::-webkit-media-controls-*` rules in CSS.
  video.controls = false;
  video.disablePictureInPicture = true;
  video.setAttribute("disableremoteplayback", "");
  video.setAttribute("width", "100%");
  video.setAttribute("height", "100%");
  host.appendChild(video);
  return video;
}

async function killActive(): Promise<void> {
  if (active == null) return;
  const previous = active;
  active = null;
  previous.stop();
}


function waitForVideoMetadata(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA && video.videoWidth > 0) {
    return Promise.resolve();
  }

  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const cleanup = () => {
    video.removeEventListener("loadedmetadata", handleLoadedMetadata);
    video.removeEventListener("error", handleError);
  };
  const handleLoadedMetadata = () => {
    cleanup();
    resolve();
  };
  const handleError = () => {
    cleanup();
    reject(new Error("camera video metadata failed to load"));
  };
  video.addEventListener("loadedmetadata", handleLoadedMetadata, { once: true });
  video.addEventListener("error", handleError, { once: true });
  return promise;
}

function previewDecodedText(text: string): string {
  const singleLine = text.replace(/\s+/g, " ").trim();
  return singleLine.length <= 160 ? singleLine : `${singleLine.slice(0, 160)}…`;
}


export function computeDecodeCrop(
  videoWidth: number,
  videoHeight: number,
  sourceScale: number,
  canvasCap = DECODE_CANVAS_CAP,
): DecodeCrop {
  const visibleSide = Math.min(videoWidth, videoHeight);
  const sourceSide = Math.max(1, Math.round(visibleSide * sourceScale));
  return {
    sx: Math.round((videoWidth - sourceSide) / 2),
    sy: Math.round((videoHeight - sourceSide) / 2),
    sourceSide,
    targetSide: Math.min(sourceSide, canvasCap),
  };
}
function captureDecodeRegion(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  region: DecodeRegion,
): ImageData {
  const crop = computeDecodeCrop(
    video.videoWidth,
    video.videoHeight,
    region.sourceScale,
  );
  if (canvas.width !== crop.targetSide || canvas.height !== crop.targetSide) {
    canvas.width = crop.targetSide;
    canvas.height = crop.targetSide;
  }
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (context == null) throw new Error("2D canvas context is unavailable");

  context.imageSmoothingEnabled = false;
  context.drawImage(
    video,
    crop.sx,
    crop.sy,
    crop.sourceSide,
    crop.sourceSide,
    0,
    0,
    crop.targetSide,
    crop.targetSide,
  );
  return context.getImageData(0, 0, crop.targetSide, crop.targetSide);
}

function createWorkerBridge(worker: Worker): WorkerBridge {
  const pending = new Map<number, PendingDecode>();
  const ready = Promise.withResolvers<void>();

  worker.addEventListener("message", (event: MessageEvent<DecodeWorkerResponse>) => {
    const message = event.data;
    if (message.type === "ready") {
      ready.resolve();
      return;
    }
    if (message.type === "error") {
      const error = new Error(message.error);
      if (message.id == null) {
        ready.reject(error);
        for (const decode of pending.values()) decode.reject(error);
        pending.clear();
        return;
      }
      const decode = pending.get(message.id);
      if (decode == null) return;
      pending.delete(message.id);
      decode.reject(error);
      return;
    }

    const decode = pending.get(message.id);
    if (decode == null) return;
    pending.delete(message.id);
    decode.resolve(message.text);
  });

  worker.addEventListener("error", (event) => {
    const error = new Error(event.message);
    ready.reject(error);
    for (const decode of pending.values()) decode.reject(error);
    pending.clear();
  });

  return {
    ready: ready.promise,
    decode(imageData: ImageData): Promise<string | null> {
      const id = ++nextDecodeId;
      const deferred = Promise.withResolvers<string | null>();
      pending.set(id, { resolve: deferred.resolve, reject: deferred.reject });
      worker.postMessage({ id, type: "decode", imageData }, [imageData.data.buffer]);
      return deferred.promise;
    },
    rejectAll(reason: unknown): void {
      ready.reject(reason);
      for (const decode of pending.values()) decode.reject(reason);
      pending.clear();
    },
  };
}

/**
 * Drive the decode loop against an already-wired worker bridge.
 *
 * The bridge MUST be created synchronously after `new Worker(...)` so its
 * `message` listener is attached before the worker can post `"ready"`.
 * Otherwise — with the WASM module cached from a prior mount — the worker
 * can finish `prepareZXingModule` and post `"ready"` during the camera
 * startup awaits, and a listener attached later will never see it. The
 * decode loop would then hang forever on `await bridge.ready` and the
 * user sees a frozen viewfinder. See `startZxingWasmScanner`.
 */
function startDecodeLoop(
  video: HTMLVideoElement,
  bridge: WorkerBridge,
  callbacks: ScannerCallbacks,
): () => void {
  const canvas = document.createElement("canvas");
  const videoWithFrameCallback = video as VideoWithFrameCallback;

  let stopped = false;
  let scheduledFrameId: number | null = null;
  let scheduledFrameKind: FrameRequestKind | null = null;
  let lastDecodeAt = 0;
  let decodeAttempts = 0;
  let lastProbeLogAt = 0;
  let lastPayload: string | null = null;
  let regionIndex = 0;

  const cancelScheduledFrame = () => {
    if (scheduledFrameId == null || scheduledFrameKind == null) return;
    if (scheduledFrameKind === "video") {
      videoWithFrameCallback.cancelVideoFrameCallback?.(scheduledFrameId);
    } else {
      cancelAnimationFrame(scheduledFrameId);
    }
    scheduledFrameId = null;
    scheduledFrameKind = null;
  };

  const schedule = () => {
    if (stopped) return;
    if (videoWithFrameCallback.requestVideoFrameCallback != null) {
      scheduledFrameKind = "video";
      scheduledFrameId = videoWithFrameCallback.requestVideoFrameCallback(scanFrame);
      return;
    }
    scheduledFrameKind = "animation";
    scheduledFrameId = requestAnimationFrame((now) => scanFrame(now, { mediaTime: 0, presentedFrames: 0 }));
  };

  const scanFrame = (now: DOMHighResTimeStamp, _metadata: VideoFrameCallbackMetadata) => {
    scheduledFrameId = null;
    scheduledFrameKind = null;
    if (stopped || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      schedule();
      return;
    }
    if (now - lastDecodeAt < DECODE_INTERVAL_MS) {
      schedule();
      return;
    }
    lastDecodeAt = now;

    void (async () => {
      try {
        await bridge.ready;
        const region = DECODE_REGIONS[regionIndex]!;
        regionIndex = (regionIndex + 1) % DECODE_REGIONS.length;
        const decodedText = await bridge.decode(captureDecodeRegion(video, canvas, region));
        if (stopped) return;
        decodeAttempts += 1;
        if (decodedText != null) {
          // Dedup by payload so the scanner keeps reading frames after a
          // bad/unsupported QR — `handleDecoded` does not always navigate
          // away (e.g. an unsupported QR sets `lastBadScan` and stays on
          // the scan screen). Without this we would freeze the loop on
          // the first decode and the user could only "Scan again" by
          // unmounting Scanner entirely.
          if (decodedText !== lastPayload) {
            lastPayload = decodedText;
            console.info("[w3spay/scanner/zxing-wasm] decoded QR", {
              length: decodedText.length,
              region: region.name,
              preview: previewDecodedText(decodedText),
            });
            callbacks.onDecoded(decodedText);
          }
        } else {
          const timestamp = Date.now();
          if (timestamp - lastProbeLogAt >= DECODE_PROBE_LOG_INTERVAL_MS) {
            lastProbeLogAt = timestamp;
            console.info("[w3spay/scanner/zxing-wasm] camera frame read; no QR decoded yet", {
              attempts: decodeAttempts,
              region: region.name,
              source: {
                width: video.videoWidth,
                height: video.videoHeight,
              },
              decodeSide: canvas.width,
            });
          }
        }
      } catch (caught) {
        if (stopped) return;
        const message = caught instanceof Error ? caught.message : String(caught);
        console.warn("[w3spay/scanner/zxing-wasm] decode failed", caught);
        callbacks.onError?.(new ScannerError("scanFailed", message, caught));
      }
      schedule();
    })();
  };

  schedule();

  return () => {
    stopped = true;
    cancelScheduledFrame();
    bridge.rejectAll(new Error("scanner stopped"));
  };
}

export async function startZxingWasmScanner(
  host: HTMLElement,
  callbacks: ScannerCallbacks,
): Promise<ScannerHandle> {
  const myTurn = startupQueue.catch(() => undefined).then(async () => {
    await killActive();
    clearHostChildren(host);
    host.dataset.scannerBackend = "zxing-wasm";

    const streamResult = await acquireRearStreamWithRetry();
    if (!streamResult.ok) {
      clearHostChildren(host);
      delete host.dataset.scannerBackend;
      throw classifyStartError(streamResult.error);
    }

    const video = mountVideoInside(host);
    const worker = new Worker(new URL("./zxing-wasm-worker.ts", import.meta.url), {
      type: "module",
    });
    // Attach the message listener BEFORE any async camera setup. With the
    // WASM module cached from a prior mount, the worker can post `"ready"`
    // within the same task as `video.play()`'s await yield — a listener
    // attached after the await would miss the message and the decode
    // loop would hang forever on `bridge.ready`. This is the "scan
    // again doesn't detect" regression: first scan works because the WASM
    // download dominates, second scan races and loses.
    const bridge = createWorkerBridge(worker);
    let stopDecodeLoop: (() => void) | null = null;

    try {
      video.srcObject = streamResult.stream;
      await video.play();
      await waitForVideoMetadata(video);
      console.info("[w3spay/scanner/zxing-wasm] camera ready", {
        host: { width: host.clientWidth, height: host.clientHeight },
        track: streamResult.stream.getVideoTracks()[0]?.getSettings(),
      });
      stopDecodeLoop = startDecodeLoop(video, bridge, callbacks);
    } catch (caught) {
      bridge.rejectAll(caught);
      worker.terminate();
      stopStream(streamResult.stream);
      clearHostChildren(host);
      delete host.dataset.scannerBackend;
      throw classifyStartError(caught);
    }

    const scan: ActiveWasmScan = {
      worker,
      video,
      stop() {
        stopDecodeLoop?.();
        worker.terminate();
        releaseVideo(video, streamResult.stream);
      },
    };
    active = scan;
    return scan;
  });

  startupQueue = myTurn.then(() => undefined, () => undefined);
  const scan = await myTurn;

  return {
    async stop() {
      if (active !== scan) return;
      active = null;
      scan.stop();
      clearHostChildren(host);
      delete host.dataset.scannerBackend;
    },
  };
}

function releaseVideo(video: HTMLVideoElement, stream: MediaStream): void {
  video.pause();
  video.srcObject = null;
  stopStream(stream);
}
