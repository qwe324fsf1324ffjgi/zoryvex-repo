'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { getLocalAdapters } from '@zoryvex/local-adapters';
import { LAUNCH_TRACK_LABELS, MARKETPLACE_GATE_MIN_MATCHES, type Role } from '@zoryvex/contracts';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ButtonLink } from '@/components/ui/Button';
import { StatusState } from '@/components/ui/StatusState';
import { PageHeader, Section } from '@/components/layout/Section';
import { useSession } from '@/lib/use-session';
import { isRealApiConfigured, realKit, realMatches, realRoles } from '@/lib/real-api';
import { PageLoading } from '@/components/ui/PageLoading';

interface RoleRow {
  role: Role;
  /** Null when this one row's count could not be loaded. */
  matchCount: number | null;
  kitStatus: 'none' | 'pending' | 'succeeded' | 'failed' | 'refunded';
}

export default function EmployerRolesPage() {
  const session = useSession();
  const useReal = isRealApiConfigured();
  const [rows, setRows] = useState<RoleRow[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(() => {
    if (!session?.employerId) return;

    if (useReal) {
      setLoadFailed(false);
      realRoles
        .listRoles()
        .then(async (roles) => {
          // Per role rather than across all of them. `Promise.all` rejects
          // on the first failure, so one blip on one role's match count
          // replaced the whole list with a 500 page — an employer with ten
          // roles losing all ten because of one. A row that could not load
          // its counts still shows the role, which is the part they came
          // for.
          const withMatches = await Promise.all(
            roles.map(async (role) => {
              const [matches, kit] = await Promise.allSettled([
                realMatches.listMatches(role.id),
                realKit.getStatus(role.id),
              ]);
              return {
                role,
                matchCount: matches.status === 'fulfilled' ? matches.value.length : null,
                kitStatus: kit.status === 'fulfilled' ? kit.value.status : 'none',
              };
            }),
          );
          setRows(withMatches);
        })
        .catch(() => setLoadFailed(true));
      return;
    }

    const { data } = getLocalAdapters();
    const roles = data.listRolesByEmployer(session.employerId);
    setRows(
      roles.map((role) => ({
        role,
        matchCount: data.listMatchesForRole(role.id).length,
        kitStatus: data.getKitOrderForRole(role.id)?.status ?? 'none',
      })),
    );
  }, [session, useReal]);

  useEffect(load, [load]);

  if (rows === null) {
    if (loadFailed) {
      return (
        <Section className="max-w-md">
          <StatusState
            kind="500"
            action={
              <Button variant="secondary" onClick={load}>
                Try again
              </Button>
            }
          />
        </Section>
      );
    }
    return (
      <Section>
        <PageLoading blocks={3} />
      </Section>
    );
  }

  return (
    <Section>
      <div className="mb-8 flex items-center justify-between">
        <PageHeader title="Your roles" />
        <ButtonLink href="/employer/roles/new">New role</ButtonLink>
      </div>

      {rows.length === 0 ? (
        <StatusState
          kind="empty"
          title="No roles yet"
          body="Start with the free role diagnostic. No candidate profiles required."
          action={<ButtonLink href="/employer/roles/new">Start a role</ButtonLink>}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map(({ role, matchCount, kitStatus }) => (
            <li key={role.id}>
              <Link prefetch={false} href={`/employer/role?id=${role.id}`}>
                <Card className="hover:border-ink-500">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="font-semibold break-words text-ink-950">{role.title}</p>
                      <p className="text-sm text-ink-700">
                        {LAUNCH_TRACK_LABELS[role.launchTrack]}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      {/*
                        Accent once the role has enough matches to open the
                        marketplace, which is the number that actually
                        changes what an employer can do here. It was written
                        as a literal 5, one copy of a threshold that lives in
                        contracts and is enforced server-side.
                      */}
                      <Badge
                        tone={
                          matchCount !== null && matchCount >= MARKETPLACE_GATE_MIN_MATCHES
                            ? 'accent'
                            : 'neutral'
                        }
                      >
                        {matchCount === null ? 'matches unavailable' : `${matchCount} matches`}
                      </Badge>
                      {kitStatus !== 'none' && (
                        <Badge tone={kitStatus === 'succeeded' ? 'accent' : 'neutral'}>
                          Kit: {kitStatus}
                        </Badge>
                      )}
                    </div>
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
