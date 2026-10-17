'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { getLocalAdapters } from '@zoryvex/local-adapters';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { isRealApiConfigured, realAuth } from '@/lib/real-api';

export interface SignInFormProps {
  intendedRole: 'candidate' | 'employer' | 'admin';
  landingHref: string;
  demoEmails: string[];
}

export function SignInForm({ intendedRole, landingHref, demoEmails }: SignInFormProps) {
  const router = useRouter();
  // Every role uses the real backend when one is configured, admin
  // included.
  //
  // Admin was excluded here on the reasoning that founder auth is a
  // separate pre-provisioned-account path rather than this self-serve
  // form. The separate path is real — accounts are pre-provisioned and
  // `createAccountIfNotExists` will not make a founder_admin — but the
  // sign-in mechanism is the same magic link, and excluding admin meant a
  // live production site offering "Demo accounts you can use:
  // founder.demo@example.com" and a sign-in that could never work, on a
  // deployment where nothing is supposed to be fictional.
  //
  // Safe because `resolveOrCreateAccount` returns an existing account with
  // its own role and ignores the requested one: a provisioned
  // founder_admin gets a founder_admin session. An address that is not
  // provisioned gets an ordinary employer account, exactly as it would
  // from the employer page, so this grants nothing it could not already
  // get. Provision with scripts/provision-founder-admin.mjs.
  const useReal = isRealApiConfigured();
  const realIntendedRole = intendedRole === 'candidate' ? 'candidate' : 'employer_admin';
  const [step, setStep] = useState<'email' | 'code' | 'sent'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  // The demo build's own code, shown on screen. See the note by the code step.
  const [demoCode, setDemoCode] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [sending, setSending] = useState(false);

  async function handleRequestCode(event: FormEvent) {
    event.preventDefault();
    setError(undefined);

    if (useReal) {
      setSending(true);
      try {
        await realAuth.requestSignIn(email, realIntendedRole);
        setStep('sent');
      } catch {
        setError('Something went wrong sending that link. Try again.');
      } finally {
        setSending(false);
      }
      return;
    }

    const adapters = getLocalAdapters();
    adapters.auth.requestCode(email, intendedRole);
    // Read straight back out of the demo's own outbox. The hint used to say
    // the code was "recorded in the founder/admin view", and no such view
    // exists, so there was no way to finish signing in to the demo without
    // opening developer tools. A demo nobody can get into is not a demo.
    //
    // Local-fake only. The real path never reaches here: it sends an actual
    // email and this component returns at the `useReal` branch above.
    const sent = adapters.email.listSent();
    const body = sent[sent.length - 1]?.bodyPreview ?? '';
    setDemoCode(/\b(\d{6})\b/.exec(body)?.[1]);
    setStep('code');
  }

  function handleVerifyCode(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    const session = getLocalAdapters().auth.verifyCode(email, code);
    if (!session) {
      setError('That code is incorrect or has expired. Request a new one.');
      return;
    }
    router.replace(landingHref);
  }

  if (step === 'sent') {
    return (
      <div className="flex flex-col gap-4">
        <p role="status" aria-live="polite" className="text-sm text-ink-700">
          Check <strong>{email}</strong> for a sign-in link. It expires in 10 minutes and works
          once.
        </p>
        <Button type="button" variant="secondary" onClick={() => setStep('email')}>
          Use a different email
        </Button>
      </div>
    );
  }

  if (step === 'email') {
    return (
      <form onSubmit={(e) => void handleRequestCode(e)} className="flex flex-col gap-4">
        <Input
          id="email"
          label="Email"
          type="email"
          // The whole sign-in is "type your address", and this field was not
          // telling the browser that, so no saved address was ever offered.
          // On a phone that turns the one step in the flow into typing a full
          // email by thumb, every time a session lapses.
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          hint={
            useReal
              ? "We'll email you a secure, one-time sign-in link."
              : 'This demo build never sends real email. The code appears on the next screen.'
          }
          error={error}
        />
        <Button type="submit" disabled={sending}>
          {useReal ? (sending ? 'Sending…' : 'Send sign-in link') : 'Send sign-in code'}
        </Button>
        {!useReal && demoEmails.length > 0 && (
          <p className="text-sm text-ink-500">
            Demo account{demoEmails.length > 1 ? 's' : ''} you can use: {demoEmails.join(', ')}
            {intendedRole !== 'admin' && ', or any other email to sign up fresh.'}
          </p>
        )}
      </form>
    );
  }

  return (
    <form onSubmit={handleVerifyCode} className="flex flex-col gap-4">
      <p className="text-sm text-ink-700">
        Enter the 6-digit code sent to <strong>{email}</strong>.
      </p>
      {demoCode && (
        <p className="rounded-md bg-warm-200 px-3 py-2 text-sm text-ink-950">
          Demo build, so nothing was emailed. Your code is{' '}
          <strong className="font-mono tracking-widest">{demoCode}</strong>. A real build sends this
          to your inbox and never shows it on screen.
        </p>
      )}
      <Input
        id="code"
        label="Sign-in code"
        inputMode="numeric"
        pattern="\d{6}"
        maxLength={6}
        required
        value={code}
        onChange={(e) => setCode(e.target.value)}
        error={error}
      />
      <div className="flex gap-3">
        <Button type="submit">Verify and sign in</Button>
        <Button type="button" variant="secondary" onClick={() => setStep('email')}>
          Use a different email
        </Button>
      </div>
    </form>
  );
}
