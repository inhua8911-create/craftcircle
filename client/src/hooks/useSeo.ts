import { useEffect } from 'react';
import { brand } from '../config/brand';
interface Seo { title?: string; description?: string; image?: string; noindex?: boolean; jsonLd?: object; canonicalPath?: string }
function setMeta(attr: 'name' | 'property', key: string, value?: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!value) { el?.remove(); return; }
  if (!el) { el = document.createElement('meta'); el.setAttribute(attr, key); document.head.appendChild(el); }
  el.setAttribute('content', value);
}
/** Per-page title/description/canonical/Open Graph. Private pages pass noindex. */
export function useSeo({ title, description, image, noindex, jsonLd, canonicalPath }: Seo) {
  useEffect(() => {
    const full = title ? `${title} | ${brand.name}` : `${brand.name}: ${brand.tagline}`;
    document.title = full;
    setMeta('name', 'description', description);
    setMeta('name', 'robots', noindex ? 'noindex, nofollow' : undefined);
    setMeta('property', 'og:title', full); setMeta('property', 'og:description', description); setMeta('property', 'og:type', 'website');
    setMeta('property', 'og:image', image ? new URL(image, location.origin).href : undefined);
    let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) { link = document.createElement('link'); link.rel = 'canonical'; document.head.appendChild(link); }
    link.href = location.origin + (canonicalPath ?? location.pathname);
    let ld = document.getElementById('jsonld');
    if (jsonLd) { if (!ld) { ld = document.createElement('script'); ld.id = 'jsonld'; (ld as HTMLScriptElement).type = 'application/ld+json'; document.head.appendChild(ld); } ld.textContent = JSON.stringify(jsonLd); } else ld?.remove();
    return () => { document.getElementById('jsonld')?.remove(); };
  }, [title, description, image, noindex, canonicalPath, JSON.stringify(jsonLd)]);
}
