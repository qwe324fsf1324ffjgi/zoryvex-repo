import type { Role } from '@zoryvex/contracts';

const now = '2026-08-01T00:00:00.000Z';

/**
 * Three scenarios for the marketplace gate (docs/ACCEPTANCE_CRITERIA.md):
 * role_platform_lead has 5 real matches (gate OPEN), role_sre has 4 (gate
 * CLOSED, one short), role_secops has 0 (zero-match empty state).
 */
export const ROLES: Role[] = [
  {
    id: 'role_platform_lead',
    employerId: 'emp_northwind',
    launchTrack: 'aws_cloud',
    title: 'Platform Lead',
    seniority: 'senior',
    outcomes: 'Own the AWS landing zone and bring monthly infra spend under a fixed budget.',
    mustHaveWork: [
      'Has designed a multi-account AWS structure',
      'Has reduced infrastructure cost with evidence',
    ],
    constraints: 'Remote, Nigeria-based, immediate to 4-week start',
    status: 'active',
    createdAt: now,
  },
  {
    id: 'role_sre',
    employerId: 'emp_delta',
    launchTrack: 'devops_platform',
    title: 'Site Reliability Engineer',
    seniority: 'mid',
    outcomes: 'Cut deployment lead time and stand up an on-call rotation with a real runbook.',
    mustHaveWork: [
      'Has shipped a CI/CD pipeline improvement',
      'Has written or run an incident runbook',
    ],
    constraints: 'Remote, overlapping 4 hours with WAT',
    status: 'active',
    createdAt: now,
  },
  {
    id: 'role_secops',
    employerId: 'emp_atlas',
    launchTrack: 'cloud_security',
    title: 'Cloud Security Engineer',
    seniority: 'mid',
    outcomes: 'Close the findings from our last cloud security review within one quarter.',
    mustHaveWork: ['Has run or closed findings from a security review'],
    constraints: 'Remote',
    status: 'active',
    createdAt: now,
  },
];
