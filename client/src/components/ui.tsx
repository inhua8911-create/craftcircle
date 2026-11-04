import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, Loader2 } from 'lucide-react';
import { formatINR } from '../lib/format';

export const Spinner = ({ label = 'Loading' }: { label?: string }) => <Loader2 aria-label={label} className="h-5 w-5 animate-spin text-forest" />;
export const Skeleton = ({ className = '' }: { className?: string }) => <div aria-hidden className={`skeleton ${className}`} />;
export const Price = ({ paise, className = '' }: { paise: number; className?: string }) => <span className={`tabular-nums ${className}`}>{formatINR(paise)}</span>;
export const Badge = ({ children, tone = 'forest' }: { children: ReactNode; tone?: 'forest' | 'terracotta' | 'rose' | 'muted' }) => {
  const t = { forest: 'bg-forest-50 text-forest', terracotta: 'bg-terracotta-50 text-terracotta', rose: 'bg-rose-50 text-charcoal', muted: 'bg-cream text-muted' }[tone];
  return <span className={`inline-block rounded-sm px-2 py-0.5 text-xs font-semibold ${t}`}>{children}</span>;
};
export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: { to: string; label: string } }) {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h2 className="text-2xl">{title}</h2>
      {children && <p className="mt-3 text-muted">{children}</p>}
      {action && <Link to={action.to} className="btn btn-primary mt-6">{action.label}</Link>}
    </div>
  );
}
export function ErrorState({ message = 'Something went wrong.', onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="mx-auto max-w-md py-16 text-center">
      <AlertCircle className="mx-auto h-8 w-8 text-terracotta" aria-hidden />
      <p className="mt-3 text-charcoal">{message}</p>
      {onRetry && <button onClick={onRetry} className="btn btn-outline mt-5">Try again</button>}
    </div>
  );
}
export const Alert = ({ children, tone = 'error' }: { children: ReactNode; tone?: 'error' | 'info' | 'success' }) => (
  <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-sm border px-4 py-3 text-sm ${tone === 'error' ? 'border-[#d9a79d] bg-[#fbeeea] text-[#7a2a1c]' : tone === 'success' ? 'border-forest/30 bg-forest-50 text-forest' : 'border-line bg-cream text-charcoal'}`}>{children}</div>
);

/** Product/category imagery: lazy, async-decoded, reserved aspect ratio so layout never jumps. */
export function Img({ src, alt, ratio = '1 / 1', className = '', eager = false }: { src?: string; alt: string; ratio?: string; className?: string; eager?: boolean }) {
  return (
    <div className={`overflow-hidden bg-cream ${className}`} style={{ aspectRatio: ratio }}>
      {src && <img src={src} alt={alt} loading={eager ? 'eager' : 'lazy'} decoding="async" className="h-full w-full object-cover" />}
    </div>
  );
}

interface FieldProps { label: string; error?: string; hint?: string }
export const TextField = forwardRef<HTMLInputElement, FieldProps & InputHTMLAttributes<HTMLInputElement>>(({ label, error, hint, className = '', ...rest }, ref) => {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">{label}</label>
      <input id={id} ref={ref} className="input" aria-invalid={!!error} aria-describedby={error ? `${id}-e` : hint ? `${id}-h` : undefined} {...rest} />
      {hint && !error && <p id={`${id}-h`} className="mt-1 text-xs text-muted">{hint}</p>}
      {error && <p id={`${id}-e`} className="mt-1 text-sm text-[#a63a2a]">{error}</p>}
    </div>
  );
});
TextField.displayName = 'TextField';
export const TextArea = forwardRef<HTMLTextAreaElement, FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>>(({ label, error, hint, className = '', ...rest }, ref) => {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">{label}</label>
      <textarea id={id} ref={ref} rows={5} className="input" aria-invalid={!!error} aria-describedby={error ? `${id}-e` : undefined} {...rest} />
      {hint && !error && <p className="mt-1 text-xs text-muted">{hint}</p>}
      {error && <p id={`${id}-e`} className="mt-1 text-sm text-[#a63a2a]">{error}</p>}
    </div>
  );
});
TextArea.displayName = 'TextArea';
export const SelectField = forwardRef<HTMLSelectElement, FieldProps & SelectHTMLAttributes<HTMLSelectElement>>(({ label, error, className = '', children, ...rest }, ref) => {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">{label}</label>
      <select id={id} ref={ref} className="input" aria-invalid={!!error} {...rest}>{children}</select>
      {error && <p className="mt-1 text-sm text-[#a63a2a]">{error}</p>}
    </div>
  );
});
SelectField.displayName = 'SelectField';
