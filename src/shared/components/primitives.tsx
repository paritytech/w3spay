/**
 * Shared editorial primitives barrel.
 *
 * One file per primitive lives under `primitives/`; this barrel re-exports
 * them so callers stay flat (`import { Frame, Head } from "@/ui/ui/primitives"`).
 *
 * Mirrors `apps/w3spay-admin/src/ui/primitives.tsx` shape — the surface is
 * different (no admin-only `AFrame`/`ARail`/`ATabs`) because w3spay's
 * primitives are editorial-grounded rather than admin-grounded, but the
 * file layout is the same: per-primitive files + this barrel.
 *
 * CSS classes referenced by the primitives live in `../styles.css`.
 */

export { Dotted } from "@/shared/components/primitives/Dotted.tsx";
export { Eyebrow, type EyebrowProps, type EyebrowTone } from "@/shared/components/primitives/Eyebrow.tsx";
export { Frame, type FrameProps, Rail } from "@/shared/components/primitives/Frame.tsx";
export { Head, type HeadProps } from "@/shared/components/primitives/Head.tsx";
export {
  Icon,
  ICONS,
  type IconName,
  type IconProps,
} from "@/shared/components/primitives/Icon.tsx";
export { Mark, type MarkProps } from "@/shared/components/primitives/Mark.tsx";
export { MetaRow, type MetaRowProps } from "@/shared/components/primitives/MetaRow.tsx";
export { Step, type StepProps } from "@/shared/components/primitives/Step.tsx";
export { Sub, type SubProps } from "@/shared/components/primitives/Sub.tsx";
export {
  IconButton,
  type IconButtonProps,
  PrimaryButton,
  SecondaryButton,
  type ButtonProps,
} from "@/shared/components/primitives/buttons.tsx";
