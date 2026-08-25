import * as React from 'react';
import type { ContentBlock } from '@/lib/site/api';
import { cn } from '@/lib/utils';

/** Page heading with an optional lead paragraph, used by every section. */
export function SectionHeading({
  eyebrow,
  title,
  lead,
  align = 'left',
  className,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  lead?: React.ReactNode;
  align?: 'left' | 'center';
  className?: string;
}) {
  return (
    <div className={cn('max-w-2xl', align === 'center' && 'mx-auto text-center', className)}>
      {eyebrow ? (
        <p
          className="mb-1.5 text-xs font-semibold uppercase tracking-widest"
          style={{ color: 'var(--site-accent)' }}
        >
          {eyebrow}
        </p>
      ) : null}
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
      {lead ? (
        <p className="mt-3 text-base leading-relaxed text-[var(--color-ink-secondary)]">{lead}</p>
      ) : null}
    </div>
  );
}

export function Section({
  children,
  className,
  muted,
}: {
  children: React.ReactNode;
  className?: string;
  muted?: boolean;
}) {
  return (
    <section className={cn(muted && 'bg-[var(--color-surface-sunken)]', className)}>
      <div className="mx-auto max-w-6xl px-5 py-12 sm:py-16">{children}</div>
    </section>
  );
}

/**
 * Renders a page's content blocks.
 *
 * An unknown block type is skipped rather than thrown on, so an editor saving
 * a newer block cannot take a live page down.
 */
export function ContentBlocks({ blocks }: { blocks: ContentBlock[] }) {
  if (!Array.isArray(blocks) || blocks.length === 0) return null;

  return (
    <div className="space-y-5">
      {blocks.map((block, index) => {
        const data = (block.data ?? {}) as Record<string, unknown>;
        const text = typeof data.text === 'string' ? data.text : '';

        switch (block.type) {
          case 'heading':
            return (
              <h2 key={index} className="pt-4 text-lg font-semibold tracking-tight sm:text-xl">
                {text}
              </h2>
            );

          case 'paragraph':
            return (
              <p
                key={index}
                className="text-base leading-relaxed text-[var(--color-ink-secondary)]"
              >
                {text}
              </p>
            );

          case 'quote':
            return (
              <blockquote
                key={index}
                className="border-l-2 py-1 pl-4 text-base italic leading-relaxed text-[var(--color-ink-secondary)]"
                style={{ borderColor: 'var(--site-accent)' }}
              >
                {text}
                {typeof data.attribution === 'string' ? (
                  <footer className="mt-2 text-sm not-italic text-[var(--color-ink-muted)]">
                    — {data.attribution}
                  </footer>
                ) : null}
              </blockquote>
            );

          case 'list': {
            const items = Array.isArray(data.items) ? (data.items as unknown[]) : [];
            return (
              <ul key={index} className="space-y-1.5">
                {items.map((item, itemIndex) => (
                  <li
                    key={itemIndex}
                    className="flex gap-2 text-base text-[var(--color-ink-secondary)]"
                  >
                    <span
                      className="mt-2 size-1.5 shrink-0 rounded-full"
                      style={{ background: 'var(--site-accent)' }}
                      aria-hidden
                    />
                    {String(item)}
                  </li>
                ))}
              </ul>
            );
          }

          case 'image':
            return typeof data.url === 'string' ? (
              <figure key={index}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={data.url}
                  alt={typeof data.alt === 'string' ? data.alt : ''}
                  className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)]"
                  loading="lazy"
                />
                {typeof data.caption === 'string' ? (
                  <figcaption className="mt-1.5 text-xs text-[var(--color-ink-muted)]">
                    {data.caption}
                  </figcaption>
                ) : null}
              </figure>
            ) : null;

          case 'stats': {
            const items = Array.isArray(data.items)
              ? (data.items as Array<{ label?: string; value?: string }>)
              : [];
            return (
              <dl key={index} className="grid grid-cols-2 gap-4 py-2 sm:grid-cols-4">
                {items.map((item, itemIndex) => (
                  <div key={itemIndex}>
                    <dt className="text-xs uppercase tracking-wide text-[var(--color-ink-muted)]">
                      {item.label}
                    </dt>
                    <dd
                      className="mt-0.5 text-2xl font-semibold tabular"
                      style={{ color: 'var(--site-accent)' }}
                    >
                      {item.value}
                    </dd>
                  </div>
                ))}
              </dl>
            );
          }

          case 'cards': {
            const items = Array.isArray(data.items)
              ? (data.items as Array<{ title?: string; body?: string }>)
              : [];
            return (
              <div key={index} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((item, itemIndex) => (
                  <div
                    key={itemIndex}
                    className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-4"
                  >
                    <h3 className="text-sm font-semibold">{item.title}</h3>
                    <p className="mt-1 text-sm text-[var(--color-ink-secondary)]">{item.body}</p>
                  </div>
                ))}
              </div>
            );
          }

          default:
            return null;
        }
      })}
    </div>
  );
}

/**
 * Shown when a page exists in the menu but has no content yet.
 * Says so plainly rather than rendering an empty screen.
 */
export function PagePlaceholder({ title }: { title: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-strong)] px-6 py-12 text-center">
      <p className="text-sm text-[var(--color-ink-muted)]">
        The {title.toLowerCase()} page has not been written yet.
      </p>
      <p className="mt-1 text-xs text-[var(--color-ink-faint)]">
        School administrators can add content from the portal.
      </p>
    </div>
  );
}
