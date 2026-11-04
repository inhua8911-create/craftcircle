import { Component, lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { RequireAuth, RequireCreator, RequireStaff } from './components/RequireAuth';
import { ErrorState, Spinner } from './components/ui';
import Home from './pages/Home';
import Shop from './pages/Shop';
import ProductPage from './pages/Product';
import { CollectionPage, CreatorPage } from './pages/Creator';
import Search from './pages/Search';
import CartPage from './pages/Cart';
import { ForgotPassword, Login, Register, ResetPassword } from './pages/Auth';
import NotFound from './pages/NotFound';
import { About, BecomeCreator, Contact, FAQ, HowItWorks, Privacy, Returns, ShippingPolicy, Terms } from './pages/Info';
const Checkout = lazy(() => import('./pages/Checkout'));
const Apply = lazy(() => import('./pages/Apply'));
// Route-level code splitting for named exports.
const lz = (load: () => Promise<Record<string, unknown>>, name: string) => lazy(async () => ({ default: (await load())[name] as React.ComponentType }));
const account = () => import('./pages/Account'); const result = () => import('./pages/CheckoutResult');
const AccountLayout = lz(account, 'AccountLayout'); const Profile = lz(account, 'Profile'); const Orders = lz(account, 'Orders'); const OrderDetail = lz(account, 'OrderDetail'); const Addresses = lz(account, 'Addresses'); const Wishlist = lz(account, 'Wishlist');
const Success = lz(result, 'CheckoutSuccess'); const Cancel = lz(result, 'CheckoutCancel');

const adm = { kit: () => import('./components/admin/kit'), overview: () => import('./pages/admin/Overview'), people: () => import('./pages/admin/People'), products: () => import('./pages/admin/Products'), ops: () => import('./pages/admin/Operations'), config: () => import('./pages/admin/Config') };
const AdminLayout = lz(adm.kit, 'AdminLayout'); const AdminOverview = lazy(adm.overview);
const Applications = lz(adm.people, 'Applications'); const Creators = lz(adm.people, 'Creators'); const CreatorDetail = lz(adm.people, 'CreatorDetail');
const AdminProducts = lz(adm.products, 'Products'); const AdminProductDetail = lz(adm.products, 'ProductDetail');
const AdminOrders = lz(adm.ops, 'Orders'); const AdminOrderDetail = lz(adm.ops, 'OrderDetail'); const Payouts = lz(adm.ops, 'Payouts');
const Promotions = lz(adm.config, 'Promotions'); const Reports = lz(adm.config, 'Reports'); const SettingsPage = lz(adm.config, 'SettingsPage'); const Users = lz(adm.config, 'Users'); const AuditLog = lz(adm.config, 'AuditLog');

const cr = { layout: () => import('./components/creator/Layout'), portal: () => import('./pages/creator/Portal'), products: () => import('./pages/creator/Products'), profile: () => import('./pages/creator/Profile') };
const CreatorLayout = lz(cr.layout, 'CreatorLayout'); const NotificationsList = lz(cr.layout, 'NotificationsList');
const CDashboard = lz(cr.portal, 'Dashboard'); const CEarnings = lz(cr.portal, 'Earnings'); const CIncentives = lz(cr.portal, 'Incentives'); const CNotifications = lz(cr.portal, 'NotificationsPage');
const MyProducts = lz(cr.products, 'MyProducts'); const ProductForm = lz(cr.products, 'ProductForm'); const CProfile = lazy(cr.profile);

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <ErrorState message="Something went wrong on this page." onRetry={() => location.reload()} /> : this.props.children; }
}
const guard = (el: ReactNode) => <RequireAuth>{el}</RequireAuth>;
export default function App() {
  return (
    <Boundary>
      <Suspense fallback={<div className="grid place-items-center py-24"><Spinner /></div>}>
        <Routes>
          <Route path="creator" element={<RequireCreator><CreatorLayout /></RequireCreator>}>
            <Route path="dashboard" element={<CDashboard />} /><Route path="products" element={<MyProducts />} /><Route path="products/new" element={<ProductForm />} /><Route path="products/:id/edit" element={<ProductForm />} />
            <Route path="earnings" element={<CEarnings />} /><Route path="incentives" element={<CIncentives />} /><Route path="notifications" element={<CNotifications />} /><Route path="profile" element={<CProfile />} />
            <Route index element={<Navigate to="/creator/dashboard" replace />} /><Route path="*" element={<NotFound />} />
          </Route>
          <Route path="admin" element={<RequireStaff><AdminLayout /></RequireStaff>}>
            <Route index element={<AdminOverview />} />
            <Route path="applications" element={<Applications />} /><Route path="creators" element={<Creators />} /><Route path="creators/:id" element={<CreatorDetail />} />
            <Route path="products" element={<AdminProducts />} /><Route path="products/pending" element={<Navigate to="/admin/products?tab=pending" replace />} /><Route path="products/:id" element={<AdminProductDetail />} />
            <Route path="orders" element={<AdminOrders />} /><Route path="orders/:id" element={<AdminOrderDetail />} /><Route path="payouts" element={<Payouts />} />
            <Route path="promotions" element={<Promotions />} /><Route path="reports" element={<Reports />} /><Route path="users" element={<Users />} /><Route path="settings" element={<SettingsPage />} /><Route path="audit" element={<AuditLog />} />
            <Route path="*" element={<NotFound />} />
          </Route>
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="shop" element={<Shop />} /><Route path="categories/:slug" element={<Shop />} />
            <Route path="products/:slug" element={<ProductPage />} /><Route path="creators/:slug" element={<CreatorPage />} /><Route path="collections/:slug" element={<CollectionPage />} />
            <Route path="search" element={<Search />} /><Route path="cart" element={<CartPage />} />
            <Route path="login" element={<Login />} /><Route path="register" element={<Register />} /><Route path="forgot-password" element={<ForgotPassword />} /><Route path="reset-password" element={<ResetPassword />} />
            <Route path="checkout" element={guard(<Checkout />)} /><Route path="checkout/success" element={guard(<Success />)} /><Route path="checkout/cancel" element={guard(<Cancel />)} />
            <Route path="account" element={guard(<AccountLayout />)}><Route index element={<Profile />} /><Route path="orders" element={<Orders />} /><Route path="orders/:id" element={<OrderDetail />} /><Route path="addresses" element={<Addresses />} /></Route>
            <Route path="wishlist" element={guard(<Wishlist />)} />
            <Route path="creator/apply" element={guard(<Apply />)} /><Route path="account/notifications" element={guard(<div className="container-page max-w-2xl py-10"><h1 className="mb-6 text-4xl">Notifications</h1><NotificationsList /></div>)} />
            <Route path="about" element={<About />} /><Route path="how-it-works" element={<HowItWorks />} /><Route path="become-a-creator" element={<BecomeCreator />} />
            <Route path="contact" element={<Contact />} /><Route path="faq" element={<FAQ />} /><Route path="shipping-policy" element={<ShippingPolicy />} />
            <Route path="returns-refunds" element={<Returns />} /><Route path="privacy-policy" element={<Privacy />} /><Route path="terms" element={<Terms />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </Suspense>
    </Boundary>
  );
}
