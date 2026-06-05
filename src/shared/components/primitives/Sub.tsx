/**
 * Sub — short paragraph that follows the <Dotted /> divider beneath a
 * <Head>. Two sizes; `small` is used wherever the screen also carries
 * a meta row or footer below.
 */

import type { ReactNode } from "react";

export interface SubProps {
  children: ReactNode;
  small?: boolean;
}

export function Sub({ children, small }: SubProps) {
  return <p className={small ? "editorial-sub editorial-sub--small" : "editorial-sub"}>{children}</p>;
}
