import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from './components/Toast';
import { ApiError } from './lib/api';
import App from './App';
import './index.css';

const client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: (n, e) => !(e instanceof ApiError && e.status < 500 && e.status !== 0) && n < 2 } } });
createRoot(document.getElementById('root')!).render(
  <StrictMode><QueryClientProvider client={client}><BrowserRouter><ToastProvider><App /></ToastProvider></BrowserRouter></QueryClientProvider></StrictMode>,
);
