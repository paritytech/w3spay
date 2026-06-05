/**
 * Distinct from `ScanFailedScreen` ("the receipt was too blurry") — this
 * fires when the camera itself never opened. Mis-attributing a camera
 * fault to a bad receipt is the bug this screen exists to prevent: on
 * Android in particular, an unsupported `getUserMedia` constraint or a
 * permission edge-case used to silently land on the "Couldn't read"
 * screen, which trained users to keep retrying with a different angle
 * and no camera preview ever appearing.
 */

import {
  Dotted,
  Eyebrow,
  Frame,
  Head,
  Icon,
  PrimaryButton,
  Sub,
} from "@/shared/components/primitives.tsx";

export interface CameraStartFailedScreenProps {
  onRetry: () => void;
  /**
   * Raw error message from the scanner library. Not shown verbatim — kept
   * on the props so the screen can be re-purposed for "Show details" in
   * the future without changing the call sites.
   */
  errorMessage: string;
}

export function CameraStartFailedScreen({ onRetry }: CameraStartFailedScreenProps) {
  return (
    <Frame
      footer={
        <PrimaryButton onClick={onRetry}>
          <Icon name="refresh-cw" size={16} />
          Retry
        </PrimaryButton>
      }
    >
      <Eyebrow tone="danger">Camera trouble</Eyebrow>
      <div style={{ marginTop: 14 }}>
        <Head size={44} suffix="open the camera." suffixTone="danger">
          Couldn't
        </Head>
      </div>
      <Dotted style={{ marginTop: 22 }} />
      <Sub>
        Close any other app using the camera, then try again. If it keeps
        happening, reopen W3sPay.
      </Sub>
      <div style={{ flex: 1 }} />
    </Frame>
  );
}
