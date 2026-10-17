import { describe, expect, it } from 'vitest';
import { CAPABILITY_DEFINITIONS, TRACK_CAPABILITIES, type Capability } from '@zoryvex/contracts';
import {
  GRADED_TASKS,
  coveredCapabilities,
  tasksForCapabilities,
  tasksForTrack,
} from '../src/domain/graded-task-service';

/**
 * The capability layer, and the property it exists to give: a role is a set
 * of capabilities, so adding one is data rather than engine work.
 *
 * The engine used to find a task by matching a job title. Reading the thirty
 * tasks shows why that was wrong: "Give a function the least access it can do
 * its job with" (aws_cloud), "Let a vendor into your account without letting
 * in their other customers" (cloud_security) and "Let CI deploy without a key
 * that never expires" (devops_platform) are one capability under three
 * titles.
 */

const ALL_CAPABILITIES = Object.keys(CAPABILITY_DEFINITIONS) as Capability[];
const TRACKS = ['aws_cloud', 'devops_platform', 'cloud_security', 'mlops'] as const;

describe('the taxonomy', () => {
  it('gives every capability a name and something observable', () => {
    for (const capability of ALL_CAPABILITIES) {
      const definition = CAPABILITY_DEFINITIONS[capability];
      expect(definition.name.length, capability).toBeGreaterThan(3);
      // Written to be read by an employer and a candidate, so a one-word
      // gesture at the idea is not enough.
      expect(definition.demonstratedBy.length, capability).toBeGreaterThan(60);
    }
  });

  /**
   * A capability named for a product is a familiarity test wearing a
   * capability's clothes. The point of this layer is that it survives the
   * vendor changing its mind about a service name.
   */
  it('names no vendor or product', () => {
    const vendorWords = ['aws', 'amazon', 's3', 'lambda', 'dynamo', 'terraform', 'azure', 'gcp'];
    for (const capability of ALL_CAPABILITIES) {
      for (const word of vendorWords) {
        expect(capability.toLowerCase(), `capability id names ${word}`).not.toContain(word);
        expect(
          CAPABILITY_DEFINITIONS[capability].name.toLowerCase(),
          `capability name mentions ${word}`,
        ).not.toContain(word);
      }
    }
  });

  it('declares capabilities for every task, drawn from the taxonomy', () => {
    // 52 since 2026-09-05: 30 AWS tasks, the Azure and GCP prototypes from
    // 2026-09-03, and ten same-capability pairs written to ADR 0004's step
    // one. With the last of those, every capability across all four tracks has
    // a task on all three providers.
    // The count is pinned on purpose. A task appearing or vanishing without
    // anybody deciding to is exactly what this catches, and it has now caught
    // twenty-two deliberate additions, which is the guard working rather than
    // being in the way.
    expect(GRADED_TASKS).toHaveLength(52);
    for (const task of GRADED_TASKS) {
      expect(task.capabilities.length, `${task.id} demonstrates nothing`).toBeGreaterThan(0);
      for (const capability of task.capabilities) {
        expect(ALL_CAPABILITIES, `${task.id} names an unknown capability`).toContain(capability);
      }
    }
  });
});

