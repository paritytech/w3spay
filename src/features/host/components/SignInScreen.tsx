// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * Sign-in prompt — shown when the host is reachable but no account is
 * connected. Points the user at the host topbar avatar.
 */

import { Dotted, Eyebrow, Frame, Head, Sub } from "@/shared/components/primitives.tsx";
import { Spinner } from "@/shared/components/Spinner.tsx";

export function SignInScreen() {
  return (
    <Frame>
   
      <Eyebrow>Almost there</Eyebrow>
      <div style={{ marginTop: 16 }}>
        <Head size={44} suffix="W3S Receipts.">
          Welcome to
        </Head>
      </div>
      <Dotted style={{ marginTop: 22 }} />
      <Sub>
        Tap your avatar at the top to continue. We'll pick up automatically
        once you're in.
      </Sub>
      <div style={{ flex: 1 }} />
      <div className="waiting-card">
        <Spinner size={14} />
        <span>Just a moment…</span>
      </div>
    </Frame>
  );
}
