import { useQuery } from "@tanstack/react-query";

import { walletKeys } from "./keys.ts";
import { renderQrSvg } from "@/shared/utils/qr-render.ts";

export function useQrSvg(rawQrText: string | null | undefined): string | null {
  const { data } = useQuery({
    queryKey: walletKeys.qrSvg(rawQrText),
    queryFn: () => renderQrSvg(rawQrText as string),
    enabled: Boolean(rawQrText),
    staleTime: Infinity,
    gcTime: Infinity,
  });
  return data ?? null;
}
