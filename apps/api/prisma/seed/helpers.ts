import * as argon2 from 'argon2';

/** Deterministic pseudo-random generator so repeated seeds produce the same data. */
export class Random {
  private seed: number;

  constructor(seed = 20260401) {
    this.seed = seed;
  }

  next(): number {
    // Mulberry32 — small, fast and reproducible.
    this.seed |= 0;
    this.seed = (this.seed + 0x6d2b79f5) | 0;
    let t = Math.imul(this.seed ^ (this.seed >>> 15), 1 | this.seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  /** True with the given probability (0-1). */
  chance(probability: number): boolean {
    return this.next() < probability;
  }

  shuffle<T>(items: T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.next() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }
}

const HASH_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

/**
 * Hashing is deliberately expensive, so the seed reuses one hash per distinct
 * password rather than recomputing it for each of the ~120 demo accounts.
 */
const hashCache = new Map<string, string>();

export async function hashPassword(plain: string): Promise<string> {
  const cached = hashCache.get(plain);
  if (cached) return cached;

  const hash = await argon2.hash(plain, HASH_OPTIONS);
  hashCache.set(plain, hash);
  return hash;
}

export async function logStep<T>(label: string, work: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  process.stdout.write(`  ${label.padEnd(52, '.')}`);
  try {
    const result = await work();
    process.stdout.write(` done (${formatDuration(Date.now() - startedAt)})\n`);
    return result;
  } catch (error) {
    process.stdout.write(' FAILED\n');
    throw error;
  }
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function dateOnly(value: string | Date): Date {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

export function isWeekend(date: Date): boolean {
  return date.getUTCDay() === 0;
}

/** Every date between from and to inclusive, skipping Sundays. */
export function schoolDaysBetween(from: Date, to: Date): Date[] {
  const days: Date[] = [];
  let cursor = new Date(from);
  while (cursor <= to) {
    if (!isWeekend(cursor)) days.push(new Date(cursor));
    cursor = addDays(cursor, 1);
  }
  return days;
}

export const FIRST_NAMES_MALE = [
  'Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Reyansh', 'Krishna', 'Ishaan',
  'Shaurya', 'Atharv', 'Advik', 'Rudra', 'Kabir', 'Ayaan', 'Dhruv', 'Rohan',
  'Karthik', 'Nikhil', 'Siddharth', 'Manav', 'Aryan', 'Yash', 'Pranav', 'Harsh',
];

export const FIRST_NAMES_FEMALE = [
  'Aadhya', 'Ananya', 'Diya', 'Ira', 'Myra', 'Pari', 'Anika', 'Navya',
  'Kiara', 'Saanvi', 'Aarohi', 'Riya', 'Ishita', 'Meera', 'Tanvi', 'Sneha',
  'Shreya', 'Kavya', 'Nithya', 'Divya', 'Priya', 'Lakshmi', 'Anjali', 'Nandini',
];

export const LAST_NAMES = [
  'Sharma', 'Verma', 'Patel', 'Reddy', 'Nair', 'Iyer', 'Rao', 'Kulkarni',
  'Desai', 'Gowda', 'Shetty', 'Menon', 'Kumar', 'Singh', 'Gupta', 'Mehta',
  'Joshi', 'Pillai', 'Bhat', 'Naidu',
];

export const PARENT_FIRST_NAMES_MALE = [
  'Rakesh', 'Suresh', 'Mahesh', 'Ramesh', 'Prakash', 'Vinod', 'Sanjay', 'Deepak',
  'Anil', 'Rajesh', 'Manoj', 'Ashok', 'Vijay', 'Sunil', 'Naveen',
];

export const PARENT_FIRST_NAMES_FEMALE = [
  'Lakshmi', 'Sunitha', 'Geetha', 'Radha', 'Kavitha', 'Sushma', 'Vandana', 'Rekha',
  'Sarita', 'Poonam', 'Anitha', 'Shobha', 'Usha', 'Nirmala', 'Vidya',
];

export const OCCUPATIONS = [
  'Software Engineer', 'Doctor', 'Business Owner', 'Teacher', 'Bank Officer',
  'Chartered Accountant', 'Civil Engineer', 'Government Employee', 'Architect',
  'Sales Manager', 'Pharmacist', 'Lawyer', 'Consultant', 'Farmer',
];

export const CITIES = ['Bengaluru', 'Mysuru', 'Mangaluru', 'Hubballi', 'Belagavi'];

export const STREETS = [
  'MG Road', 'Brigade Road', '5th Cross, Jayanagar', 'Residency Road',
  '12th Main, Indiranagar', 'Bannerghatta Road', 'Sarjapur Road', 'Church Street',
];

/** Generates a unique, stable phone number for a seed index. */
export function seedPhone(index: number): string {
  return `+9198${String(45000000 + index).padStart(8, '0')}`;
}

export function slugifyName(first: string, last: string, index: number): string {
  return `${first.toLowerCase()}.${last.toLowerCase()}${index}`;
}
