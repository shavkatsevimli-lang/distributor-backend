import type { BusinessAdmin, Order, Product, Store, Tenant } from './app.types';

const defaultSubscriptionEndsAt = new Date(
  Date.now() + 1000 * 60 * 60 * 24 * 30,
).toISOString();

export const seedTenants: Tenant[] = [
  {
    id: 1,
    name: 'Baraka Distribusiya',
    ownerName: 'Jahongir Aka',
    phone: '998907777777',
    isActive: true,
    maxStores: 500,
    subscriptionEndsAt: defaultSubscriptionEndsAt,
    locale: 'uz',
  },
];

export const seedBusinessAdmins: BusinessAdmin[] = [
  {
    id: 1,
    tenantId: 1,
    fullName: 'Baraka Admin',
    phone: process.env.ADMIN_PHONE ?? '999',
    password: process.env.ADMIN_PASSWORD ?? '999',
    role: 'business_admin',
  },
];

export const seedProducts: Product[] = [
  {
    id: 1,
    tenantId: 1,
    name: 'Shakar 1kg',
    price: 14000,
    stock: 120,
    isVisible: true,
    category: 'Oziq-ovqat',
    imageUrl:
      'https://images.unsplash.com/photo-1586201375761-83865001e31c?auto=format&fit=crop&w=900&q=80',
    description: 'Kunlik savdo uchun toza va ommabop shakar mahsuloti.',
    lowStockThreshold: 25,
  },
  {
    id: 2,
    tenantId: 1,
    name: 'Yog 1L',
    price: 18000,
    stock: 80,
    isVisible: true,
    category: 'Oziq-ovqat',
    imageUrl:
      'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?auto=format&fit=crop&w=900&q=80',
    description: '1 litrlik yog, tez aylanadigan kundalik mahsulot.',
    lowStockThreshold: 20,
  },
  {
    id: 3,
    tenantId: 1,
    name: 'Un 50kg',
    price: 320000,
    stock: 30,
    isVisible: true,
    category: 'Ulgurji',
    imageUrl:
      'https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=900&q=80',
    description: 'Ombor va non sexlari uchun 50kg un.',
    lowStockThreshold: 10,
  },
  {
    id: 4,
    tenantId: 1,
    name: 'Makaron',
    price: 12000,
    stock: 200,
    isVisible: true,
    category: 'Oziq-ovqat',
    imageUrl:
      'https://images.unsplash.com/photo-1516100882582-96c3a05fe590?auto=format&fit=crop&w=900&q=80',
    description: 'Kunlik xarid uchun arzon va tez yuradigan makaron.',
    lowStockThreshold: 35,
  },
  {
    id: 5,
    tenantId: 1,
    name: 'Choy 200g',
    price: 25000,
    stock: 0,
    isVisible: false,
    category: 'Ichimlik',
    imageUrl:
      'https://images.unsplash.com/photo-1558160074-4d7d8bdf4256?auto=format&fit=crop&w=900&q=80',
    description: 'Chakana savdo uchun premium choy qadoqlari.',
    lowStockThreshold: 15,
  },
];

export const seedStores: Store[] = [
  {
    id: 1,
    tenantId: 1,
    fullName: 'Ali Market',
    phone: process.env.CLIENT_PHONE ?? '998901234567',
    password: process.env.CLIENT_PASSWORD ?? '12345',
    role: 'client',
    address: 'Toshkent, Yunusobod',
  },
  {
    id: 3,
    tenantId: 1,
    fullName: 'Samarqand Savdo',
    phone: '998901111111',
    password: '12345',
    role: 'client',
    address: 'Samarqand, Registon',
  },
  {
    id: 4,
    tenantId: 1,
    fullName: 'Andijon Store',
    phone: '998902222222',
    password: '12345',
    role: 'client',
    address: 'Andijon, Markaz',
  },
  {
    id: 5,
    tenantId: 1,
    fullName: 'Buxoro Market',
    phone: '998903333333',
    password: '12345',
    role: 'client',
    address: 'Buxoro, Gijduvon',
  },
];

export const seedOrders: Order[] = [
  {
    id: 1,
    tenantId: 1,
    storeId: 3,
    productId: 2,
    productName: 'Yog 1L',
    qty: 12,
    price: 18000,
    customerName: 'Samarqand Savdo',
    status: 'delivered',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
  },
  {
    id: 2,
    tenantId: 1,
    storeId: 4,
    productId: 1,
    productName: 'Shakar 1kg',
    qty: 20,
    price: 14000,
    customerName: 'Andijon Store',
    status: 'delivered',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 18).toISOString(),
  },
  {
    id: 3,
    tenantId: 1,
    storeId: 5,
    productId: 4,
    productName: 'Makaron',
    qty: 25,
    price: 12000,
    customerName: 'Buxoro Market',
    status: 'approved',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
  },
];
