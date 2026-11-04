import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
const Ctx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(Ctx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState('');
  const toast = useCallback((m: string) => { setMsg(m); window.setTimeout(() => setMsg((cur) => (cur === m ? '' : cur)), 3500); }, []);
  return (
    <Ctx.Provider value={toast}>
      {children}
      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
        {msg && <div className="pointer-events-auto rounded-sm bg-forest px-4 py-3 text-sm text-ivory shadow-soft">{msg}</div>}
      </div>
    </Ctx.Provider>
  );
}
