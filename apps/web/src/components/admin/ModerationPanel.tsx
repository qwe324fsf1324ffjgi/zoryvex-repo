'use client';

import { useEffect, useState } from 'react';
import { getLocalAdapters } from '@zoryvex/local-adapters';
import type { Candidate, Evidence } from '@zoryvex/contracts';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { StatusState } from '@/components/ui/StatusState';
import { useToast } from '@/components/ui/Toast';
import { useSession } from '@/lib/use-session';

interface PendingAction {
  kind: 'hide_from_discovery' | 'remove_evidence';
  evidenceId?: string;
}

export function ModerationPanel({ onActionTaken }: { onActionTaken: () => void }) {
  const session = useSession();
  const { showToast } = useToast();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState(false);

  useEffect(() => {
    const { data } = getLocalAdapters();
    const all = data.listAllCandidates();
    setCandidates(all);
    setSelectedId((current) => current || (all[0]?.id ?? ''));
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    setEvidence(getLocalAdapters().data.listCandidateEvidence(selectedId));
  }, [selectedId]);

  const selected = candidates.find((c) => c.id === selectedId);

  function openAction(action: PendingAction) {
    setReason('');
    setReasonError(false);
    setPendingAction(action);
  }

  function confirmAction() {
    if (!reason.trim()) {
      setReasonError(true);
      return;
    }
    if (!pendingAction || !selected || !session?.accountId) return;
    const { data } = getLocalAdapters();
    const now = new Date().toISOString();

    if (pendingAction.kind === 'hide_from_discovery') {
      data.upsertCandidate({ ...selected, discoveryOptIn: false });
      data.appendAuditEvent({
        id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        actorId: session.accountId,
        actorRole: 'admin',
        action: 'hide_from_discovery',
        targetType: 'candidate',
        targetId: selected.id,
        reason: reason.trim(),
        createdAt: now,
      });
      setCandidates((prev) =>
        prev.map((c) => (c.id === selected.id ? { ...c, discoveryOptIn: false } : c)),
      );
      showToast('Profile hidden from discovery.', 'success');
    } else if (pendingAction.evidenceId) {
      data.deleteEvidence(selected.id, pendingAction.evidenceId);
      data.appendAuditEvent({
        id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        actorId: session.accountId,
        actorRole: 'admin',
        action: 'remove_evidence',
        targetType: 'evidence',
        targetId: pendingAction.evidenceId,
        reason: reason.trim(),
        createdAt: now,
      });
      setEvidence((prev) => prev.filter((e) => e.id !== pendingAction.evidenceId));
      showToast('Evidence item removed.', 'success');
    }

    setPendingAction(null);
    onActionTaken();
  }

  if (candidates.length === 0) {
    return <StatusState kind="empty" title="No candidates" body="Nothing to moderate yet." />;
  }

  return (
    <div>
      <Select
        id="moderation-candidate"
        label="Candidate"
        value={selectedId}
        onChange={(e) => setSelectedId(e.target.value)}
      >
        {candidates.map((c) => (
          <option key={c.id} value={c.id}>
            {c.displayName} ({c.email})
          </option>
        ))}
      </Select>

      {selected && (
        <div className="mt-4 flex flex-col gap-3">
          <Card className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-ink-950">Discovery visibility</p>
              <p className="mt-1 text-sm text-ink-700">
                {selected.discoveryOptIn ? 'Currently visible to employers.' : 'Currently hidden.'}
              </p>
            </div>
            {selected.discoveryOptIn && (
              <Button
                variant="secondary"
                onClick={() => openAction({ kind: 'hide_from_discovery' })}
              >
                Hide from discovery
              </Button>
            )}
          </Card>

          {evidence.length === 0 ? (
            <p className="text-sm text-ink-700">No evidence items.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {evidence.map((item) => (
                <li key={item.id}>
                  <Card className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium break-words text-ink-950">{item.claim}</p>
                      <div className="mt-1">
                        <Badge tone="neutral">{item.visibility}</Badge>
                      </div>
                    </div>
                    <Button
                      variant="secondary"
                      onClick={() => openAction({ kind: 'remove_evidence', evidenceId: item.id })}
                    >
                      Remove
                    </Button>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Dialog
        open={pendingAction !== null}
        onClose={() => setPendingAction(null)}
        title={
          pendingAction?.kind === 'hide_from_discovery'
            ? 'Hide this profile from discovery?'
            : 'Remove this evidence item?'
        }
      >
        <p className="text-sm text-ink-700">
          This is logged to the audit trail with your reason. Narrow, reversible actions only: this
          never deletes the account itself.
        </p>
        <Textarea
          id="moderation-reason"
          label="Reason"
          required
          className="mt-4"
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setReasonError(false);
          }}
          error={reasonError ? 'A reason is required.' : undefined}
        />
        <div className="mt-4 flex gap-3">
          <Button onClick={confirmAction}>Confirm</Button>
          <Button variant="secondary" onClick={() => setPendingAction(null)}>
            Cancel
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
