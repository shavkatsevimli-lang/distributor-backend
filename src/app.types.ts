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
  batchId?: string | null;
  batchLabel?: string | null;
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
  passwordChangeRequired?: boolean;
  isActive?: boolean;
  role: 'client';
  address: string;
  approvalStatus?: 'pending' | 'approved' | 'rejected' | 'blocked';
}

export interface StoreOwnerProfile {
  id: number;
  fullName: string;
  phone: string;
  password: string;
  lastIssuedPassword?: string;
  isVerified: boolean;
}

export interface StoreLinkRequest {
  id: number;
  profileId: number;
  tenantId: number;
  tenantName: string;
  storeId: number;
  storeName: string;
  phone: string;
  address: string;
  status: 'pending' | 'approved' | 'rejected' | 'blocked';
  requestedAt: string;
  approvedAt?: string | null;
}

export interface StorePanelLink {
  tenantId: number;
  tenantName: string;
  storeId: number;
  storeName: string;
  phone: string;
  address: string;
  status: 'approved' | 'blocked';
}

export interface AdminRegistrationRequest {
  id: number;
  firmName: string;
  adminName: string;
  phone: string;
  password: string;
  status: 'pending' | 'approved' | 'rejected';
  requestedAt: string;
  processedAt?: string | null;
  tenantId?: number | null;
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
  topProducts: ClientTopProduct[];
  recentOrders: Order[];
}

export interface ClientTopProduct {
  productId: number;
  productName: string;
  totalQty: number;
  totalSpent: number;
  deliveredQty: number;
}

export interface OrderBatchSummary {
  batchId: string;
  batchLabel: string;
  tenantId?: number;
  storeId?: number;
  customerName: string;
  status: OrderStatus;
  createdAt: string;
  itemCount: number;
  totalQty: number;
  totalAmount: number;
  items: Order[];
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

export interface SetupStoreOwnerPasswordPayload {
  phone?: string;
  fullName?: string;
  newPassword?: string;
}

export interface SetupBusinessAdminPasswordPayload {
  phone?: string;
  newPassword?: string;
}

export interface CreateOrderPayload {
  tenantId?: number;
  storeId?: number;
  productId?: number;
  productName?: string;
  qty?: number;
  price?: number;
  customerName?: string;
}

export interface CartOrderItemPayload {
  productId?: number;
  productName?: string;
  qty?: number;
  price?: number;
}

export interface CreateCartOrderPayload {
  tenantId?: number;
  storeId?: number;
  customerName?: string;
  items?: CartOrderItemPayload[];
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
  passwordChangeRequired?: boolean;
  isActive?: boolean;
  address?: string;
}

export interface ChangeMarketPasswordPayload {
  phone?: string;
  currentPassword?: string;
  newPassword?: string;
}

export interface ResetAdminPasswordPayload {
  phone?: string;
  resetKey?: string;
  newPassword?: string;
}

export interface GrantSubscriptionPayload {
  months?: number;
}

export interface SetTenantAccessPayload {
  isActive?: boolean;
}

export interface SetStoreAccessPayload {
  isActive?: boolean;
}

export interface ResolveStoreLinkPayload {
  approved?: boolean;
}

export interface RequestStoreLinkPayload {
  phone?: string;
  firmQuery?: string;
}

export interface CreateAdminRegistrationRequestPayload {
  firmName?: string;
  adminName?: string;
  phone?: string;
  password?: string;
}

export interface ResolveAdminRegistrationRequestPayload {
  approved?: boolean;
}

export interface NextStoreIdResponse {
  nextId: number;
}

export interface OwnerDashboard {
  totalTenants: number;
  activeTenants: number;
  blockedTenants: number;
  expiringSoonTenants: Tenant[];
  monthlyRevenueForecast: number;
}
