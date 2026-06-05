import { readBarcodes, prepareZXingModule, type ReaderOptions } from "zxing-wasm/reader";
import zxingReaderWasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";

type DecodeRequest = {
  readonly id: number;
  readonly type: "decode";
  readonly imageData: ImageData;
};

type WorkerRequest = DecodeRequest;

type WorkerResponse =
  | { readonly type: "ready" }
  | { readonly type: "decode"; readonly id: number; readonly ok: true; readonly text: string | null }
  | { readonly type: "error"; readonly id?: number; readonly error: string };

const denseReaderOptions: ReaderOptions = {
  formats: ["QRCode"],
  tryHarder: true,
  tryRotate: true,
  tryInvert: true,
  tryDenoise: false,
  tryDownscale: false,
  maxNumberOfSymbols: 1,
  textMode: "Plain",
};

const fallbackReaderOptions: ReaderOptions = {
  formats: ["QRCode"],
  tryHarder: true,
  tryRotate: true,
  tryInvert: true,
  tryDenoise: true,
  tryDownscale: true,
  maxNumberOfSymbols: 1,
  textMode: "Plain",
};

async function readFirstValidQr(imageData: ImageData): Promise<string | null> {
  for (const options of [denseReaderOptions, fallbackReaderOptions]) {
    const results = await readBarcodes(imageData, options);
    const first = results.find((result) => result.isValid && result.text.length > 0);
    if (first != null) return first.text;
  }
  return null;
}

const moduleReady = prepareZXingModule({
  fireImmediately: true,
  overrides: {
    locateFile(path: string, prefix: string) {
      return path.endsWith(".wasm") ? zxingReaderWasmUrl : `${prefix}${path}`;
    },
  },
});

function describeError(caught: unknown): string {
  return caught instanceof Error ? `${caught.name}: ${caught.message}` : String(caught);
}

moduleReady
  .then(() => {
    self.postMessage({ type: "ready" } satisfies WorkerResponse);
  })
  .catch((caught: unknown) => {
    self.postMessage({ type: "error", error: describeError(caught) } satisfies WorkerResponse);
  });

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (message.type !== "decode") return;

  void (async () => {
    try {
      await moduleReady;
      const text = await readFirstValidQr(message.imageData);
      self.postMessage({
        type: "decode",
        id: message.id,
        ok: true,
        text,
      } satisfies WorkerResponse);
    } catch (caught) {
      self.postMessage({
        type: "error",
        id: message.id,
        error: describeError(caught),
      } satisfies WorkerResponse);
    }
  })();
});
