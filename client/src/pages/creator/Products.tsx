import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, fieldErrors, uploadImage } from '../../lib/api';
import { formatDate, formatINR } from '../../lib/format';
import { createPayload, diffPayload, emptyForm, fromProduct, isMaterialChange, STATUS_HELP, validateForm, type CreatorProduct, type FormState } from '../../lib/creatorForm';
import type { Category } from '../../lib/types';
import { useSeo } from '../../hooks/useSeo';
import { creatorQuery, ErrorNote, FilterSelect, Loading, PageHead, RupeeField, StatusBadge, Table, Td, useAction } from '../../components/admin/kit';
import { Alert, SelectField, TextArea, TextField } from '../../components/ui';

export function MyProducts() {
  useSeo({ title: 'My products', noindex: true });
  const [sp, setSp] = useSearchParams(); const status = sp.get('status') ?? ''; const act = useAction('creator');
  const q = creatorQuery<{ items: CreatorProduct[] }>(['products', status], `/creator/products${status ? `?status=${status}` : ''}`);
  const verb = (p: CreatorProduct, v: string, msg: string) => act.run(() => api(`/creator/products/${p.id}/${v}`, { method: 'POST' }), msg);
  return (
    <>
      <PageHead title="Products" sub="Submit pieces for review. Nothing goes live until our team approves it and confirms the price."><FilterSelect label="Status" value={status} onChange={(v) => setSp(v ? { status: v } : {})} options={[['', 'All'], ['draft', 'Drafts'], ['submitted', 'Submitted'], ['changes_requested', 'Changes requested'], ['approved', 'Approved'], ['published', 'Live'], ['paused', 'Paused'], ['rejected', 'Rejected'], ['archived', 'Archived']]} /><Link to="/creator/products/new" className="btn btn-primary">Add a product</Link></PageHead>
      {act.error && <div className="mb-4"><Alert>{act.error}</Alert></div>}
      {q.isPending ? <Loading /> : q.isError ? <ErrorNote e={q.error} /> : <Table head={['Product', 'Status', 'Price', 'Stock', 'Sold', 'Updated', 'Actions']} empty={q.data.items.length ? undefined : 'No products here yet. Add your first piece to get started.'}>
        {q.data.items.map((p) => <tr key={p.id}><Td><span className="flex items-center gap-3"><img src={p.images[0]} alt="" className="h-12 w-12 rounded-sm object-cover" /><span><strong>{p.name}</strong>{p.status === 'changes_requested' && p.feedback.length > 0 && <span className="block max-w-xs text-xs text-terracotta">“{p.feedback[p.feedback.length - 1]!.note}”</span>}</span></span></Td>
          <Td><StatusBadge s={p.status} /></Td><Td>{p.approvedSellingPricePaise != null ? formatINR(p.approvedSellingPricePaise) : p.suggestedPricePaise != null ? <span className="text-muted">proposed {formatINR(p.suggestedPricePaise)}</span> : '—'}</Td><Td>{p.madeToOrder ? 'Made to order' : p.stock}</Td><Td>{p.soldCount}</Td><Td>{formatDate(p.updatedAt)}</Td>
          <Td><div className="flex flex-wrap gap-x-4 gap-y-1"><Link className="link" to={`/creator/products/${p.id}/edit`}>{['draft', 'changes_requested', 'rejected', 'published', 'paused'].includes(p.status) ? 'Edit' : 'View'}</Link>
            {p.status === 'published' && <button className="link" disabled={act.busy} onClick={() => verb(p, 'pause', 'Product paused')}>Pause</button>}{p.status === 'paused' && <button className="link" disabled={act.busy} onClick={() => verb(p, 'resume', 'Product is live again')}>Resume</button>}
            {['draft', 'rejected', 'paused', 'changes_requested'].includes(p.status) && <button className="link text-terracotta" disabled={act.busy} onClick={() => { if (confirm(`Archive “${p.name}”?`)) verb(p, 'archive', 'Product archived'); }}>Archive</button>}</div></Td></tr>)}</Table>}
    </>
  );
}

