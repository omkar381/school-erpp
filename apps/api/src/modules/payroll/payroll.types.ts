import { Prisma } from '@prisma/client';

export const PayrollAuditEntity = 'SalaryStructure';

/** An allowance adds to gross pay; a deduction is withheld from it. */
export const COMPONENT_TYPES = ['EARNING', 'DEDUCTION'] as const;
export type ComponentType = (typeof COMPONENT_TYPES)[number];

/**
 * How a component's `value` is read.
 *
 * `PERCENT_OF_BASIC` is always a percentage of the basic salary alone, never of
 * a running gross — otherwise the order the components happen to be listed in
 * would change the payslip.
 */
export const COMPONENT_CALCS = ['FIXED', 'PERCENT_OF_BASIC'] as const;
export type ComponentCalc = (typeof COMPONENT_CALCS)[number];

export interface SalaryComponent {
  name: string;
  type: ComponentType;
  calc: ComponentCalc;
  value: number;
}

/** A component with the rupee figure it works out to for a given basic. */
export interface ResolvedComponent extends SalaryComponent {
  amount: number;
}

export interface SalaryBreakdown {
  basic: number;
  earnings: ResolvedComponent[];
  deductions: ResolvedComponent[];
  totalEarnings: number;
  totalDeductions: number;
  gross: number;
  net: number;
}

/**
 * Component presets offered by the form.
 *
 * Indian payroll is conventional enough that typing these out by hand for every
 * employee is just an opportunity to mistype one, so the form offers the usual
 * set and the school edits what it needs.
 */
export const COMPONENT_PRESETS: SalaryComponent[] = [
  { name: 'Dearness Allowance', type: 'EARNING', calc: 'PERCENT_OF_BASIC', value: 20 },
  { name: 'House Rent Allowance', type: 'EARNING', calc: 'PERCENT_OF_BASIC', value: 40 },
  { name: 'Conveyance Allowance', type: 'EARNING', calc: 'FIXED', value: 1600 },
  { name: 'Medical Allowance', type: 'EARNING', calc: 'FIXED', value: 1250 },
  { name: 'Special Allowance', type: 'EARNING', calc: 'FIXED', value: 0 },
  { name: 'Provident Fund', type: 'DEDUCTION', calc: 'PERCENT_OF_BASIC', value: 12 },
  { name: 'Professional Tax', type: 'DEDUCTION', calc: 'FIXED', value: 200 },
  { name: 'ESI', type: 'DEDUCTION', calc: 'PERCENT_OF_BASIC', value: 0.75 },
  { name: 'Income Tax (TDS)', type: 'DEDUCTION', calc: 'FIXED', value: 0 },
];

/** Rounds to paise, so repeated percentage maths cannot drift. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Works out what a salary structure actually pays.
 *
 * This is the single place the arithmetic lives: the service uses it when
 * storing a structure and the register uses it when reporting one, so a stored
 * `netSalary` and a displayed one can never disagree.
 */
export function computeBreakdown(
  basicSalary: number,
  components: SalaryComponent[],
): SalaryBreakdown {
  const basic = round2(basicSalary);

  const resolve = (component: SalaryComponent): ResolvedComponent => ({
    ...component,
    amount:
      component.calc === 'PERCENT_OF_BASIC'
        ? round2((basic * component.value) / 100)
        : round2(component.value),
  });

  const earnings = components.filter((c) => c.type === 'EARNING').map(resolve);
  const deductions = components.filter((c) => c.type === 'DEDUCTION').map(resolve);

  const totalEarnings = round2(earnings.reduce((sum, c) => sum + c.amount, 0));
  const totalDeductions = round2(deductions.reduce((sum, c) => sum + c.amount, 0));

  const gross = round2(basic + totalEarnings);

  return {
    basic,
    earnings,
    deductions,
    totalEarnings,
    totalDeductions,
    gross,
    net: round2(gross - totalDeductions),
  };
}

/** Reads the components JSON column back into typed components. */
export function parseComponents(value: Prisma.JsonValue | null | undefined): SalaryComponent[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;

    const name = typeof record.name === 'string' ? record.name : null;
    const type = record.type as ComponentType;
    const calc = record.calc as ComponentCalc;
    const numeric = Number(record.value);

    if (!name || !COMPONENT_TYPES.includes(type) || !COMPONENT_CALCS.includes(calc)) return [];
    if (!Number.isFinite(numeric)) return [];

    return [{ name, type, calc, value: numeric }];
  });
}