describe('roles resolve through capabilities, not titles', () => {
  it('gives every track at least as much as its title-matched set', () => {
    // The regression that matters. Nothing a track could offer before may
    // disappear, because a candidate part-way through a task they can no
    // longer see is the one outcome this refactor must not produce.
    for (const track of TRACKS) {
      const byTitle = GRADED_TASKS.filter((t) => t.track === track).map((t) => t.id);
      const byCapability = tasksForTrack(track).map((t) => t.id);
      for (const id of byTitle) {
        expect(byCapability, `${track} lost ${id}`).toContain(id);
      }
    }
  });

  /**
   * The intended consequence, asserted rather than left as a side effect.
   * Least-privilege access is required by three tracks, so the task written
   * for one of them is now offered by all three. That is the point: the
   * capability was always shared and only the filing was per-title.
   */
  it('lets a task written for one role serve another that needs the same capability', () => {
    const leastPrivilege = tasksForCapabilities(['least_privilege_access']);
    const tracksOfThoseTasks = new Set(leastPrivilege.map((t) => t.track));
    expect(tracksOfThoseTasks.size).toBeGreaterThan(1);

    // Written under aws_cloud, now reachable by cloud-security, which
    // requires the same capability.
    const securityTasks = tasksForTrack('cloud_security').map((t) => t.id);
    expect(securityTasks).toContain('task_least_privilege_role_v1');
  });

  it('returns nothing for a capability no task demonstrates', () => {
    const uncovered = ALL_CAPABILITIES.filter((c) => !coveredCapabilities().includes(c));
    for (const capability of uncovered) {
      expect(tasksForCapabilities([capability])).toEqual([]);
    }
  });

  it('keeps a stable order whatever order the capabilities are asked for', () => {
    // A candidate's offer should not reshuffle because a role's capability
    // list was edited in a different order.
    const forward = tasksForCapabilities(['least_privilege_access', 'network_isolation']);
    const reversed = tasksForCapabilities(['network_isolation', 'least_privilege_access']);
    expect(forward.map((t) => t.id)).toEqual(reversed.map((t) => t.id));
  });
});

describe('adding a role is data, not engine work', () => {
  /**
   * The claim this whole layer exists to make good on, tested by actually
   * doing it. A role nobody had thought of gets real tasks with no new task
   * definition, no new branch, and no change to the grader.
   */
  it('a role that does not exist yet already has tasks', () => {
    const dataPlatformEngineer: readonly Capability[] = [
      'reproducible_data_path',
      'failure_handling',
      'durability_and_recovery',
      'cost_control',
    ];

    const offered = tasksForCapabilities(dataPlatformEngineer);
    expect(offered.length).toBeGreaterThan(5);

    // And every one of them genuinely demonstrates something the role asked
    // for, rather than being swept in by a loose match.
    for (const task of offered) {
      expect(task.capabilities.some((c) => dataPlatformEngineer.includes(c))).toBe(true);
    }

    // Drawn from tasks written under several different titles, which is the
    // evidence that the title binding is gone rather than merely hidden.
    expect(new Set(offered.map((t) => t.track)).size).toBeGreaterThan(1);
  });

  it('every existing track declares capabilities that tasks actually cover', () => {
    const covered = coveredCapabilities();
    for (const track of TRACKS) {
      const declared = TRACK_CAPABILITIES[track];
      const uncovered = declared.filter((c) => !covered.includes(c));
      expect(uncovered, `${track} requires capabilities no task can demonstrate`).toEqual([]);
    }
  });
});

describe('the wider pool does not change what a candidate is shown first', () => {
  /**
   * Caught by measuring rather than by review. The moment availability moved
   * to capabilities, three of the four tracks changed which task they lead
   * with, and MLOps opened with "Lock down a bucket holding sensitive
   * documents" — genuinely one of its capabilities, and a strange first thing
   * to put in front of a model-platform engineer.
   *
   * So availability comes from capabilities and order comes from the role.
   * `track` stops being a gate and becomes a relevance signal, which is the
   * honest thing for it to be.
   */
  it('leads every track with the same task it led with before', () => {
    for (const track of TRACKS) {
      const ledBefore = GRADED_TASKS.find((t) => t.track === track)?.id;
      expect(tasksForTrack(track)[0]?.id, `${track} changed its first task`).toBe(ledBefore);
    }
  });

  it('puts the tasks written for the role ahead of the ones it borrows', () => {
    for (const track of TRACKS) {
      const ordered = tasksForTrack(track);
      const ownCount = ordered.filter((t) => t.track === track).length;
      // Everything written for this role comes first, contiguously.
      for (let i = 0; i < ownCount; i += 1) {
        expect(ordered[i]?.track, `${track} interleaves borrowed tasks`).toBe(track);
      }
    }
  });

  it('still offers more than it did, which was the point', () => {
    for (const track of TRACKS) {
      const byTitle = GRADED_TASKS.filter((t) => t.track === track).length;
      expect(tasksForTrack(track).length).toBeGreaterThan(byTitle);
    }
  });
});
