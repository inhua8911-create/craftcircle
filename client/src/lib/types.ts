export interface Product {
  id: string; slug: string; name: string; description: string; story?: string; pricePaise: number; materials?: string[]; dimensions?: string; colors?: string[];
  careInstructions?: string; personalizationOptions?: string; madeToOrder: boolean; dispatchDays: number | null; featured: boolean; isSample: boolean;
  rating: { average: number; count: number } | null; soldCount: number; category: string; creator: { slug: string; name: string } | null;
  images: { url: string; alt: string }[]; available: boolean; maxPurchasable: number;
}
export interface Paged<T> { items: T[]; page: number; limit: number; total: number; pages: number }
export interface Category { id: string; name: string; slug: string; parent: string | null; description?: string; banner?: { url?: string; alt?: string } }
export interface Creator { slug: string; name: string; specialties?: string[]; profileImage: string | null; bio?: string; story?: string; city?: string; links?: string[] }
export interface Collection { slug: string; title: string; description?: string; occasion?: string; banner?: { url?: string; alt?: string }; featured: boolean }
export interface CartLine { productId: string; quantity: number; issue: 'unavailable' | 'insufficient_stock' | null; product: Product | null; lineTotalPaise: number }
export interface CartView { items: CartLine[]; subtotalPaise: number; hasIssues: boolean }
export interface Me { id: string; name: string; email: string; role: 'customer' | 'creator' | 'admin' | 'super_admin'; phone?: string }
export interface StoreInfo { announcement: { text: string; link?: string } | null; shipping: { flatRatePaise: number; freeAboveCartPaise: number | null }; contact: { email?: string; phone?: string; address?: string }; socialLinks: { label: string; url: string }[]; instagramGallery: { imageUrl: string; link?: string; alt?: string }[]; paymentMode: 'mock' | 'razorpay' }
export interface Address { id: string; label?: string; isDefault: boolean; fullName: string; phone: string; line1: string; line2?: string; city: string; state: string; postalCode: string; country: string }
export interface Quote { subtotalPaise: number; discountPaise: number; shippingPaise: number; taxPaise: number; totalPaise: number; coupon: string | null; couponError?: string; issues: { productId: string; issue: string }[]; freeShippingAbovePaise?: number | null }
export interface Order {
  id: string; orderNumber: string; status: string; paymentStatus: string; simulated: boolean; createdAt: string; shippingAddress: Omit<Address, 'id' | 'isDefault' | 'label'>;
  shipment: { provider?: string; trackingNumber?: string; shippedAt?: string; deliveredAt?: string } | null;
  subtotalPaise: number; discountPaise: number; shippingPaise: number; taxPaise: number; totalPaise: number; refundedPaise: number; coupon: string | null; reservedUntil: string | null;
  items: { id: string; productId: string; name: string; slug?: string; quantity: number; unitPricePaise: number; lineTotalPaise: number; refundedQuantity: number }[];
}
export interface PaymentIntent { provider: 'mock' | 'razorpay'; simulated: boolean; providerOrderId: string; amountPaise: number; keyId?: string }
