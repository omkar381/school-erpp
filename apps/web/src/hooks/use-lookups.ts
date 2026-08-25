'use client';

import { useQuery } from '@tanstack/react-query';
import type { Paginated } from '@erp/shared-types';
import { api } from '@/lib/api';

export interface ClassOption {
  id: string;
  name: string;
  level: number;
  studentCount: number;
  sections: Array<{ id: string; name: string; capacity: number; studentCount?: number }>;
}

export interface SectionOption {
  id: string;
  name: string;
  class: { id: string; name: string; level: number };
  studentCount: number;
  availableSeats: number;
}

export interface SubjectOption {
  id: string;
  name: string;
  code: string;
  isElective: boolean;
  colorHex: string | null;
}

export interface TeacherOption {
  id: string;
  employeeId: string;
  firstName: string;
  lastName: string | null;
  fullName?: string;
}

/**
 * Reference data used to populate pickers.
 *
 * Cached hard — classes and subjects change a few times a year, so refetching
 * them on every screen that shows a dropdown is pure waste.
 */
const LOOKUP_STALE_TIME = 10 * 60_000;

export function useClasses(enabled = true) {
  return useQuery({
    queryKey: ['lookup', 'classes'],
    queryFn: () => api.get<Paginated<ClassOption>>('/academics/classes', { limit: 200 }),
    select: (data) => data.items.sort((a, b) => a.level - b.level),
    staleTime: LOOKUP_STALE_TIME,
    enabled,
  });
}

export function useSections(classId?: string) {
  return useQuery({
    queryKey: ['lookup', 'sections', classId ?? 'all'],
    queryFn: () =>
      api.get<SectionOption[]>('/academics/sections', classId ? { classId } : undefined),
    staleTime: LOOKUP_STALE_TIME,
  });
}

export function useSubjects(enabled = true) {
  return useQuery({
    queryKey: ['lookup', 'subjects'],
    queryFn: () => api.get<Paginated<SubjectOption>>('/academics/subjects', { limit: 200 }),
    select: (data) => data.items,
    staleTime: LOOKUP_STALE_TIME,
    enabled,
  });
}

export function useTeachers(enabled = true) {
  return useQuery({
    queryKey: ['lookup', 'teachers'],
    queryFn: () => api.get<TeacherOption[]>('/staff/teachers'),
    staleTime: LOOKUP_STALE_TIME,
    enabled,
  });
}

export function useAcademicYears() {
  return useQuery({
    queryKey: ['lookup', 'academic-years'],
    queryFn: () =>
      api.get<Array<{ id: string; name: string; isCurrent: boolean; startDate: string }>>(
        '/academics/years',
      ),
    staleTime: LOOKUP_STALE_TIME,
  });
}

export function useDepartments() {
  return useQuery({
    queryKey: ['lookup', 'departments'],
    queryFn: () => api.get<Array<{ id: string; name: string; code: string }>>('/academics/departments'),
    staleTime: LOOKUP_STALE_TIME,
  });
}
