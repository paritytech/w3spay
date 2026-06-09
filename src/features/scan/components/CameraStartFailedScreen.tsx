// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * Camera never opened — distinct from `ScanFailedScreen` (blurry receipt).
 * Exists to stop mis-attributing a camera fault to a bad receipt: an
 * unsupported `getUserMedia` constraint or permission edge-case used to land on
 * "Couldn't read", training users to retry angles with no preview ever appearing.
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
  /** Raw scanner error; not shown verbatim, kept for a future "Show details". */
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
        happening, reopen W3S Receipts.
      </Sub>
      <div style={{ flex: 1 }} />
    </Frame>
  );
}
