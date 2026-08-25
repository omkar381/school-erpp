import { notFound } from 'next/navigation';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

/** How long a public page is cached before the API is asked again. */
const REVALIDATE_SECONDS = 300;

export interface PublicSchool {
  slug: string;
  name: string;
  legalName: string | null;
  email: string;
  phone: string;
  alternatePhone: string | null;
  website: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postalCode: string | null;
  latitude: string | null;
  longitude: string | null;
  board: string | null;
  affiliationNumber: string | null;
  establishedYear: number | null;
  principalName: string | null;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  timings: { startTime?: string; endTime?: string } | null;
  menu: Array<{ slug: string; title: string }>;
}

export interface PublicStatistics {
  students: number;
  teachers: number;
  classes: number;
  establishedYear: number | null;
  studentTeacherRatio: number | null;
}

export interface FacultyMember {
  id: string;
  name: string;
  photoUrl: string | null;
  designation: string | null;
  department: string | null;
  qualification: string | null;
  specialization: string | null;
  yearsOfService: number;
}

export interface PublicNotice {
  id: string;
  title: string;
  body: string;
  priority: string;
  isPinned: boolean;
  publishAt: string | null;
}

export interface ContentBlock {
  type: string;
  data?: Record<string, unknown>;
}

export interface PublicPage {
  slug: string;
  title: string;
  content: ContentBlock[];
  excerpt: string | null;
  coverImageUrl: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  ogImageUrl: string | null;
  publishedAt: string | null;
  updatedAt: string;
}

export interface GalleryAlbum {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  coverImageUrl: string | null;
  eventDate: string | null;
  _count?: { photos: number };
  photos?: Array<{ id: string; url: string; caption: string | null }>;
}

export interface PublicEvent {
  id: string;
  title: string;
  description: string | null;
  type: string;
  startAt: string;
  endAt: string | null;
  isAllDay: boolean;
  venue: string | null;
}

interface Envelope<T> {
  success: boolean;
  data: T;
  message?: string;
}

/**
 * Fetches a public endpoint on the server.
 *
 * Returns null rather than throwing, so one unavailable section (an empty
 * gallery, a notices outage) degrades to a hidden block instead of a 500 for
 * the whole page. A missing school is the one case worth a 404, which callers
 * opt into with `required`.
 */
async function get<T>(path: string, options: { required?: boolean } = {}): Promise<T | null> {
  try {
    const response = await fetch(`${BASE}${path}`, {
      next: { revalidate: REVALIDATE_SECONDS },
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      if (response.status === 404 && options.required) notFound();
      return null;
    }

    const payload = (await response.json()) as Envelope<T>;
    return payload.success ? payload.data : null;
  } catch {
    // The API being down must not take the marketing site down with it.
    return null;
  }
}

export function getSchool(slug: string) {
  return get<PublicSchool>(`/website/public/${slug}`, { required: true });
}

export function getStatistics(slug: string) {
  return get<PublicStatistics>(`/website/public/${slug}/statistics`);
}

export function getFaculty(slug: string) {
  return get<FacultyMember[]>(`/website/public/${slug}/faculty`);
}

export function getNotices(slug: string, limit = 10) {
  return get<PublicNotice[]>(`/website/public/${slug}/notices?limit=${limit}`);
}

export function getGallery(slug: string) {
  return get<GalleryAlbum[]>(`/website/public/${slug}/gallery`);
}

export function getAlbum(slug: string, albumSlug: string) {
  return get<GalleryAlbum>(`/website/public/${slug}/gallery/${albumSlug}`);
}

export function getPage(slug: string, pageSlug: string) {
  return get<PublicPage>(`/website/public/${slug}/pages/${pageSlug}`);
}

export function getEvents(slug: string) {
  return get<PublicEvent[]>(`/events/public/${slug}`);
}

export function getSitemap(slug: string) {
  return get<{
    pages: Array<{ slug: string; updatedAt: string }>;
    albums: Array<{ slug: string; updatedAt: string }>;
  }>(`/website/public/${slug}/sitemap`);
}

/** The school whose site is served when no slug is in the path. */
export const DEFAULT_SCHOOL_SLUG = process.env.NEXT_PUBLIC_DEFAULT_SCHOOL ?? null;

export function formatAddress(school: PublicSchool): string {
  return [
    school.addressLine1,
    school.addressLine2,
    school.city,
    school.state,
    school.postalCode,
  ]
    .filter(Boolean)
    .join(', ');
}
