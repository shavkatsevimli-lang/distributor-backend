export type OrderStatus = 'new' | 'approved' | 'delivered';

export interface Product {
  id: number;
  tenantId: number;
  name: string;
  price: number;
  stock: number;
  isVisible: boolean;
  category: string;
  imageUrl: string;
  description: string;
  lowStockThreshold: number;
}

export interface Order {
  id: number;
  tenantId?: number;
  storeId?: number;
  productId: number;
  productName: string;
  qty: number;
  price: number;
  customerName: string;
  status: OrderStatus;
  createdAt: string;
}

export interface Store {
  id: number;
  tenantId: number;
  fullName: string;
  phone: string;
  password: string;
  lastIssuedPassword?: string;
  role: 'client';
  address: string;
}

export interface Tenant {
  id: number;
  name: string;
  ownerName: string;
  phone: string;
  isActive: boolean;
  maxStores: number;
  subscriptionEndsAt: string;
  locale: 'uz' | 'ru' | 'en';
  adminFullName?: string;
  adminPhone?: string;
  adminPassword?: string;
}

export interface BusinessAdmin {
  id: number;
  tenantId: number;
  fullName: string;
  phone: string;
  password: string;
  lastIssuedPassword?: string;
  passwordSetupRequired?: boolean;
  role: 'business_admin';
}

export interface StoreStats {
  storeId: number;
  storeName: string;
  deliveredOrders: number;
  deliveredRevenue: number;
  pendingOrders: number;
  bonusBalance: number;
  monthlyScore: number;
  rank: number;
  tier: string;
}

export interface LeaderboardEntry {
  rank: number;
  storeId: number;
  storeName: string;
  tier: string;
  deliveredRevenue: number;
  deliveredOrders: number;
  bonusBalance: number;
}

export interface AdminDashboard {
  totalStores: number;
  activeProducts: number;
  hiddenProducts: number;
  pendingOrders: number;
  deliveredOrders: number;
  todayRevenue: number;
  monthRevenue: number;
  lowStockProducts: Product[];
  topStores: LeaderboardEntry[];
}

export interface ClientDashboard {
  store: {
    id: number;
    fullName: string;
    address: string;
  };
  stats: StoreStats;
  leaderboard: LeaderboardEntry[];
}

export interface PasswordResetRequest {
  id: number;
  tenantId?: number;
  storeId: number;
  phone: string;
  storeName: string;
  status: 'pending' | 'resolved';
  requestedAt: string;
  resolvedAt?: string | null;
}

export interface LoginPayload {
  phone?: string;
  password?: string;
}

export interface SetupBusinessAdminPasswordPayload {
  phone?: string;
  newPassword?: string;
}

export interface CreateOrderPayload {
  productId?: number;
  productName?: string;
  qty?: number;
  price?: number;
  customerName?: string;
}

export interface UpdateStatusPayload {
  status?: string;
}

export interface PasswordResetRequestPayload {
  phone?: string;
}

export interface ResolvePasswordResetPayload {
  newPassword?: string;
}

export interface SaveProductPayload {
  id?: number;
  tenantId?: number;
  name?: string;
  price?: number;
  stock?: number;
  isVisible?: boolean;
  category?: string;
  imageUrl?: string;
  description?: string;
  lowStockThreshold?: number;
}

export interface SaveTenantPayload {
  id?: number;
  name?: string;
  ownerName?: string;
  phone?: string;
  isActive?: boolean;
  maxStores?: number;
  subscriptionEndsAt?: string;
  locale?: 'uz' | 'ru' | 'en';
  adminFullName?: string;
  adminPhone?: string;
  adminPassword?: string;
}

export interface SaveStorePayload {
  id?: number;
  tenantId?: number;
  fullName?: string;
  phone?: string;
  password?: string;
  lastIssuedPassword?: string;
  address?: string;
}

export interface GrantSubscriptionPayload {
  months?: number;
}

export interface SetTenantAccessPayload {
  isActive?: boolean;
}

export interface OwnerDashboard {
  totalTenants: number;
  activeTenants: number;
  blockedTenants: number;
  expiringSoonTenants: Tenant[];
  monthlyRevenueForecast: number;
}
