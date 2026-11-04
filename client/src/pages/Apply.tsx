import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, fieldErrors, uploadImage } from '../lib/api';
import { useMe } from '../hooks/queries';
import { useSeo } from '../hooks/useSeo';
import { Alert, SelectField, TextArea, TextField } from '../components/ui';
import { STATES } from '../lib/states';
import { statusLabel } from '../lib/format';

interface App { id: string; status: string; fullName?: string; email?: string; phone?: string; city?: string; state?: string; categories?: string[]; bio?: string; links?: string[]; sampleImages: string[]; monthlyCapacity?: number; confirmsHandmade?: boolean; acceptedTerms?: boolean; decisions: { status: string; note: string }[] }
const CATS = ['Jewellery & accessories', 'Crochet & knits', 'Art & illustration', 'Home décor', 'Personalised gifts', 'Stationery', 'Resin art', 'Other handmade'];
interface F { fullName: string; email: string; phone: string; city: string; state: string; bio: string; links: string; monthlyCapacity: string; categories: string[]; confirmsHandmade: boolean; acceptedTerms: boolean }

export default function Apply() {
  useSeo({ title: 'Apply to become a creator', noindex: true });
  const { data: me } = useMe(); const qc = useQueryClient();
  const q = useQuery({ queryKey: ['application'], queryFn: () => api<{ application: App | null }>('/creator/application') });
  const a = q.data?.application;
  const f = useForm<F>({ defaultValues: { fullName: '', email: '', phone: '', city: '', state: '', bio: '', links: '', monthlyCapacity: '', categories: [], confirmsHandmade: false, acceptedTerms: false } });
  const [images, setImages] = useState<string[]>([]); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  useEffect(() => { if (a && ['draft', 'more_info_requested'].includes(a.status)) { f.reset({ fullName: a.fullName ?? me?.name ?? '', email: a.email ?? me?.email ?? '', phone: a.phone ?? '', city: a.city ?? '', state: a.state ?? '', bio: a.bio ?? '', links: (a.links ?? []).join('\n'), monthlyCapacity: a.monthlyCapacity != null ? String(a.monthlyCapacity) : '', categories: a.categories ?? [], confirmsHandmade: !!a.confirmsHandmade, acceptedTerms: !!a.acceptedTerms }); setImages(a.sampleImages); } else if (!a && me) f.reset({ ...f.getValues(), fullName: me.name, email: me.email }); }, [a?.id, a?.status, me?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (v: F, submit: boolean) => {
    setErr(''); setMsg(''); f.clearErrors();
    try {
      const links = v.links.split('\n').map((s) => s.trim()).filter(Boolean);
      await api('/creator/application', { method: 'POST', body: { fullName: v.fullName || undefined, email: v.email || undefined, phone: v.phone || undefined, city: v.city || undefined, state: v.state || undefined, categories: v.categories, bio: v.bio || undefined, links, sampleImages: images, monthlyCapacity: v.monthlyCapacity ? Number(v.monthlyCapacity) : undefined, confirmsHandmade: v.confirmsHandmade, acceptedTerms: v.acceptedTerms, submit } });
      await qc.invalidateQueries({ queryKey: ['application'] }); setMsg(submit ? 'Application submitted.' : 'Draft saved.');
    } catch (e) { const fe = fieldErrors(e); const known = Object.keys(v) as (keyof F)[]; known.forEach((k) => fe[k] && f.setError(k, { message: fe[k] })); setErr(Object.keys(fe).length ? 'Please fix the highlighted fields.' : e instanceof ApiError ? e.message : 'Something went wrong'); }
  };
  // Each photo uploads independently: one rejected file never discards the others, and the message names the file.
  const onFiles = async (files: FileList | null) => {
    if (!files) return; setBusy(true); setErr('');
    const ok: string[] = []; const bad: string[] = [];
    for (const file of [...files].slice(0, 6 - images.length)) {
      try { ok.push((await uploadImage(file)).url); } catch (e) { bad.push(`${file.name}: ${e instanceof ApiError ? e.message : 'upload failed'}`); }
    }
    if (ok.length) setImages((cur) => [...cur, ...ok]);
    if (bad.length) setErr(bad.join(' · '));
    setBusy(false);
  };
  if (me?.role === 'creator') return <Wrap><Alert tone="success"><strong>You're a creator.</strong> Head to your <Link to="/creator/dashboard" className="underline">creator dashboard</Link> to add products.</Alert></Wrap>;
  if (me && me.role !== 'customer') return <Wrap><Alert tone="info">Your account is already a {me.role.replace('_', ' ')} account, so you can't submit a new application.</Alert></Wrap>;
  if (q.isPending) return <Wrap><p className="text-muted">Loading…</p></Wrap>;
  if (a && ['submitted', 'under_review'].includes(a.status)) return <Wrap><Alert tone="success"><strong>Application {statusLabel(a.status).toLowerCase()}.</strong> We'll email you and notify you here when there's an update.</Alert><p className="mt-6"><Link to="/" className="link">Back to the shop</Link></p></Wrap>;
  if (a?.status === 'approved') return <Wrap><Alert tone="success"><strong>You're approved!</strong> Welcome to the collective. Your creator tools are ready: <Link to="/creator/dashboard" className="underline">open your dashboard</Link>.</Alert></Wrap>;
  const rejected = a?.status === 'rejected';
  return (
    <Wrap>
      {a?.status === 'more_info_requested' && <div className="mb-6"><Alert tone="info"><strong>We need a bit more information.</strong> {a.decisions.at(-1)?.note}</Alert></div>}
      {rejected && <div className="mb-6"><Alert tone="info">Your previous application wasn't approved{a?.decisions.at(-1)?.note ? `: ${a.decisions.at(-1)?.note}` : ''}. You're welcome to apply again.</Alert></div>}
      <form onSubmit={f.handleSubmit((v) => send(v, true))} noValidate className="grid gap-5 sm:grid-cols-2">
        {err && <div className="sm:col-span-2"><Alert>{err}</Alert></div>}{msg && <div className="sm:col-span-2"><Alert tone="success">{msg}</Alert></div>}
        <TextField label="Full name" error={f.formState.errors.fullName?.message} {...f.register('fullName')} /><TextField label="Email" type="email" error={f.formState.errors.email?.message} {...f.register('email')} />
        <TextField label="Phone" type="tel" error={f.formState.errors.phone?.message} {...f.register('phone')} /><TextField label="City" error={f.formState.errors.city?.message} {...f.register('city')} />
        <SelectField label="State" error={f.formState.errors.state?.message} {...f.register('state')}><option value="">Select state</option>{STATES.map((s) => <option key={s}>{s}</option>)}</SelectField>
        <TextField label="Approximate pieces per month" inputMode="numeric" {...f.register('monthlyCapacity')} />
        <fieldset className="sm:col-span-2"><legend className="mb-2 text-sm font-medium">What do you make? (choose all that apply)</legend><div className="flex flex-wrap gap-x-5 gap-y-2">{CATS.map((c) => <label key={c} className="flex items-center gap-2 text-sm"><input type="checkbox" value={c} className="h-4 w-4 accent-forest" {...f.register('categories')} />{c}</label>)}</div>{f.formState.errors.categories && <p className="mt-1 text-sm text-[#a63a2a]">{f.formState.errors.categories.message}</p>}</fieldset>
        <TextArea className="sm:col-span-2" label="About you and your craft" hint="At least 30 characters." error={f.formState.errors.bio?.message} {...f.register('bio')} />
        <TextArea className="sm:col-span-2" label="Portfolio or social links (one per line, optional)" rows={3} error={f.formState.errors.links?.message} {...f.register('links')} />
        <div className="sm:col-span-2"><label htmlFor="photos" className="mb-1 block text-sm font-medium">Photos of your work (up to 6)</label>
          <input id="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy || images.length >= 6} onChange={(e) => onFiles(e.target.files)} className="block w-full text-sm file:mr-3 file:rounded-sm file:border-0 file:bg-forest file:px-4 file:py-2 file:text-ivory" />
          <p className="mt-1 text-xs text-muted">JPEG, PNG or WebP, up to 5 MB each. {busy && 'Uploading…'}</p>
          {!!images.length && <ul className="mt-3 flex flex-wrap gap-3">{images.map((u) => <li key={u} className="relative"><img src={u} alt="Your uploaded work" className="h-24 w-24 rounded-sm object-cover" /><button type="button" aria-label="Remove photo" className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full bg-charcoal text-xs text-white" onClick={() => setImages(images.filter((x) => x !== u))}>×</button></li>)}</ul>}</div>
        <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-forest" {...f.register('confirmsHandmade')} /> I confirm that the products I'll sell are handmade by me or my small team.</label>
        <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-forest" {...f.register('acceptedTerms')} /> I accept the creator terms (draft version). </label>
        <div className="flex flex-wrap gap-3 sm:col-span-2"><button className="btn btn-primary" disabled={f.formState.isSubmitting || busy}>Submit application</button><button type="button" className="btn btn-outline" disabled={f.formState.isSubmitting || busy} onClick={() => send(f.getValues(), false)}>Save draft</button></div>
      </form>
    </Wrap>
  );
}
const Wrap = ({ children }: { children: React.ReactNode }) => <div className="container-page max-w-3xl py-12"><h1 className="text-4xl md:text-5xl">Apply to become a creator</h1><p className="mt-3 text-muted">Tell us about your craft. Our team reviews every application.</p><div className="mt-8">{children}</div></div>;
