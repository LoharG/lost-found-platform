"use client";

import { useState } from "react";
import clsx from "clsx";
import { ImageOff } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import type { ItemImage } from "@/lib/types";

export function ImageGallery({ images, title }: { images: ItemImage[]; title: string }) {
  const { t } = useI18n();
  const [index, setIndex] = useState(0);

  if (images.length === 0) {
    return (
      <div className="flex aspect-[4/3] items-center justify-center rounded-xl bg-surface-muted text-muted">
        <ImageOff className="size-10" aria-hidden />
        <span className="sr-only">{t("item.noPhotos")}</span>
      </div>
    );
  }

  const current = images[Math.min(index, images.length - 1)];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-xl bg-surface-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={current.url}
          alt={`${title} — ${t("item.photo", { n: index + 1, total: images.length })}`}
          width={current.width}
          height={current.height}
          className="max-h-full max-w-full object-contain"
        />
      </div>
      {images.length > 1 && (
        <ul className="flex gap-2 overflow-x-auto" aria-label={t("item.photo", { n: index + 1, total: images.length })}>
          {images.map((image, i) => (
            <li key={image.id}>
              <button
                type="button"
                onClick={() => setIndex(i)}
                aria-current={i === index}
                aria-label={t("item.photo", { n: i + 1, total: images.length })}
                className={clsx("block size-16 overflow-hidden rounded-lg border-2 sm:size-20", i === index ? "border-primary" : "border-transparent")}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.thumbUrl} alt="" loading="lazy" className="size-full object-cover" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
