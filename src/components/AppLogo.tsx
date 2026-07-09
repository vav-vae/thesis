"use client";

type AppLogoProps = {
  className?: string;
  alt?: string;
};

export default function AppLogo({ className = "h-10 w-10", alt = "LiBot Logo" }: AppLogoProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/logo.png?v=2" alt={alt} className={className} decoding="async" />
  );
}