export function ProductForm() {
  const { id } = useParams(); const isNew = !id; const nav = useNavigate(); const act = useAction('creator');
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api<{ items: Category[] }>('/categories'), staleTime: 10 * 60_000 });
  const q = creatorQuery<{ product: CreatorProduct }>(['product', id], `/creator/products/${id}`, !isNew);
  const p = q.data?.product;
  const [f, setF] = useState<FormState>(emptyForm); const [orig, setOrig] = useState<FormState>(emptyForm); const [errs, setErrs] = useState<Record<string, string>>({}); const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(''); const [err, setErr] = useState(''); const [confirmFields, setConfirmFields] = useState<string[] | null>(null);
  useSeo({ title: isNew ? 'New product' : p?.name ?? 'Edit product', noindex: true });
  useEffect(() => { if (p) { const s = fromProduct(p); setF(s); setOrig(s); } }, [p?.id, p?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((x) => ({ ...x, [k]: v }));
  const status = p?.status ?? 'draft'; const reviewLocked = ['submitted', 'under_review', 'approved'].includes(status); const archived = status === 'archived'; const live = ['published', 'paused'].includes(status);
  const dis = (stockOrDispatch = false) => archived || (reviewLocked && !stockOrDispatch);
  const canSubmit = ['draft', 'changes_requested', 'rejected'].includes(status) || isNew;
  const payload = useMemo(() => (isNew ? createPayload(f) : diffPayload(orig, f)), [isNew, f, orig]);
  const dirty = Object.keys(payload).length > 0;

  const upload = async (files: FileList | null) => {
    if (!files) return; setBusy(true); setErr(''); const ok: string[] = []; const bad: string[] = [];
    for (const file of [...files].slice(0, 8 - f.images.length)) { try { ok.push((await uploadImage(file)).url); } catch (e) { bad.push(`${file.name}: ${e instanceof ApiError ? e.message : 'upload failed'}`); } }
    if (ok.length) set('images', [...f.images, ...ok]); if (bad.length) setErr(bad.join(' · ')); setBusy(false);
  };
  /** Saves (create or edit). Returns the product id on success, or undefined. */
  const save = async (ack = false): Promise<string | undefined> => {
    setErr(''); setMsg(''); setProblems([]);
    const v = validateForm(f); setErrs(v); if (Object.keys(v).length) { setErr('Please fix the highlighted fields.'); return; }
    setBusy(true);
    try {
      if (isNew) { const r = await api<{ product: CreatorProduct }>('/creator/products', { method: 'POST', body: payload }); await act.run(async () => {}); return r.product.id; }
      if (!dirty) return id;
      const r = await api<{ product: CreatorProduct; reapprovalRequired: boolean }>(`/creator/products/${id}`, { method: 'PUT', body: { ...payload, ...(ack ? { acknowledgeReapproval: true } : {}) } });
      await act.run(async () => {}); setConfirmFields(null); setMsg(r.reapprovalRequired ? 'Saved. This product is offline until our team re-approves it.' : 'Changes saved.'); return id;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'REAPPROVAL_REQUIRED') setConfirmFields(((e.details as { fields?: string[] })?.fields) ?? []);
      else { const fe = fieldErrors(e); setErrs(fe); setErr(e instanceof ApiError ? e.message : 'Could not save'); }
      return;
    } finally { setBusy(false); }
  };
  const saveDraft = async () => { const pid = await save(); if (pid && isNew) nav(`/creator/products/${pid}/edit`, { replace: true }); };
  const submit = async () => {
    const pid = await save(); if (!pid) return;
    try { await api(`/creator/products/${pid}/submit`, { method: 'POST' }); await act.run(async () => {}, 'Submitted for review'); nav('/creator/products'); }
    catch (e) { if (e instanceof ApiError && e.code === 'INCOMPLETE_PRODUCT') { setProblems(((e.details as { problems?: string[] })?.problems) ?? []); setErr('Almost there. Please complete the items below, then submit again.'); } else setErr(e instanceof ApiError ? e.message : 'Could not submit'); if (isNew) nav(`/creator/products/${pid}/edit`, { replace: true }); }
  };

  if (!isNew && q.isPending) return <Loading />; if (!isNew && q.isError) return <ErrorNote e={q.error} />;
  const topLevel = cats.data?.items.filter((c) => !c.parent) ?? []; const kids = (pid: string) => cats.data?.items.filter((c) => c.parent === pid) ?? [];
  return (
    <>
      <p className="mb-2 text-sm"><Link to="/creator/products" className="link">All products</Link></p>
      <PageHead title={isNew ? 'Add a product' : f.name || 'Edit product'}>{!isNew && <StatusBadge s={status} />}</PageHead>
      {!isNew && <p className="mb-4 text-sm text-muted">{STATUS_HELP[status]}</p>}
      {status === 'changes_requested' && p!.feedback.length > 0 && <div className="mb-5"><Alert tone="info"><strong>Feedback from our team:</strong> {p!.feedback[p!.feedback.length - 1]!.note}</Alert></div>}
      {reviewLocked && <div className="mb-5"><Alert tone="info">This product is with our team, so most fields are locked. You can still change stock and dispatch time.</Alert></div>}
      {live && <div className="mb-5"><Alert tone="info">This product is live. Changing the name, description, photos, materials, personalisation or price proposal takes it offline until our team re-approves it. Stock, dispatch time, colours, care and story change instantly.</Alert></div>}
      {p?.approvedSellingPricePaise != null && <div className="mb-5 card p-4 text-sm"><strong>Agreed terms:</strong> sells for {formatINR(p.approvedSellingPricePaise)}; you receive {formatINR(p.approvedCreatorAmountPaise ?? 0)} per unit. Discounts never reduce your amount. Ask us if you want these terms changed.</div>}
      {err && <div className="mb-4"><Alert>{err}</Alert>{problems.length > 0 && <ul className="mt-2 list-disc pl-6 text-sm">{problems.map((x) => <li key={x}>{x}</li>)}</ul>}</div>}{msg && <div className="mb-4"><Alert tone="success">{msg}</Alert></div>}
      {confirmFields && <div className="card mb-5 border-terracotta/50 p-5" role="alertdialog" aria-labelledby="rc"><h2 id="rc" className="font-sans text-lg font-semibold">Take this product offline for re-approval?</h2><p className="mt-1 text-sm">These changes need review ({confirmFields.join(', ')}). The product will leave the store until our team approves it again.</p><div className="mt-3 flex gap-3"><button className="btn btn-primary" disabled={busy} onClick={() => save(true)}>Save and send for re-approval</button><button className="btn btn-outline" onClick={() => setConfirmFields(null)}>Keep editing</button></div></div>}
      <form onSubmit={(e) => { e.preventDefault(); void saveDraft(); }} noValidate className="grid max-w-4xl gap-5 sm:grid-cols-2">
        <TextField className="sm:col-span-2" label="Product name" disabled={dis()} value={f.name} onChange={(e) => set('name', e.target.value)} error={errs.name} />
        <TextArea className="sm:col-span-2" label="Description" disabled={dis()} value={f.description} onChange={(e) => set('description', e.target.value)} error={errs.description} hint="What it is, how it's made, what makes it special." />
        <TextArea className="sm:col-span-2" label="Your story (optional)" rows={3} disabled={archived} value={f.story} onChange={(e) => set('story', e.target.value)} />
        <SelectField label="Category" disabled={dis()} value={f.category} onChange={(e) => set('category', e.target.value)} error={errs.category}><option value="">Choose a category</option>{topLevel.map((c) => <optgroup key={c.id} label={c.name}><option value={c.id}>{c.name}</option>{kids(c.id).map((k) => <option key={k.id} value={k.id}>{c.name} › {k.name}</option>)}</optgroup>)}</SelectField>
        <TextField label="Materials (comma separated)" disabled={dis()} value={f.materials} onChange={(e) => set('materials', e.target.value)} />
        <TextField label="Dimensions" disabled={dis()} value={f.dimensions} onChange={(e) => set('dimensions', e.target.value)} /><TextField label="Colours (comma separated)" disabled={archived || reviewLocked} value={f.colors} onChange={(e) => set('colors', e.target.value)} />
        <TextField label="Care instructions" disabled={archived || reviewLocked} value={f.careInstructions} onChange={(e) => set('careInstructions', e.target.value)} /><TextField label="Personalisation options" disabled={dis()} value={f.personalizationOptions} onChange={(e) => set('personalizationOptions', e.target.value)} />
        <TextField className="sm:col-span-2" label="Production details (shared with our team only)" disabled={dis()} value={f.productionDetails} onChange={(e) => set('productionDetails', e.target.value)} />
        <fieldset className="grid gap-4 sm:col-span-2 sm:grid-cols-3"><legend className="mb-2 text-sm font-semibold">Stock and timing</legend>
          <label className="flex items-center gap-2 self-end pb-3 text-sm"><input type="checkbox" className="h-4 w-4 accent-forest" disabled={dis()} checked={f.madeToOrder} onChange={(e) => set('madeToOrder', e.target.checked)} /> Made to order</label>
          <TextField label="Units in stock" inputMode="numeric" disabled={archived || f.madeToOrder} value={f.stock} onChange={(e) => set('stock', e.target.value.replace(/\D/g, ''))} error={errs.stock} /><TextField label="Dispatch time (days)" inputMode="numeric" disabled={archived} value={f.dispatchDays} onChange={(e) => set('dispatchDays', e.target.value.replace(/\D/g, ''))} error={errs.dispatchDays} /></fieldset>
        <fieldset className="grid gap-4 sm:col-span-2 sm:grid-cols-2"><legend className="mb-2 text-sm font-semibold">Your price proposal</legend>
          <RupeeField label="Suggested retail price" value={f.suggested} onChange={(v) => set('suggested', v)} hint={errs.suggested} /><RupeeField label="Amount you want to receive per unit" value={f.creatorAmt} onChange={(v) => set('creatorAmt', v)} hint={errs.creatorAmt ?? 'Our team confirms the final price and your amount before anything goes live.'} /></fieldset>
        <fieldset className="sm:col-span-2"><legend className="mb-2 text-sm font-semibold">Photos (up to 8; the first is the cover)</legend>
          <input type="file" aria-label="Add photos" accept="image/jpeg,image/png,image/webp" multiple disabled={dis() || busy || f.images.length >= 8} onChange={(e) => void upload(e.target.files)} className="block w-full text-sm file:mr-3 file:rounded-sm file:border-0 file:bg-forest file:px-4 file:py-2 file:text-ivory" />
          <p className="mt-1 text-xs text-muted">JPEG, PNG or WebP, up to 5 MB each.</p>
          {!!f.images.length && <ul className="mt-3 flex flex-wrap gap-3">{f.images.map((u, i) => <li key={u} className="w-28"><img src={u} alt={`Product photo ${i + 1}`} className="h-28 w-28 rounded-sm object-cover" /><div className="mt-1 flex justify-between text-xs">{i === 0 ? <span className="font-semibold text-forest">Cover</span> : <button type="button" className="link" disabled={dis()} onClick={() => set('images', [u, ...f.images.filter((x) => x !== u)])}>Make cover</button>}<button type="button" className="link text-terracotta" disabled={dis()} onClick={() => set('images', f.images.filter((x) => x !== u))}>Remove</button></div></li>)}</ul>}</fieldset>
        {!archived && <div className="flex flex-wrap gap-3 sm:col-span-2"><button className="btn btn-outline" disabled={busy || (!isNew && !dirty)}>{isNew ? 'Save as draft' : 'Save changes'}</button>{canSubmit && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void submit()}>Submit for review</button>}</div>}
      </form>
    </>
  );
}
