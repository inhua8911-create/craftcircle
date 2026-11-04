import { useEffect, useState } from 'react';
import { api, ApiError, fieldErrors, uploadImage } from '../../lib/api';
import { useSeo } from '../../hooks/useSeo';
import { creatorQuery, ErrorNote, Loading, PageHead, useAction } from '../../components/admin/kit';
import { Alert, TextArea, TextField } from '../../components/ui';

interface Prof { profile: { slug: string; displayName: string; bio?: string; story?: string; specialties?: string[]; profileImage?: string; links?: string[]; publicFields: { city: boolean; bio: boolean; story: boolean; links: boolean }; city?: string }; payoutDetails: { accountHolder?: string; bankName?: string; accountLast4?: string; ifsc?: string; upiId?: string } | null }

export default function ProfilePage() {
  useSeo({ title: 'Profile & payouts', noindex: true });
  const act = useAction('creator'); const q = creatorQuery<Prof>(['profile'], '/creator/profile');
  const [p, setP] = useState({ displayName: '', bio: '', story: '', specialties: '', links: '', image: '', pf: { city: false, bio: true, story: true, links: false } });
  const [d, setD] = useState({ accountHolder: '', bankName: '', accountLast4: '', ifsc: '', upiId: '' }); const [perr, setPerr] = useState<Record<string, string>>({}); const [derr, setDerr] = useState<Record<string, string>>({}); const [up, setUp] = useState('');
  useEffect(() => { if (q.data) { const x = q.data.profile; setP({ displayName: x.displayName, bio: x.bio ?? '', story: x.story ?? '', specialties: (x.specialties ?? []).join(', '), links: (x.links ?? []).join('\n'), image: x.profileImage ?? '', pf: x.publicFields }); const y = q.data.payoutDetails; if (y) setD({ accountHolder: y.accountHolder ?? '', bankName: y.bankName ?? '', accountLast4: y.accountLast4 ?? '', ifsc: y.ifsc ?? '', upiId: y.upiId ?? '' }); } }, [q.data]);
  if (q.isPending) return <Loading />; if (q.isError) return <ErrorNote e={q.error} />;
  const list = (s: string, sep: RegExp) => s.split(sep).map((x) => x.trim()).filter(Boolean);
  const saveProfile = async () => { setPerr({}); const r = await act.run(() => api('/creator/profile', { method: 'PUT', body: { displayName: p.displayName, bio: p.bio, story: p.story, specialties: list(p.specialties, /,/), links: list(p.links, /\n/), ...(p.image ? { profileImage: p.image } : {}), publicFields: p.pf } }), 'Profile saved'); if (!r) setPerr({}); };
  const saveDetails = async () => { setDerr({}); try { await act.run(() => api('/creator/payout-details', { method: 'PUT', body: { accountHolder: d.accountHolder, ...(d.bankName ? { bankName: d.bankName } : {}), ...(d.accountLast4 ? { accountLast4: d.accountLast4 } : {}), ...(d.ifsc ? { ifsc: d.ifsc } : {}), ...(d.upiId ? { upiId: d.upiId } : {}) } }), 'Payout details saved'); } catch (e) { setDerr(fieldErrors(e)); } };
  const pub = (k: keyof typeof p.pf, label: string) => <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-forest" checked={p.pf[k]} onChange={(e) => setP({ ...p, pf: { ...p.pf, [k]: e.target.checked } })} /> {label}</label>;
  return (
    <>
      <PageHead title="Profile & payouts" sub="Your public page shows only what you choose to share." />
      {act.error && <div className="mb-4"><Alert>{act.error}</Alert></div>}
      <div className="grid max-w-5xl gap-10 lg:grid-cols-2">
        <section aria-labelledby="pp" className="space-y-4"><h2 id="pp" className="text-2xl">Public profile</h2>
          <TextField label="Display name" value={p.displayName} onChange={(e) => setP({ ...p, displayName: e.target.value })} error={perr.displayName} />
          <TextArea label="Bio" rows={4} value={p.bio} onChange={(e) => setP({ ...p, bio: e.target.value })} /><TextArea label="Your story" rows={5} value={p.story} onChange={(e) => setP({ ...p, story: e.target.value })} />
          <TextField label="Specialties (comma separated)" value={p.specialties} onChange={(e) => setP({ ...p, specialties: e.target.value })} /><TextArea label="Links (one per line, https)" rows={3} value={p.links} onChange={(e) => setP({ ...p, links: e.target.value })} />
          <div><label htmlFor="pimg" className="mb-1 block text-sm font-medium">Profile photo</label>{p.image && <img src={p.image} alt="Your profile" className="mb-2 h-20 w-20 rounded-full object-cover" />}
            <input id="pimg" type="file" accept="image/jpeg,image/png,image/webp" className="block w-full text-sm file:mr-3 file:rounded-sm file:border-0 file:bg-forest file:px-4 file:py-2 file:text-ivory" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; setUp(''); try { setP({ ...p, image: (await uploadImage(f)).url }); } catch (x) { setUp(x instanceof ApiError ? x.message : 'Upload failed'); } }} />{up && <p className="mt-1 text-sm text-[#a63a2a]">{up}</p>}</div>
          <fieldset className="space-y-2"><legend className="mb-1 text-sm font-semibold">Show on my public page</legend>{pub('bio', 'My bio')}{pub('story', 'My story')}{pub('city', `My city${q.data.profile.city ? ` (${q.data.profile.city})` : ''}`)}{pub('links', 'My links')}</fieldset>
          <button className="btn btn-primary" disabled={act.busy} onClick={saveProfile}>Save profile</button></section>
        <section aria-labelledby="pd" className="space-y-4"><h2 id="pd" className="text-2xl">Payout details</h2>
          <Alert tone="info">We pay by bank transfer and only store reference details: the last 4 digits of your account, IFSC and UPI id. <strong>Never share full account numbers, card numbers, PINs or passwords.</strong> Only you and our payments team can see these.</Alert>
          <TextField label="Account holder name" value={d.accountHolder} onChange={(e) => setD({ ...d, accountHolder: e.target.value })} error={derr.accountHolder} /><TextField label="Bank name" value={d.bankName} onChange={(e) => setD({ ...d, bankName: e.target.value })} />
          <TextField label="Account number: last 4 digits only" inputMode="numeric" maxLength={4} value={d.accountLast4} onChange={(e) => setD({ ...d, accountLast4: e.target.value.replace(/\D/g, '') })} error={derr.accountLast4} />
          <TextField label="IFSC" value={d.ifsc} onChange={(e) => setD({ ...d, ifsc: e.target.value.toUpperCase() })} error={derr.ifsc} hint="Example: HDFC0001234" /><TextField label="UPI id (optional)" value={d.upiId} onChange={(e) => setD({ ...d, upiId: e.target.value })} error={derr.upiId} />
          <button className="btn btn-primary" disabled={act.busy || !d.accountHolder.trim()} onClick={saveDetails}>Save payout details</button>
          {q.data.payoutDetails && <p className="text-sm text-muted" role="status">Saved: {q.data.payoutDetails.accountHolder}{q.data.payoutDetails.accountLast4 ? `, account ending ${q.data.payoutDetails.accountLast4}` : ''}.</p>}</section>
      </div>
    </>
  );
}
