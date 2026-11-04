import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { api, ApiError, fieldErrors } from '../lib/api';
import { afterAuth } from '../hooks/queries';
import { useSeo } from '../hooks/useSeo';
import { Alert, TextField } from '../components/ui';
import { safeNext } from '../components/RequireAuth';

const email = z.string().trim().min(1, 'Enter your email').pipe(z.email('Enter a valid email address'));
const password = z.string().min(10, 'Use at least 10 characters').max(72, 'Use at most 72 characters');
function Shell({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return <div className="container-page grid place-items-center py-14"><div className="card w-full max-w-md p-8"><h1 className="text-3xl">{title}</h1>{sub && <p className="mt-2 text-sm text-muted">{sub}</p>}<div className="mt-6">{children}</div></div></div>;
}
const errMsg = (e: unknown) => (e instanceof ApiError ? (e.code === 'RATE_LIMITED' ? e.message : e.message) : 'Something went wrong. Please try again.');

export function Login() {
  useSeo({ title: 'Sign in', noindex: true });
  const [sp] = useSearchParams(); const nav = useNavigate(); const qc = useQueryClient(); const [err, setErr] = useState('');
  const f = useForm<{ email: string; password: string }>({ resolver: zodResolver(z.object({ email, password: z.string().min(1, 'Enter your password') })) });
  const next = safeNext(sp.get('next'));
  const submit = f.handleSubmit(async (v) => {
    setErr('');
    try { await api('/auth/login', { method: 'POST', body: v }); await afterAuth(qc); nav(next, { replace: true }); } catch (e) { setErr(errMsg(e)); }
  });
  return (
    <Shell title="Welcome back" sub="Sign in to your account.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {err && <Alert>{err}</Alert>}
        <TextField label="Email" type="email" autoComplete="email" error={f.formState.errors.email?.message} {...f.register('email')} />
        <TextField label="Password" type="password" autoComplete="current-password" error={f.formState.errors.password?.message} {...f.register('password')} />
        <button className="btn btn-primary w-full" disabled={f.formState.isSubmitting}>{f.formState.isSubmitting ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <p className="mt-5 text-sm"><Link to="/forgot-password" className="link">Forgot your password?</Link></p>
      <p className="mt-2 text-sm text-muted">New here? <Link to={`/register${sp.get('next') ? `?next=${encodeURIComponent(sp.get('next')!)}` : ''}`} className="link">Create an account</Link></p>
    </Shell>
  );
}
export function Register() {
  useSeo({ title: 'Create an account', noindex: true });
  const [sp] = useSearchParams(); const nav = useNavigate(); const qc = useQueryClient(); const [err, setErr] = useState('');
  const f = useForm<{ name: string; email: string; password: string }>({ resolver: zodResolver(z.object({ name: z.string().trim().min(1, 'Enter your name').max(120), email, password })) });
  const submit = f.handleSubmit(async (v) => {
    setErr('');
    try { await api('/auth/register', { method: 'POST', body: v }); await afterAuth(qc); nav(safeNext(sp.get('next')), { replace: true }); }
    catch (e) { const fe = fieldErrors(e); (['name', 'email', 'password'] as const).forEach((k) => fe[k] && f.setError(k, { message: fe[k] })); setErr(Object.keys(fe).length ? '' : errMsg(e)); }
  });
  return (
    <Shell title="Create your account" sub="Save your wishlist, track orders and check out faster.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {err && <Alert>{err}</Alert>}
        <TextField label="Full name" autoComplete="name" error={f.formState.errors.name?.message} {...f.register('name')} />
        <TextField label="Email" type="email" autoComplete="email" error={f.formState.errors.email?.message} {...f.register('email')} />
        <TextField label="Password" type="password" autoComplete="new-password" hint="At least 10 characters." error={f.formState.errors.password?.message} {...f.register('password')} />
        <button className="btn btn-primary w-full" disabled={f.formState.isSubmitting}>{f.formState.isSubmitting ? 'Creating…' : 'Create account'}</button>
      </form>
      <p className="mt-5 text-sm text-muted">Already have an account? <Link to="/login" className="link">Sign in</Link></p>
    </Shell>
  );
}
export function ForgotPassword() {
  useSeo({ title: 'Reset your password', noindex: true });
  const [done, setDone] = useState(''); const [err, setErr] = useState('');
  const f = useForm<{ email: string }>({ resolver: zodResolver(z.object({ email })) });
  const submit = f.handleSubmit(async (v) => { setErr(''); try { setDone((await api<{ message: string }>('/auth/forgot-password', { method: 'POST', body: v })).message); } catch (e) { setErr(errMsg(e)); } });
  return (
    <Shell title="Reset your password" sub="Enter your email and we'll send a reset link if an account exists.">
      {done ? <Alert tone="success">{done}</Alert> : (
        <form onSubmit={submit} className="space-y-4" noValidate>{err && <Alert>{err}</Alert>}
          <TextField label="Email" type="email" autoComplete="email" error={f.formState.errors.email?.message} {...f.register('email')} />
          <button className="btn btn-primary w-full" disabled={f.formState.isSubmitting}>Send reset link</button></form>
      )}
      <p className="mt-5 text-sm"><Link to="/login" className="link">Back to sign in</Link></p>
    </Shell>
  );
}
export function ResetPassword() {
  useSeo({ title: 'Choose a new password', noindex: true });
  const [sp] = useSearchParams(); const token = sp.get('token') ?? ''; const [ok, setOk] = useState(false); const [err, setErr] = useState('');
  const f = useForm<{ password: string; confirm: string }>({ resolver: zodResolver(z.object({ password, confirm: z.string() }).refine((d) => d.password === d.confirm, { path: ['confirm'], message: 'Passwords do not match' })) });
  const submit = f.handleSubmit(async (v) => { setErr(''); try { await api('/auth/reset-password', { method: 'POST', body: { token, password: v.password } }); setOk(true); } catch (e) { setErr(errMsg(e)); } });
  if (!/^[a-f0-9]{64}$/.test(token)) return <Shell title="Link not valid"><Alert>This reset link is incomplete. Request a new one.</Alert><p className="mt-4 text-sm"><Link to="/forgot-password" className="link">Send a new link</Link></p></Shell>;
  return (
    <Shell title="Choose a new password">
      {ok ? <><Alert tone="success">Your password was updated.</Alert><Link to="/login" className="btn btn-primary mt-5 w-full">Sign in</Link></> : (
        <form onSubmit={submit} className="space-y-4" noValidate>{err && <Alert>{err}</Alert>}
          <TextField label="New password" type="password" autoComplete="new-password" error={f.formState.errors.password?.message} {...f.register('password')} />
          <TextField label="Confirm new password" type="password" autoComplete="new-password" error={f.formState.errors.confirm?.message} {...f.register('confirm')} />
          <button className="btn btn-primary w-full" disabled={f.formState.isSubmitting}>Update password</button></form>
      )}
    </Shell>
  );
}
