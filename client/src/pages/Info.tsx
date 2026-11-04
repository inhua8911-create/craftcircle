import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { brand } from '../config/brand';
import { formatINR } from '../lib/format';
import { useStore } from '../hooks/queries';
import { useSeo } from '../hooks/useSeo';
import { Alert } from '../components/ui';

function Page({ title, intro, draft, children }: { title: string; intro?: string; draft?: boolean; children: ReactNode }) {
  useSeo({ title, description: intro });
  return (
    <div className="container-page max-w-3xl py-12">
      <h1 className="text-4xl md:text-5xl">{title}</h1>{intro && <p className="mt-4 text-lg text-muted">{intro}</p>}
      {draft && <div className="mt-6"><Alert tone="info"><strong>Draft policy.</strong> This text is an editable starting point and has not been legally reviewed. It is not legal advice. Have it reviewed before you launch.</Alert></div>}
      <div className="mt-8 space-y-5 leading-relaxed [&_h2]:mt-10 [&_h2]:text-2xl [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6">{children}</div>
    </div>
  );
}
export const About = () => (
  <Page title="Our story" intro={`${brand.name} is a collective for independent makers and the people who love what they make.`}>
    <p>Behind every handmade piece is a person, a process and a lot of patience. We started this collective so makers can spend their time making, while we take care of the rest: curating, photographing, promoting and selling their work, and looking after every customer.</p>
    <p>Makers agree a fixed amount for each piece with us up front. That amount is not reduced by discounts, and every maker can see their sales and payout statements at any time.</p>
    <h2>What we believe</h2><ul><li>Handmade should be fairly paid, and the terms should be clear.</li><li>Every listing is reviewed by a person before it goes live.</li><li>Made-to-order and personalised pieces should always be labelled as such.</li></ul>
    <p><Link to="/become-a-creator" className="link">Interested in selling with us?</Link></p>
  </Page>
);
export const HowItWorks = () => (
  <Page title="How it works" intro="For customers and for makers.">
    <h2>If you're shopping</h2><ul><li>Browse pieces by category, maker or collection.</li><li>Your items are held for 30 minutes while you check out.</li><li>We dispatch, and you can follow your order from your account.</li></ul>
    <h2>If you're a maker</h2><ul><li><strong>Apply.</strong> Tell us about your craft and share photos of your work.</li><li><strong>Get approved.</strong> A member of our team reviews every application.</li><li><strong>List your pieces.</strong> Suggest a retail price and the amount you'd like to receive per unit. We confirm the final terms with you before anything goes live.</li><li><strong>We sell.</strong> You see each sale and what you've earned. Earnings become payable after the return window, and payouts are made by bank transfer with a statement.</li></ul>
    <p><Link to="/become-a-creator" className="btn btn-primary">Become a creator</Link></p>
  </Page>
);
export const BecomeCreator = () => (
  <Page title="Become a creator" intro="Sell your handmade work through a collective that handles the rest.">
    <ul><li>Handmade jewellery, crochet and knits, art, décor, stationery, resin art and personalised gifts are all welcome.</li><li>You agree your per-piece amount with us in advance. Discounts never reduce it.</li><li>You get a dashboard with sales, earnings and payout statements.</li><li>Optional incentives may run from time to time. Their rules are always published and are never guaranteed income.</li></ul>
    <p>Applications are reviewed by our team. We may ask for more information or photos.</p>
    <p><Link to="/creator/apply" className="btn btn-primary">Start your application</Link></p>
  </Page>
);
export function Contact() {
  const { data } = useStore(); const email = data?.contact.email ?? brand.supportEmail;
  return <Page title="Contact us" intro="We read every message."><p>Email us at <a className="link" href={`mailto:${email}`}>{email}</a>.{data?.contact.phone && <> Phone: {data.contact.phone}.</>}</p>{data?.contact.address && <p>{data.contact.address}</p>}<p>Please include your order number if your message is about an order.</p></Page>;
}
export const FAQ = () => {
  const items: [string, ReactNode][] = [
    ['Are the products really handmade?', 'Every maker confirms their work is handmade when they apply, and each listing is reviewed before it goes live. Made-to-order and personalised items are labelled on the product page.'],
    ['How long will my order take?', 'Each maker sets a dispatch time for their pieces, shown on the product page when provided. Made-to-order items take longer.'],
    ['Can I return something?', <>See our <Link to="/returns-refunds" className="link">returns & refunds policy</Link>.</>],
    ['How do payments work?', 'Payments are processed by a payment provider; this site never stores card details. When the store is in demo mode, payments are simulated and nothing is charged.'],
    ['I want to sell my work. What next?', <>Read <Link to="/become-a-creator" className="link">Become a creator</Link> and send an application.</>],
  ];
  return <Page title="Frequently asked questions">{items.map(([q, a]) => <details key={q} className="card group p-5"><summary className="cursor-pointer list-none font-medium after:float-right after:text-terracotta after:content-['+'] group-open:after:content-['−']">{q}</summary><p className="mt-3 text-muted">{a}</p></details>)}</Page>;
};
export function ShippingPolicy() {
  const { data } = useStore(); const flat = data?.shipping.flatRatePaise ?? 0; const free = data?.shipping.freeAboveCartPaise;
  return <Page title="Shipping policy" draft><p>We currently deliver within India.</p><p>{flat ? `Standard shipping is ${formatINR(flat)} per order${free != null ? `, and free on orders above ${formatINR(free)}` : ''}.` : 'Shipping charges, if any, are shown at checkout before you pay.'}</p><h2>Dispatch times</h2><p>Dispatch times are set by each maker and shown on the product page when available. Made-to-order and personalised items are made after you order.</p><h2>Tracking</h2><p>When your order ships, we add the courier and tracking number to your order page.</p></Page>;
}
export const Returns = () => (
  <Page title="Returns & refunds" draft><p>If something arrives damaged or isn't as described, contact us with your order number and photos as soon as you can.</p><h2>Personalised and made-to-order items</h2><p>Because these are made for you, they may not be returnable unless faulty. Terms will be stated here before launch.</p><h2>Refunds</h2><p>Approved refunds go back to your original payment method. Timing depends on your bank or payment provider.</p></Page>
);
export const Privacy = () => (
  <Page title="Privacy policy" draft><p>We collect the details you give us (name, email, phone, delivery address) to take and deliver orders, run your account and contact you about them. We do not store card details.</p><h2>Cookies</h2><p>We use a sign-in cookie, a security (CSRF) cookie and a cart cookie. They are needed for the site to work.</p><h2>Your choices</h2><p>You can update your details in your account, unsubscribe from the newsletter, or contact us to ask about your data.</p></Page>
);
export const Terms = () => (
  <Page title="Terms of use" draft><p>By using this site and placing an order you agree to these terms. Prices are in Indian rupees. Items are held for a short time while you pay and released if payment is not completed.</p><h2>Makers</h2><p>Makers who sell through the collective agree separate creator terms, including the per-piece amounts agreed for each product.</p></Page>
);
