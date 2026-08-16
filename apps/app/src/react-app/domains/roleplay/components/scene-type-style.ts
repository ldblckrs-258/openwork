import { Flame, Hand, MapPin, PersonStanding, Shirt, Sparkle, ToyBrick, type LucideIcon } from "lucide-react";

export type SceneTypeStyle = {
  icon: LucideIcon;
  dot: string;
  label: string;
  wash: string;
};

export const SCENE_TYPE_STYLES: Record<string, SceneTypeStyle> = {
  clothes: { icon: Shirt, dot: "bg-amber-9", label: "text-amber-11", wash: "bg-amber-3" },
  pose: { icon: PersonStanding, dot: "bg-iris-9", label: "text-iris-11", wash: "bg-iris-3" },
  location: { icon: MapPin, dot: "bg-cyan-9", label: "text-cyan-11", wash: "bg-cyan-3" },
  climax: { icon: Flame, dot: "bg-crimson-9", label: "text-crimson-11", wash: "bg-crimson-3" },
  body_parts: { icon: Hand, dot: "bg-jade-9", label: "text-jade-11", wash: "bg-jade-3" },
  toys: { icon: ToyBrick, dot: "bg-violet-9", label: "text-violet-11", wash: "bg-violet-3" },
};

export const OTHER_SCENE_STYLE: SceneTypeStyle = {
  icon: Sparkle,
  dot: "bg-slate-9",
  label: "text-slate-11",
  wash: "bg-slate-3",
};

export function styleForType(type: string | null): SceneTypeStyle {
  return (type && SCENE_TYPE_STYLES[type]) || OTHER_SCENE_STYLE;
}
