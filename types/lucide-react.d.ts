declare module "lucide-react" {
  import type { ComponentType, SVGAttributes } from "react";

  interface LucideProps extends SVGAttributes<SVGSVGElement> {
    size?: number | string;
    strokeWidth?: number | string;
    absoluteStrokeWidth?: boolean;
  }

  type LucideIcon = ComponentType<LucideProps>;

  export const ArrowLeft: LucideIcon;
  export const ArrowRight: LucideIcon;
  export const Check: LucideIcon;
  export const ChevronRight: LucideIcon;
  export const CircleHelp: LucideIcon;
  export const Copy: LucideIcon;
  export const Crown: LucideIcon;
  export const Moon: LucideIcon;
  export const Plus: LucideIcon;
  export const RefreshCw: LucideIcon;
  export const Shield: LucideIcon;
  export const Skull: LucideIcon;
  export const Sparkles: LucideIcon;
  export const Sun: LucideIcon;
  export const UsersRound: LucideIcon;
  export const X: LucideIcon;
}

