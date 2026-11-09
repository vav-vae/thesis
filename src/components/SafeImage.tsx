import type { CSSProperties } from "react";
import Image from "next/image";

type SafeImageProps = {
  src: string;
  alt: string;
  fill?: boolean;
  width?: number;
  height?: number;
  sizes?: string;
  className?: string;
  priority?: boolean;
  style?: CSSProperties;
};

export default function SafeImage({
  src,
  alt,
  fill,
  width,
  height,
  sizes,
  className,
  priority,
  style,
}: SafeImageProps) {
  // Remote listing photos may be inaccessible to Next's server-side optimizer.
  // Let the browser load those delivery URLs directly, as it did before.
  const optimized = src.startsWith("/");
  if (optimized) {
    return <Image src={src} alt={alt} fill={fill} width={fill ? undefined : width ?? 800} height={fill ? undefined : height ?? 600} sizes={sizes ?? (fill ? "100vw" : undefined)} className={className} preload={priority} style={style} />;
  }
  if (fill) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={alt}
        className={`absolute inset-0 h-full w-full ${className ?? ""}`}
        decoding="async"
        loading={priority ? "eager" : "lazy"}
        style={style}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      className={className}
      decoding="async"
      loading={priority ? "eager" : "lazy"}
      style={style}
    />
  );
}
