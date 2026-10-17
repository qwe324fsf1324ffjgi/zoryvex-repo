import { z } from 'zod';
import type { LaunchTrack } from './domain';

/**
 * What verification is actually about.
 *
 * The engine used to bind an assessment to a job title: a task carried
 * `track: 'aws_cloud'` and you found it by asking for that track. That is
 * backwards, and reading the thirty tasks makes it obvious. "Give a function
 * the least access it can do its job with" sat under aws_cloud, "Let a vendor
 * into your account without letting in their other customers" under
 * cloud-security, and "Let CI deploy without a key that never expires" under
 * devops. Three titles, one capability: scoping access to the minimum that
 * works. A candidate who can do it can do it whatever the job advert said.
 *
 * So a capability is the unit, and a role is a set of them. Adding a fifth
 * track becomes a line declaring which capabilities it needs, and every task
 * that already demonstrates one of them is available to it immediately —
 * rather than thirty new tasks and a new branch in the engine.
 *
 * These were derived from the tasks that exist, not invented and imposed on
 * them. Each one is named for the thing a person does, not the service they
 * do it with, because a capability tied to one vendor's product is a
 * familiarity test wearing a capability's clothes.
 */
export const CapabilitySchema = z.enum([
  'least_privilege_access',
  'network_isolation',
  'data_protection',
  'durability_and_recovery',
  'failure_handling',
  'observability_and_alerting',
  'cost_control',
  'safe_release',
  'supply_chain_integrity',
  'auditability',
  'reproducible_data_path',
]);
export type Capability = z.infer<typeof CapabilitySchema>;

/**
 * What each one means, in terms of something a person can be observed doing.
 *
 * These are the words shown to an employer on a proof and to a candidate on a
 * task, so they are written to be read rather than to be precise in a way
 * only the author understands.
 */
export const CAPABILITY_DEFINITIONS: Record<Capability, { name: string; demonstratedBy: string }> =
  {
    least_privilege_access: {
      name: 'Least-privilege access',
      demonstratedBy:
        'Granting exactly the access a job needs and no more, to a function, a person, a pipeline, or another company, and doing it without a credential that never expires.',
    },
    network_isolation: {
      name: 'Network isolation',
      demonstratedBy:
        'Deciding what can reach a thing, and making that decision hold, rather than relying on nobody finding the address.',
    },
    data_protection: {
      name: 'Data protection',
      demonstratedBy:
        'Keeping data unreadable to everyone who should not read it, at rest and in transit, including the people running the system.',
    },
    durability_and_recovery: {
      name: 'Durability and recovery',
      demonstratedBy:
        'Building so that a deletion, a mistake, or a deliberate attempt to erase something can be undone, and knowing the difference between a backup and a copy.',
    },
    failure_handling: {
      name: 'Failure handling',
      demonstratedBy:
        'Making sure that when one part fails, the work is not lost silently: dead letters, bounded retries, and one bad record that cannot stop everything behind it.',
    },
    observability_and_alerting: {
      name: 'Observability and alerting',
      demonstratedBy:
        'Finding out that something is wrong from the system rather than from a customer, including when the thing has stopped entirely and is therefore emitting nothing.',
    },
    cost_control: {
      name: 'Cost control',
      demonstratedBy:
        'Bounding what a system can spend before it spends it, and being told about a runaway bill while it is still small.',
    },
    safe_release: {
      name: 'Safe release',
      demonstratedBy:
        'Putting a change in front of users without a blind cutover, with a way back, and with the decision made by somebody rather than by the pipeline.',
    },
    supply_chain_integrity: {
      name: 'Supply-chain integrity',
      demonstratedBy:
        'Knowing that what runs is what was built, and that nothing can be swapped underneath it after the fact.',
    },
    auditability: {
      name: 'Auditability',
      demonstratedBy:
        'Keeping a record of who did what that is useful afterwards and survives somebody wanting it gone.',
    },
    reproducible_data_path: {
      name: 'Reproducible data path',
      demonstratedBy:
        'Making the data a system learns from and the data it runs on the same data, so a result can be explained and repeated.',
    },
  };

/**
 * A role, expressed as the capabilities it needs.
 *
 * This is the whole of what makes the engine role-agnostic: adding a track
 * means adding a line here, and every existing task demonstrating one of its
 * capabilities becomes available to it without touching the engine, the
 * grader, or any task definition.
 *
 * The sets deliberately overlap. Least-privilege access matters to all four,
 * and pretending otherwise is what produced three near-identical tasks under
 * three different titles in the first place.
 */
export const TRACK_CAPABILITIES: Record<LaunchTrack, readonly Capability[]> = {
  aws_cloud: [
    'least_privilege_access',
    'network_isolation',
    'durability_and_recovery',
    'failure_handling',
    'observability_and_alerting',
    'cost_control',
  ],
  devops_platform: [
    'least_privilege_access',
    'safe_release',
    'supply_chain_integrity',
    'durability_and_recovery',
    'observability_and_alerting',
  ],
  cloud_security: [
    'least_privilege_access',
    'network_isolation',
    'data_protection',
    'auditability',
    'observability_and_alerting',
  ],
  mlops: [
    'reproducible_data_path',
    'safe_release',
    'observability_and_alerting',
    'cost_control',
    'failure_handling',
    'network_isolation',
  ],
};
