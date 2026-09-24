import type { ComponentType, SVGProps } from "react";
import {
  Facebook,
  Github,
  Globe2,
  Instagram,
  Linkedin,
  Link2,
  MessageCircle,
  Music2,
  Youtube,
} from "lucide-react";

export type MindIconName =
  | "none"
  | "instagram"
  | "tiktok"
  | "youtube"
  | "telegram"
  | "whatsapp"
  | "github"
  | "google"
  | "chatgpt"
  | "x"
  | "facebook"
  | "linkedin"
  | "discord"
  | "spotify"
  | "website"
  | "link";

export const MIND_ICONS: { id: MindIconName; label: string }[] = [
  { id: "none", label: "Sem ícone" },
  { id: "instagram", label: "Instagram" },
  { id: "tiktok", label: "TikTok" },
  { id: "youtube", label: "YouTube" },
  { id: "telegram", label: "Telegram" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "github", label: "GitHub" },
  { id: "google", label: "Google" },
  { id: "chatgpt", label: "ChatGPT" },
  { id: "x", label: "X" },
  { id: "facebook", label: "Facebook" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "discord", label: "Discord" },
  { id: "spotify", label: "Spotify" },
  { id: "website", label: "Site" },
  { id: "link", label: "Link" },
];

type IconProps = SVGProps<SVGSVGElement> & { name?: MindIconName | null };

function SvgBase({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      {children}
    </svg>
  );
}

function TikTokIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <SvgBase {...props}>
      <path
        fill="currentColor"
        d="M14.65 3c.22 1.82 1.24 3.18 3.35 3.8v3.08a8.1 8.1 0 0 1-3.3-.76v6.14A5.74 5.74 0 1 1 9.78 9.6v3.13a2.66 2.66 0 1 0 1.84 2.53V3h3.03Z"
      />
    </SvgBase>
  );
}

function TelegramIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <SvgBase {...props}>
      <path
        fill="currentColor"
        d="M21.55 4.19 18.6 18.12c-.22.98-.8 1.22-1.62.76l-4.5-3.32-2.17 2.09c-.24.24-.44.44-.91.44l.32-4.58 8.34-7.54c.36-.32-.08-.5-.56-.18L7.2 12.28 2.76 10.9c-.96-.3-.98-.96.2-1.42l17.36-6.69c.8-.29 1.5.2 1.23 1.4Z"
      />
    </SvgBase>
  );
}

function WhatsAppIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <SvgBase {...props}>
      <path
        fill="currentColor"
        d="M12.04 3a8.77 8.77 0 0 0-7.55 13.23L3 21l4.9-1.44A8.78 8.78 0 1 0 12.04 3Zm0 15.98a7.2 7.2 0 0 1-3.67-.99l-.26-.16-2.9.85.88-2.82-.17-.28a7.18 7.18 0 1 1 6.12 3.4Zm3.95-5.39c-.22-.11-1.28-.63-1.48-.7-.2-.08-.34-.11-.49.1-.14.22-.56.7-.69.85-.13.14-.25.16-.47.05-.22-.11-.91-.34-1.74-1.08a6.52 6.52 0 0 1-1.2-1.5c-.13-.22-.01-.34.1-.45.1-.1.22-.25.32-.38.11-.13.15-.22.22-.36.07-.15.04-.27-.02-.38-.05-.11-.49-1.17-.67-1.6-.17-.42-.35-.37-.49-.38h-.42c-.14 0-.38.05-.58.27-.2.22-.76.74-.76 1.81 0 1.07.78 2.1.89 2.25.11.14 1.53 2.34 3.71 3.28.52.22.92.36 1.24.46.52.16.99.14 1.36.08.42-.06 1.28-.53 1.46-1.04.18-.5.18-.94.13-1.03-.06-.09-.2-.14-.42-.25Z"
      />
    </SvgBase>
  );
}

function GoogleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <SvgBase {...props}>
      <path
        fill="currentColor"
        d="M21.35 12.2c0-.63-.06-1.09-.18-1.57H12v3.34h5.38a4.6 4.6 0 0 1-2 3.02l-.02.11 2.9 2.25.2.02c1.83-1.69 2.89-4.18 2.89-7.17ZM12 21.75c2.62 0 4.82-.86 6.43-2.36l-3.06-2.38c-.82.55-1.92.94-3.37.94a5.85 5.85 0 0 1-5.54-4.05l-.11.01-3.02 2.34-.04.1A9.72 9.72 0 0 0 12 21.75ZM6.46 13.9A5.97 5.97 0 0 1 6.14 12c0-.66.12-1.3.31-1.9v-.12L3.4 7.61l-.1.05A9.78 9.78 0 0 0 2.25 12c0 1.56.37 3.03 1.04 4.34l3.17-2.44ZM12 6.05c1.82 0 3.05.79 3.75 1.44l2.74-2.67C16.81 3.26 14.62 2.25 12 2.25a9.72 9.72 0 0 0-8.71 5.41l3.16 2.44A5.88 5.88 0 0 1 12 6.05Z"
      />
    </SvgBase>
  );
}

function ChatGPTIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <SvgBase {...props}>
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M12.03 2.25a4.47 4.47 0 0 1 4.25 3.08 4.49 4.49 0 0 1 3.57 6.75 4.48 4.48 0 0 1-2.05 6.48 4.49 4.49 0 0 1-6.76 2.07 4.48 4.48 0 0 1-6.46-2.08A4.49 4.49 0 0 1 2.54 12a4.49 4.49 0 0 1 3.58-6.68 4.47 4.47 0 0 1 5.91-3.07Zm.03 2.02a2.48 2.48 0 0 0-2.27 1.48l4.74 2.74v5.46l-2.48 1.43v-5.46L7.32 7.19a2.48 2.48 0 0 0-3.09 3.7l4.72 2.72 4.72-2.72v2.87l-4.72 2.73-4.73-2.73a2.49 2.49 0 0 0 3.09 3.72v-5.46l2.49 1.43v5.46a2.48 2.48 0 0 0 4.96 0v-5.46l4.73-2.73a2.48 2.48 0 0 0-3.1-3.71l-4.72 2.73-4.72-2.73V4.14a2.48 2.48 0 0 0 5.11.13Zm4.2 2.4v5.46l-4.72 2.73-2.49-1.43 4.72-2.73V5.25a2.47 2.47 0 0 1 2.49 1.42Z"
        clipRule="evenodd"
      />
    </SvgBase>
  );
}

function XIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <SvgBase {...props}>
      <path fill="currentColor" d="M4.7 4h3.86l4.28 5.72L17.82 4h1.5l-5.8 6.82L20 20h-3.86l-4.72-6.31L6.05 20H4.54l6.2-7.31L4.7 4Zm3.1 1.1H6.9l9.99 13.8h.9L7.8 5.1Z" />
    </SvgBase>
  );
}

function DiscordIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <SvgBase {...props}>
      <path
        fill="currentColor"
        d="M18.94 5.34a16.3 16.3 0 0 0-4.04-1.25l-.5 1.03a15.1 15.1 0 0 0-4.8 0l-.52-1.03c-1.4.24-2.76.66-4.04 1.25C2.48 9.17 1.78 12.9 2.13 16.58a16.3 16.3 0 0 0 4.96 2.5l1.2-1.65a10.4 10.4 0 0 1-1.89-.91l.46-.35a11.72 11.72 0 0 0 10.28 0l.47.35c-.6.36-1.23.66-1.89.91l1.2 1.65a16.25 16.25 0 0 0 4.95-2.5c.42-4.26-.72-7.95-3.03-11.24ZM8.72 14.33c-1 0-1.82-.92-1.82-2.05 0-1.13.8-2.06 1.82-2.06s1.84.93 1.82 2.06c0 1.13-.8 2.05-1.82 2.05Zm6.56 0c-1 0-1.82-.92-1.82-2.05 0-1.13.8-2.06 1.82-2.06s1.84.93 1.82 2.06c0 1.13-.8 2.05-1.82 2.05Z"
      />
    </SvgBase>
  );
}

function SpotifyIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <SvgBase {...props}>
      <path
        fill="currentColor"
        d="M12 2.5A9.5 9.5 0 1 0 12 21.5 9.5 9.5 0 0 0 12 2.5Zm4.36 13.7a.7.7 0 0 1-.96.23c-2.63-1.6-5.94-1.97-9.84-1.08a.7.7 0 1 1-.31-1.36c4.27-.97 7.93-.55 10.88 1.25.33.2.44.63.23.96Zm1.29-2.87a.87.87 0 0 1-1.2.29c-3.01-1.85-7.6-2.38-11.16-1.3a.87.87 0 1 1-.51-1.67c4.07-1.23 9.13-.64 12.58 1.48.41.25.54.79.29 1.2Zm.11-2.99C14.15 8.2 8.2 8 4.76 9.03a1.04 1.04 0 1 1-.6-1.99c4-1.2 10.58-.95 14.67 1.47a1.04 1.04 0 0 1-1.07 1.83Z"
      />
    </SvgBase>
  );
}

const lucideIcons: Partial<Record<MindIconName, ComponentType<SVGProps<SVGSVGElement>>>> = {
  instagram: Instagram,
  youtube: Youtube,
  github: Github,
  facebook: Facebook,
  linkedin: Linkedin,
  website: Globe2,
  link: Link2,
};

export function BrandIcon({ name, ...props }: IconProps) {
  if (!name || name === "none") return null;

  const LucideIcon = lucideIcons[name];
  if (LucideIcon) return <LucideIcon aria-hidden="true" {...props} />;

  switch (name) {
    case "tiktok":
      return <TikTokIcon {...props} />;
    case "telegram":
      return <TelegramIcon {...props} />;
    case "whatsapp":
      return <WhatsAppIcon {...props} />;
    case "google":
      return <GoogleIcon {...props} />;
    case "chatgpt":
      return <ChatGPTIcon {...props} />;
    case "x":
      return <XIcon {...props} />;
    case "discord":
      return <DiscordIcon {...props} />;
    case "spotify":
      return <SpotifyIcon {...props} />;
    default:
      return <MessageCircle aria-hidden="true" {...props} />;
  }
}

export function getMindIconLabel(name?: MindIconName | null) {
  return MIND_ICONS.find((icon) => icon.id === name)?.label ?? "Sem ícone";
}
