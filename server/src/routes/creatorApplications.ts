import { Router } from 'express';
import { CreatorApplication, CreatorProfile, User } from '../models/index.js';
import { asyncHandler, validateBody } from '../middleware/common.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { applicationInput, CREATOR_TERMS_VERSION, creatorStatusSchema, decisionSchema, fullApplication } from '../validators/creator.js';
import { AppError, notFound } from '../utils/errors.js';
import { isOwnedImageUrl } from '../services/uploads.js';
import { uniqueSlug } from '../utils/slug.js';
import { notify } from '../services/notify.js';
import { audit } from '../services/audit.js';
import { withTx } from '../services/tx.js';

export const applicantRouter = Router();
export const adminCreatorAppsRouter = Router();
const FIELDS = ['fullName', 'email', 'phone', 'city', 'state', 'categories', 'bio', 'links', 'monthlyCapacity', 'confirmsHandmade'] as const;
const view = (a: any) => ({ id: String(a._id), status: a.status, ...Object.fromEntries(FIELDS.map((f) => [f, a[f]])), sampleImages: (a.sampleImages ?? []).map((i: any) => i.url), acceptedTerms: a.acceptedTermsVersion === CREATOR_TERMS_VERSION, decisions: (a.decisions ?? []).filter((d: any) => d.note).map((d: any) => ({ status: d.status, note: d.note, at: d.at })), updatedAt: a.updatedAt });

applicantRouter.get('/creator/application', requireAuth, asyncHandler(async (req, res) => {
  const a = await CreatorApplication.findOne({ user: req.user!.id }).sort({ createdAt: -1 });
  res.json({ application: a ? view(a) : null, termsVersion: CREATOR_TERMS_VERSION });
}));

// Save a draft (submit=false) or submit. One live application per person; rejected applicants may re-apply.
applicantRouter.post('/creator/application', requireAuth, validateBody(applicationInput), asyncHandler(async (req, res) => {
  const body = req.body;
  if (req.user!.role !== 'customer') throw new AppError(409, 'ALREADY_CREATOR', 'This account is already a creator or staff account');
  let a = await CreatorApplication.findOne({ user: req.user!.id }).sort({ createdAt: -1 });
  if (a && ['submitted', 'under_review', 'approved', 'suspended'].includes(a.status)) throw new AppError(409, 'APPLICATION_EXISTS', 'You already have an application in progress');
  if (!a || a.status === 'rejected') a = new CreatorApplication({ user: req.user!.id, status: 'draft', email: req.user!.email });
  for (const f of ['fullName', 'email', 'phone', 'city', 'state', 'categories', 'bio', 'links', 'monthlyCapacity', 'confirmsHandmade'] as const) if (body[f] !== undefined) (a as any)[f] = body[f];
  if (body.sampleImages) {
    if (!body.sampleImages.every(isOwnedImageUrl)) throw new AppError(422, 'INVALID_IMAGE', 'Photos must be uploaded through this site');
    a.sampleImages = body.sampleImages.map((url: string) => ({ url })) as any;
  }
  if (body.acceptedTerms !== undefined) a.acceptedTermsVersion = body.acceptedTerms ? CREATOR_TERMS_VERSION : (undefined as any);
  if (body.submit) {
    const merged = { ...view(a), acceptedTerms: a.acceptedTermsVersion === CREATOR_TERMS_VERSION };
    const r = fullApplication.safeParse(merged);
    if (!r.success) throw r.error;
    a.status = 'submitted'; a.decisions.push({ status: 'submitted', at: new Date() } as any);
  }
  await a.save();
  if (body.submit) {
    const admins = await User.find({ role: { $in: ['admin', 'super_admin'] }, status: 'active' }).select('_id').limit(25);
    await Promise.all(admins.map((u) => notify(u._id, { type: 'creator_application', title: 'New creator application', body: a!.fullName ?? undefined, link: '/admin/creators' })));
    await notify(req.user!.id, { type: 'application_received', title: 'We received your creator application', body: 'We will review it and get back to you.', email: { subject: 'We received your creator application', text: 'Thanks for applying. We will review your application and be in touch.' } });
  }
  res.status(body.submit ? 201 : 200).json({ application: view(a) });
}));

adminCreatorAppsRouter.use(requireAuth, requireAdmin);
adminCreatorAppsRouter.get('/applications', asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1); const limit = 25;
  const f: Record<string, unknown> = {}; if (typeof req.query.status === 'string') f.status = req.query.status;
  const [items, total] = await Promise.all([CreatorApplication.find(f).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit), CreatorApplication.countDocuments(f)]);
  res.json({ items: items.map(view), page, total });
}));
adminCreatorAppsRouter.get('/applications/:id', asyncHandler(async (req, res) => {
  const a = await CreatorApplication.findById(req.params.id); if (!a) throw notFound('Application not found');
  res.json({ application: view(a) });
}));

const FLOW: Record<string, string[]> = { submitted: ['under_review', 'approved', 'rejected', 'more_info_requested'], under_review: ['approved', 'rejected', 'more_info_requested'] };
// Only an admin can approve. Approval creates the creator profile and upgrades the user, atomically.
adminCreatorAppsRouter.post('/applications/:id/decision', validateBody(decisionSchema), asyncHandler(async (req, res) => {
  const { status, note } = req.body;
  const result = await withTx(async (session) => {
    const a = await CreatorApplication.findById(req.params.id).session(session); if (!a) throw notFound('Application not found');
    if (!FLOW[a.status]?.includes(status)) throw new AppError(409, 'INVALID_APPLICATION_TRANSITION', `Cannot move an application from "${a.status}" to "${status}"`);
    const before = a.status;
    a.status = status; a.decisions.push({ status, note, by: req.user!.id, at: new Date() } as any); await a.save({ session });
    let profile = null;
    if (status === 'approved') {
      const user = await User.findById(a.user).session(session); if (!user) throw notFound('Applicant not found');
      if (user.role === 'customer') user.role = 'creator'; await user.save({ session });
      profile = (await CreatorProfile.findOne({ user: a.user }).session(session)) ?? (await CreatorProfile.create([{ user: a.user, application: a._id, slug: uniqueSlug(a.fullName ?? 'creator'), displayName: a.fullName, bio: a.bio, specialties: a.categories, city: a.city, state: a.state, termsVersion: a.acceptedTermsVersion, publicFields: { city: false, bio: true, story: true, links: false } } as any], { session }))[0];
    }
    return { a, before, profile };
  });
  await audit(req, { action: `creator_application.${status}`, entityType: 'CreatorApplication', entityId: result.a._id, before: { status: result.before }, after: { status }, note });
  const copy: Record<string, [string, string]> = { approved: ['Your creator application was approved', 'Welcome to the collective! You can now add products from your creator dashboard.'], rejected: ['Update on your creator application', `We are unable to approve your application right now. ${note ?? ''}`], more_info_requested: ['We need a little more information', note ?? ''], under_review: ['Your application is under review', 'A team member is reviewing your application.'] };
  await notify(result.a.user, { type: `application_${status}`, title: copy[status]![0], body: copy[status]![1], link: status === 'approved' ? '/creator/dashboard' : '/creator/apply', email: { subject: copy[status]![0], text: copy[status]![1] } });
  res.json({ application: view(result.a), creatorSlug: result.profile?.slug });
}));
export { creatorStatusSchema };
