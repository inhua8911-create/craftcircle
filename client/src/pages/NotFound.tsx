import { EmptyState } from '../components/ui';
import { useSeo } from '../hooks/useSeo';
export default function NotFound() { useSeo({ title: 'Page not found', noindex: true }); return <div className="container-page"><EmptyState title="We couldn't find that page" action={{ to: '/shop', label: 'Browse the shop' }}>The link may be old or mistyped.</EmptyState></div>; }
