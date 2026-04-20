import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { DatabaseService } from './database.service';
import {
  AdminDashboard,
  BusinessAdmin,
  CreateOrderPayload,
  ClientDashboard,
  GrantSubscriptionPayload,
  LeaderboardEntry,
  LoginPayload,
  OwnerDashboard,
  Order,
  OrderStatus,
  PasswordResetRequest,
  PasswordResetRequestPayload,
  Product,
  ResolvePasswordResetPayload,
  SaveProductPayload,
  SaveStorePayload,
  SaveTenantPayload,
  SetupBusinessAdminPasswordPayload,
  SetTenantAccessPayload,
  Store,
  StoreStats,
  Tenant,
  UpdateStatusPayload,
} from './app.types';
import {
  seedBusinessAdmins,
  seedOrders,
  seedProducts,
  seedStores,
  seedTenants,
} from './seed-data';

@Injectable()
export class AppService {
  private readonly products: Product[] = [...seedProducts];
  private readonly tenants: Tenant[] = [...seedTenants];
  private readonly businessAdmins: BusinessAdmin[] = seedBusinessAdmins.map((admin) => ({
    ...admin,
    lastIssuedPassword: admin.lastIssuedPassword ?? admin.password,
    password: this.protectPassword(admin.password),
  }));
  private readonly stores: Store[] = seedStores.map((store) => ({
    ...store,
    lastIssuedPassword: store.lastIssuedPassword ?? store.password,
    password: this.protectPassword(store.password),
  }));
  private readonly orders: Order[] = [...seedOrders];
  private readonly passwordResetRequests: PasswordResetRequest[] = [];

  private readonly platformOwner = {
    id: 999,
    fullName: process.env.OWNER_FULL_NAME ?? 'Platform Owner',
    phone: process.env.OWNER_PHONE ?? '111',
    password: this.protectPassword(process.env.OWNER_PASSWORD ?? '111'),
    role: 'platform_owner',
  } as const;

  constructor(private readonly databaseService: DatabaseService) {}

  getHello(): string {
    return 'DistributorPro backend is running';
  }

  getVersion() {
    return {
      app: 'DistributorPro SaaS Backend',
      version: '2026.04.20-owner-panel',
      ownerLoginEnabled: true,
      businessAdminEnabled: true,
      clientAppEnabled: true,
    };
  }

  async getProducts(): Promise<Product[]> {
    const products = await this.loadProducts();
    return products.filter((product) => product.isVisible);
  }

  async getTenantProducts(tenantId: number): Promise<Product[]> {
    if (!Number.isInteger(tenantId) || tenantId <= 0) {
      throw new BadRequestException('Tenant ID xato');
    }

    const products = await this.loadProducts();
    return products.filter(
      (product) => product.tenantId === tenantId && product.isVisible,
    );
  }

  async getAdminProducts(): Promise<Product[]> {
    return this.loadProducts();
  }

  async getAdminStores(): Promise<Store[]> {
    const stores = await this.loadStores();
    return stores.map((store) => ({
      ...store,
      password: '',
      lastIssuedPassword:
        store.lastIssuedPassword ?? this.visiblePassword(store.password),
    }));
  }

  async getOwnerDashboard(): Promise<OwnerDashboard> {
    const tenants = await this.loadTenants();
    const now = Date.now();
    const activeTenants = tenants.filter((tenant) => this.isTenantAccessible(tenant));
    const blockedTenants = tenants.filter((tenant) => !this.isTenantAccessible(tenant));
    const expiringSoonTenants = tenants.filter((tenant) => {
      const remaining = new Date(tenant.subscriptionEndsAt).getTime() - now;
      return remaining > 0 && remaining <= 1000 * 60 * 60 * 24 * 7;
    });

    return {
      totalTenants: tenants.length,
      activeTenants: activeTenants.length,
      blockedTenants: blockedTenants.length,
      expiringSoonTenants,
      monthlyRevenueForecast: activeTenants.length * 300000,
    };
  }

  async getOwnerTenants(): Promise<Tenant[]> {
    const [tenants, businessAdmins] = await Promise.all([
      this.loadTenants(),
      this.loadBusinessAdmins(),
    ]);

    return tenants.map((tenant) => {
      const admin = businessAdmins.find((item) => item.tenantId === tenant.id);
      return {
        ...tenant,
        adminFullName: admin?.fullName ?? '',
        adminPhone: admin?.phone ?? '',
        adminPassword: admin?.passwordSetupRequired
          ? 'Biznes egasi o\'zi yaratadi'
          : admin?.lastIssuedPassword ?? this.visiblePassword(admin?.password ?? ''),
      };
    });
  }

  async getOrders(): Promise<Order[]> {
    return this.loadOrders();
  }

  async getAdminDashboard(): Promise<AdminDashboard> {
    const [products, stores, orders] = await Promise.all([
      this.loadProducts(),
      this.loadStores(),
      this.loadOrders(),
    ]);
    const leaderboard = this.buildLeaderboard(stores, orders);
    const deliveredOrders = orders.filter((order) => order.status === 'delivered');
    const todayKey = new Date().toISOString().slice(0, 10);
    const monthKey = todayKey.slice(0, 7);

    return {
      totalStores: stores.length,
      activeProducts: products.filter((product) => product.isVisible).length,
      hiddenProducts: products.filter((product) => !product.isVisible).length,
      pendingOrders: orders.filter((order) => order.status !== 'delivered').length,
      deliveredOrders: deliveredOrders.length,
      todayRevenue: deliveredOrders
        .filter((order) => order.createdAt.startsWith(todayKey))
        .reduce((sum, order) => sum + order.qty * order.price, 0),
      monthRevenue: deliveredOrders
        .filter((order) => order.createdAt.startsWith(monthKey))
        .reduce((sum, order) => sum + order.qty * order.price, 0),
      lowStockProducts: products.filter(
        (product) => product.stock <= product.lowStockThreshold,
      ),
      topStores: leaderboard.slice(0, 5),
    };
  }

  async getClientDashboard(storeId: number): Promise<ClientDashboard> {
    const [stores, orders] = await Promise.all([
      this.loadStores(),
      this.loadOrders(),
    ]);
    const store = stores.find((item) => item.id === storeId);

    if (!store) {
      throw new BadRequestException('Magazin topilmadi');
    }

    return {
      store: {
        id: store.id,
        fullName: store.fullName,
        address: store.address,
      },
      stats: this.buildStoreStats(store, stores, orders),
      leaderboard: this.buildLeaderboard(stores, orders).slice(0, 10),
    };
  }

  async getTenantClientDashboard(
    tenantId: number,
    storeId: number,
  ): Promise<ClientDashboard> {
    if (!Number.isInteger(tenantId) || tenantId <= 0) {
      throw new BadRequestException('Tenant ID xato');
    }

    const [stores, orders] = await Promise.all([
      this.loadStores(),
      this.loadOrders(),
    ]);
    const store = stores.find(
      (item) => item.id === storeId && item.tenantId === tenantId,
    );

    if (!store) {
      throw new BadRequestException('Magazin topilmadi');
    }

    const tenantStores = stores.filter((item) => item.tenantId === tenantId);
    const tenantOrders = orders.filter((item) => item.tenantId === tenantId);

    return {
      store: {
        id: store.id,
        fullName: store.fullName,
        address: store.address,
      },
      stats: this.buildStoreStats(store, tenantStores, tenantOrders),
      leaderboard: this.buildLeaderboard(tenantStores, tenantOrders).slice(0, 10),
    };
  }

  async createOrder(payload: CreateOrderPayload) {
    const [products, stores] = await Promise.all([
      this.loadProducts(),
      this.loadStores(),
    ]);

    const tenantId = Number(payload.tenantId);
    const storeId = Number(payload.storeId);
    const productId = Number(payload.productId);
    const qty = Number(payload.qty);
    const price = Number(payload.price);
    const customerName = this.cleanText(payload.customerName);
    const productName = this.cleanText(payload.productName);

    if (!Number.isInteger(productId) || productId <= 0) {
      throw new BadRequestException('Mahsulot ID xato');
    }

    if (!Number.isInteger(qty) || qty <= 0) {
      throw new BadRequestException('Zakaz soni xato');
    }

    if (!Number.isInteger(price) || price <= 0) {
      throw new BadRequestException('Narx xato');
    }

    if (!customerName) {
      throw new BadRequestException('Mijoz nomi kiritilishi shart');
    }

    if (!Number.isInteger(tenantId) || tenantId <= 0) {
      throw new BadRequestException('Tenant ID xato');
    }

    if (!Number.isInteger(storeId) || storeId <= 0) {
      throw new BadRequestException('Magazin ID xato');
    }

    const store = stores.find(
      (item) =>
        item.id === storeId &&
        item.tenantId === tenantId &&
        item.fullName.toLowerCase() === customerName.toLowerCase(),
    );
    if (!store) {
      throw new BadRequestException('Bu magazin tizimda topilmadi');
    }

    const product = products.find(
      (item) => item.id === productId && item.tenantId === tenantId,
    );
    if (!product) {
      throw new BadRequestException('Bunday mahsulot topilmadi');
    }

    if (!product.isVisible || product.stock <= 0) {
      throw new BadRequestException('Mahsulot hozircha buyurtmaga yopiq');
    }

    if (qty > product.stock) {
      throw new BadRequestException('Sklad miqdoridan oshib ketdi');
    }

    const newOrder: Order = {
      id: this.orders.length + 1,
      tenantId: store.tenantId,
      storeId: store.id,
      productId,
      productName: productName || product.name,
      qty,
      price,
      customerName,
      status: 'new',
      createdAt: new Date().toISOString(),
    };

    if (this.databaseService.isEnabled()) {
      const created = await this.databaseService.createOrder(newOrder);
      return {
        success: true,
        message: 'Zakaz qabul qilindi',
        order: created,
      };
    }

    this.orders.push(newOrder);
    product.stock -= qty;

    return {
      success: true,
      message: 'Zakaz qabul qilindi',
      order: newOrder,
    };
  }

  async updateOrderStatus(
    orderId: number,
    payload: UpdateStatusPayload,
    adminKey?: string,
  ) {
    this.ensureAdminKey(adminKey);

    if (!Number.isInteger(orderId) || orderId <= 0) {
      throw new BadRequestException('Zakaz ID xato');
    }

    const requestedStatus = this.normalizeStatus(payload.status);
    const orders = await this.loadOrders();
    const order = orders.find((item) => item.id === orderId);

    if (!order) {
      throw new BadRequestException('Zakaz topilmadi');
    }

    if (order.status === requestedStatus) {
      return {
        success: true,
        message: `Zakaz allaqachon ${requestedStatus} holatda`,
        order,
      };
    }

    if (!this.canMoveToNextStatus(order.status, requestedStatus)) {
      throw new BadRequestException(
        `Status faqat ketma-ket o'zgaradi: new -> approved -> delivered`,
      );
    }

    if (this.databaseService.isEnabled()) {
      const updated = await this.databaseService.updateOrderStatus(
        orderId,
        requestedStatus,
      );

      if (!updated) {
        throw new BadRequestException('Zakaz topilmadi');
      }

      return {
        success: true,
        message: `Zakaz #${updated.id} statusi ${requestedStatus} ga yangilandi`,
        order: updated,
      };
    }

    const memoryOrder = this.orders.find((item) => item.id === orderId);
    if (!memoryOrder) {
      throw new BadRequestException('Zakaz topilmadi');
    }

    memoryOrder.status = requestedStatus;

    return {
      success: true,
      message: `Zakaz #${memoryOrder.id} statusi ${requestedStatus} ga yangilandi`,
      order: memoryOrder,
    };
  }

  async login(payload: LoginPayload) {
    const [stores, tenants, businessAdmins] = await Promise.all([
      this.loadStores(),
      this.loadTenants(),
      this.loadBusinessAdmins(),
    ]);
    const phone = this.cleanText(payload.phone);
    const password = this.cleanText(payload.password);

    if (!phone || !password) {
      throw new BadRequestException('Telefon va parol kiritilishi shart');
    }

    if (
      phone === this.platformOwner.phone &&
      this.isPasswordMatch(password, this.platformOwner.password)
    ) {
      return {
        success: true,
        message: 'Platform owner login successful',
        user: {
          id: this.platformOwner.id,
          fullName: this.platformOwner.fullName,
          phone: this.platformOwner.phone,
          role: this.platformOwner.role,
          storeId: 0,
          bonusBalance: 0,
          tier: 'owner',
          tenantId: 0,
          subscriptionEndsAt: null,
          isBlocked: false,
        },
      };
    }

    const businessAdmin = businessAdmins.find(
      (item) => item.phone === phone,
    );
    if (businessAdmin) {
      const tenant = tenants.find((item) => item.id === businessAdmin.tenantId);
      if (!tenant) {
        return {
          success: false,
          message: 'Biznes tenant topilmadi',
        };
      }

      if (!this.isTenantAccessible(tenant)) {
        return {
          success: false,
          message:
            'Obuna muddati tugagan yoki panel bloklangan. To\'lov qilinmaguncha tizim yopiq.',
        };
      }

      if (businessAdmin.passwordSetupRequired) {
        return {
          success: false,
          message:
            'Bu admin uchun parol hali yaratilmagan. "Biznes admin parolini yaratish" tugmasidan foydalaning.',
        };
      }

      if (!this.isPasswordMatch(password, businessAdmin.password)) {
        throw new UnauthorizedException('Telefon yoki parol xato');
      }

      return {
        success: true,
        message: 'Business admin login successful',
        user: {
          id: businessAdmin.id,
          fullName: businessAdmin.fullName,
          phone: businessAdmin.phone,
          role: businessAdmin.role,
          storeId: 0,
          bonusBalance: 0,
          tier: 'admin',
          tenantId: tenant.id,
          tenantName: tenant.name,
          subscriptionEndsAt: tenant.subscriptionEndsAt,
          isBlocked: false,
        },
      };
    }

    const store = stores.find(
      (item) => item.phone === phone && this.isPasswordMatch(password, item.password),
    );
    if (store) {
      const tenant = tenants.find((item) => item.id === store.tenantId);
      if (!tenant || !this.isTenantAccessible(tenant)) {
        return {
          success: false,
          message:
            'Sizga biriktirilgan admin panelning obunasi tugagan. Biznes egasiga murojaat qiling.',
        };
      }

      const stats = this.buildStoreStats(store, stores, await this.loadOrders());
      return {
        success: true,
        message: 'Login successful',
        user: {
          id: store.id,
          fullName: store.fullName,
          phone: store.phone,
          role: store.role,
          storeId: store.id,
          bonusBalance: stats.bonusBalance,
          tier: stats.tier,
          tenantId: store.tenantId,
          tenantName: tenant.name,
          subscriptionEndsAt: tenant.subscriptionEndsAt,
          isBlocked: false,
        },
      };
    }

    throw new UnauthorizedException('Telefon yoki parol xato');
  }

  async requestPasswordReset(payload: PasswordResetRequestPayload) {
    const stores = await this.loadStores();
    const phone = this.cleanText(payload.phone);

    if (!phone) {
      throw new BadRequestException('Telefon raqam kiritilishi shart');
    }

    const store = stores.find((item) => item.phone === phone);
    if (!store) {
      throw new BadRequestException('Bu telefon bo\'yicha magazin topilmadi');
    }

    if (this.databaseService.isEnabled()) {
      const request = await this.databaseService.createPasswordResetRequest(store);
      return {
        success: true,
        message: 'Parolni tiklash so\'rovi adminga yuborildi',
        request,
      };
    }

    const request: PasswordResetRequest = {
      id: this.passwordResetRequests.length + 1,
      storeId: store.id,
      phone: store.phone,
      storeName: store.fullName,
      status: 'pending',
      requestedAt: new Date().toISOString(),
      resolvedAt: null,
    };
    this.passwordResetRequests.push(request);

    return {
      success: true,
      message: 'Parolni tiklash so\'rovi adminga yuborildi',
      request,
    };
  }

  async getPasswordResetRequests() {
    if (this.databaseService.isEnabled()) {
      return this.databaseService.getPasswordResetRequests();
    }

    return [...this.passwordResetRequests].sort((left, right) => right.id - left.id);
  }

  async resolvePasswordResetRequest(
    requestId: number,
    payload: ResolvePasswordResetPayload,
  ) {
    const newPassword = this.cleanText(payload.newPassword);

    if (!Number.isInteger(requestId) || requestId <= 0) {
      throw new BadRequestException('So\'rov ID xato');
    }

    if (newPassword.length < 4) {
      throw new BadRequestException('Yangi parol kamida 4 ta belgidan iborat bo\'lsin');
    }

      if (this.databaseService.isEnabled()) {
        const resolved = await this.databaseService.resolvePasswordResetRequest(
          requestId,
          this.protectPassword(newPassword),
          newPassword,
        );

      if (!resolved) {
        throw new BadRequestException('Parol tiklash so\'rovi topilmadi');
      }

      return {
        success: true,
        message: 'Yangi parol saqlandi va so\'rov yopildi',
        request: resolved,
      };
    }

    const request = this.passwordResetRequests.find((item) => item.id === requestId);
    if (!request) {
      throw new BadRequestException('Parol tiklash so\'rovi topilmadi');
    }

    const store = this.stores.find((item) => item.id === request.storeId);
    if (!store) {
      throw new BadRequestException('Magazin topilmadi');
    }

    store.password = this.protectPassword(newPassword);
    store.lastIssuedPassword = newPassword;
    request.status = 'resolved';
    request.resolvedAt = new Date().toISOString();

    return {
      success: true,
      message: 'Yangi parol saqlandi va so\'rov yopildi',
      request,
    };
  }

  async saveProduct(payload: SaveProductPayload) {
    const name = this.cleanText(payload.name);
    const category = this.cleanText(payload.category);
    const imageUrl = this.cleanText(payload.imageUrl);
    const description = this.cleanText(payload.description);
    const price = Number(payload.price);
    const stock = Number(payload.stock);
    const lowStockThreshold = Number(payload.lowStockThreshold);
    const isVisible = payload.isVisible ?? true;

    if (!name) {
      throw new BadRequestException('Mahsulot nomi kiritilishi shart');
    }

    if (!category) {
      throw new BadRequestException('Kategoriya kiritilishi shart');
    }

    if (!description) {
      throw new BadRequestException('Mahsulot tavsifi kiritilishi shart');
    }

    if (!Number.isInteger(price) || price <= 0) {
      throw new BadRequestException('Narx xato');
    }

    if (!Number.isInteger(stock) || stock < 0) {
      throw new BadRequestException('Sklad miqdori xato');
    }

    if (!Number.isInteger(lowStockThreshold) || lowStockThreshold < 0) {
      throw new BadRequestException('Kam qoldiq chegarasi xato');
    }

    const normalized: SaveProductPayload = {
      id: payload.id ? Number(payload.id) : undefined,
      tenantId: payload.tenantId ? Number(payload.tenantId) : 1,
      name,
      category,
      imageUrl,
      description,
      price,
      stock,
      isVisible,
      lowStockThreshold,
    };

    if (this.databaseService.isEnabled()) {
      const product = await this.databaseService.saveProduct(normalized);
      return {
        success: true,
        message: 'Mahsulot saqlandi',
        product,
      };
    }

    const existing = normalized.id
      ? this.products.find((item) => item.id === normalized.id)
      : null;

    if (existing) {
      existing.name = normalized.name!;
      existing.category = normalized.category!;
      existing.imageUrl = normalized.imageUrl ?? '';
      existing.description = normalized.description!;
      existing.price = normalized.price!;
      existing.stock = normalized.stock!;
      existing.isVisible = normalized.isVisible ?? true;
      existing.lowStockThreshold = normalized.lowStockThreshold!;

      return {
        success: true,
        message: 'Mahsulot saqlandi',
        product: existing,
      };
    }

    const product: Product = {
      id: this.products.length + 1,
      tenantId: normalized.tenantId!,
      name: normalized.name!,
      category: normalized.category!,
      imageUrl: normalized.imageUrl ?? '',
      description: normalized.description!,
      price: normalized.price!,
      stock: normalized.stock!,
      isVisible: normalized.isVisible ?? true,
      lowStockThreshold: normalized.lowStockThreshold!,
    };
    this.products.push(product);

    return {
      success: true,
      message: 'Mahsulot saqlandi',
      product,
    };
  }

  async saveStore(payload: SaveStorePayload) {
    const fullName = this.cleanText(payload.fullName);
    const phone = this.cleanText(payload.phone);
    const address = this.cleanText(payload.address);
    const requestedPassword = this.cleanText(payload.password);
    const stores = await this.loadStores();
    const existing = payload.id
      ? stores.find((item) => item.id === Number(payload.id))
      : null;
    const password =
      requestedPassword.length >= 4
        ? requestedPassword
        : existing?.lastIssuedPassword ?? this.generateAdminPassword(phone);

    if (!fullName || !phone || !address) {
      throw new BadRequestException(
        'Magazin nomi, telefoni va lokatsiyasi shart',
      );
    }

    if (password.length < 4) {
      throw new BadRequestException('Magazin paroli kamida 4 belgili bo\'lishi kerak');
    }

    const normalized: SaveStorePayload = {
      id: payload.id ? Number(payload.id) : undefined,
      tenantId: payload.tenantId ? Number(payload.tenantId) : 1,
      fullName,
      phone,
      password: this.protectPassword(password),
      lastIssuedPassword: password,
      address,
    };

    if (this.databaseService.isEnabled()) {
      const store = await this.databaseService.saveStore(normalized);
        return {
          success: true,
          message: `Magazin saqlandi. Login: ${store.phone}. Parol: ${store.lastIssuedPassword}`,
          store,
        };
      }

      if (existing) {
        existing.fullName = fullName;
        existing.phone = phone;
        existing.password = this.protectPassword(password);
        existing.lastIssuedPassword = password;
        existing.address = address;

        return {
          success: true,
          message: `Magazin saqlandi. Login: ${existing.phone}. Parol: ${existing.lastIssuedPassword}`,
          store: existing,
        };
      }

    const store: Store = {
        id: this.stores.length + 1,
        tenantId: normalized.tenantId ?? 1,
        fullName,
        phone,
        password: this.protectPassword(password),
        lastIssuedPassword: password,
        role: 'client',
        address,
      };
    this.stores.push(store);

      return {
        success: true,
        message: `Magazin saqlandi. Login: ${store.phone}. Parol: ${store.lastIssuedPassword}`,
        store,
      };
    }

  async saveTenant(payload: SaveTenantPayload) {
    const name = this.cleanText(payload.name);
    const ownerName = this.cleanText(payload.ownerName) || name;
    const phone = this.cleanText(payload.phone);
    const adminFullName =
      this.cleanText(payload.adminFullName) || `${name} admin`;
    const adminPhone = this.cleanText(payload.adminPhone);
    const maxStores = Number(payload.maxStores ?? 500);
    const locale = payload.locale ?? 'uz';
    const isActive = payload.isActive ?? true;
    const subscriptionEndsAt =
      payload.subscriptionEndsAt ??
      new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
    const [tenants, businessAdmins] = await Promise.all([
      this.loadTenants(),
      this.loadBusinessAdmins(),
    ]);
    const existingTenant = payload.id
      ? tenants.find((item) => item.id === Number(payload.id))
      : null;
    const existingAdmin = existingTenant
      ? businessAdmins.find((item) => item.tenantId === existingTenant.id)
      : null;
    if (!name || !phone || !adminPhone) {
      throw new BadRequestException(
        'Biznes nomi, biznes telefoni va admin telefoni shart',
      );
    }

    if (!Number.isInteger(maxStores) || maxStores <= 0) {
      throw new BadRequestException('Magazin limiti xato');
    }

    const normalized: SaveTenantPayload = {
      id: payload.id ? Number(payload.id) : undefined,
      name,
      ownerName,
      phone,
      isActive,
      maxStores,
      subscriptionEndsAt,
      locale,
      adminFullName,
      adminPhone,
      adminPassword: '',
    };

    if (this.databaseService.isEnabled()) {
      const tenant = await this.databaseService.saveTenant(normalized);
      await this.databaseService.saveBusinessAdmin(
        tenant.id,
        adminFullName,
        adminPhone,
        '',
        '',
      );
      return {
        success: true,
        message: this.buildTenantSavedMessage(adminPhone),
        tenant,
      };
    }

    const existing = normalized.id
      ? this.tenants.find((item) => item.id === normalized.id)
      : null;

    if (existing) {
      existing.name = name;
      existing.ownerName = ownerName;
      existing.phone = phone;
      existing.isActive = isActive;
      existing.maxStores = maxStores;
      existing.subscriptionEndsAt = subscriptionEndsAt;
      existing.locale = locale;

        const admin = this.businessAdmins.find((item) => item.tenantId === existing.id);
        if (admin) {
          admin.fullName = adminFullName;
          admin.phone = adminPhone;
          admin.passwordSetupRequired = true;
          admin.password = '';
          admin.lastIssuedPassword = '';
        } else {
          this.businessAdmins.push({
            id: this.businessAdmins.length + 1,
            tenantId: existing.id,
            fullName: adminFullName,
            phone: adminPhone,
            password: '',
            lastIssuedPassword: '',
            passwordSetupRequired: true,
            role: 'business_admin',
          });
        }

        return {
          success: true,
          message: this.buildTenantSavedMessage(adminPhone),
          tenant: existing,
        };
      }

    const tenant: Tenant = {
      id: this.tenants.length + 1,
      name,
      ownerName,
      phone,
      isActive,
      maxStores,
      subscriptionEndsAt,
      locale,
    };
    this.tenants.push(tenant);
      this.businessAdmins.push({
        id: this.businessAdmins.length + 1,
        tenantId: tenant.id,
        fullName: adminFullName,
        phone: adminPhone,
        password: '',
        lastIssuedPassword: '',
        passwordSetupRequired: true,
        role: 'business_admin',
      });

      return {
        success: true,
        message: this.buildTenantSavedMessage(adminPhone),
        tenant,
      };
    }

  async setupBusinessAdminPassword(payload: SetupBusinessAdminPasswordPayload) {
    const phone = this.cleanText(payload.phone);
    const newPassword = this.cleanText(payload.newPassword);
    const businessAdmins = await this.loadBusinessAdmins();

    if (!phone || newPassword.length < 4) {
      throw new BadRequestException(
        'Login va kamida 4 belgili yangi parol kiritilishi shart',
      );
    }

    const admin = businessAdmins.find((item) => item.phone === phone);
    if (!admin) {
      throw new BadRequestException('Bu login bo\'yicha biznes admin topilmadi');
    }

    if (!admin.passwordSetupRequired) {
      throw new BadRequestException('Bu admin uchun parol allaqachon yaratilgan');
    }

    if (this.databaseService.isEnabled()) {
      await this.databaseService.setupBusinessAdminPassword(
        phone,
        this.protectPassword(newPassword),
      );
      return {
        success: true,
        message: 'Parol yaratildi. Endi shu login va yangi parol bilan kiring.',
      };
    }

    admin.password = this.protectPassword(newPassword);
    admin.lastIssuedPassword = '';
    admin.passwordSetupRequired = false;

    return {
      success: true,
      message: 'Parol yaratildi. Endi shu login va yangi parol bilan kiring.',
    };
  }

  async setTenantAccess(tenantId: number, payload: SetTenantAccessPayload) {
    const isActive = payload.isActive;

    if (!Number.isInteger(tenantId) || tenantId <= 0) {
      throw new BadRequestException('Tenant ID xato');
    }

    if (typeof isActive !== 'boolean') {
      throw new BadRequestException('isActive qiymati true yoki false bo\'lishi kerak');
    }

    if (this.databaseService.isEnabled()) {
      const tenant = await this.databaseService.setTenantAccess(tenantId, isActive);
      if (!tenant) {
        throw new BadRequestException('Tenant topilmadi');
      }
      return {
        success: true,
        message: isActive ? 'Tenant ochildi' : 'Tenant bloklandi',
        tenant,
      };
    }

    const tenant = this.tenants.find((item) => item.id === tenantId);
    if (!tenant) {
      throw new BadRequestException('Tenant topilmadi');
    }

    tenant.isActive = isActive;

    return {
      success: true,
      message: isActive ? 'Tenant ochildi' : 'Tenant bloklandi',
      tenant,
    };
  }

  async grantSubscription(tenantId: number, payload: GrantSubscriptionPayload) {
    const months = Number(payload.months ?? 1);

    if (!Number.isInteger(tenantId) || tenantId <= 0) {
      throw new BadRequestException('Tenant ID xato');
    }

    if (!Number.isInteger(months) || months <= 0) {
      throw new BadRequestException('Oy soni xato');
    }

    if (this.databaseService.isEnabled()) {
      const tenant = await this.databaseService.grantSubscription(tenantId, months);
      if (!tenant) {
        throw new BadRequestException('Tenant topilmadi');
      }
      return {
        success: true,
        message: `${months} oyga obuna ochildi`,
        tenant,
      };
    }

    const tenant = this.tenants.find((item) => item.id === tenantId);
    if (!tenant) {
      throw new BadRequestException('Tenant topilmadi');
    }

    const baseDate = new Date(tenant.subscriptionEndsAt).getTime();
    const start = baseDate > Date.now() ? baseDate : Date.now();
    tenant.subscriptionEndsAt = new Date(
      start + months * 30 * 24 * 60 * 60 * 1000,
    ).toISOString();
    tenant.isActive = true;

    return {
      success: true,
      message: `${months} oyga obuna ochildi`,
      tenant,
    };
  }

  private async loadProducts(): Promise<Product[]> {
    if (this.databaseService.isEnabled()) {
      return this.databaseService.getProducts();
    }

    return this.products;
  }

  private async loadTenants(): Promise<Tenant[]> {
    if (this.databaseService.isEnabled()) {
      return this.databaseService.getTenants();
    }

    return this.tenants;
  }

  private async loadBusinessAdmins(): Promise<BusinessAdmin[]> {
    if (this.databaseService.isEnabled()) {
      return this.databaseService.getBusinessAdmins();
    }

    return this.businessAdmins;
  }

  private async loadStores(): Promise<Store[]> {
    if (this.databaseService.isEnabled()) {
      return this.databaseService.getStores();
    }

    return this.stores;
  }

  private async loadOrders(): Promise<Order[]> {
    if (this.databaseService.isEnabled()) {
      return this.databaseService.getOrders();
    }

    return [...this.orders].sort((left, right) => right.id - left.id);
  }

  private cleanText(value?: string): string {
    return (value ?? '').trim();
  }

  private isTenantAccessible(tenant: Tenant): boolean {
    return tenant.isActive && new Date(tenant.subscriptionEndsAt).getTime() > Date.now();
  }

  private buildLeaderboard(stores: Store[], orders: Order[]): LeaderboardEntry[] {
    return this.buildLeaderboardFromStats(
      stores.map((store) => this.buildStoreStatsBase(store, orders)),
    ).map((stats) => ({
      rank: stats.rank,
      storeId: stats.storeId,
      storeName: stats.storeName,
      tier: stats.tier,
      deliveredRevenue: stats.deliveredRevenue,
      deliveredOrders: stats.deliveredOrders,
      bonusBalance: stats.bonusBalance,
    }));
  }

  private buildStoreStats(
    store: Store,
    stores: Store[],
    orders: Order[],
  ): StoreStats {
    const stats = this.buildStoreStatsBase(store, orders);
    const leaderboard = this.buildLeaderboardFromStats(
      stores.map((item) => this.buildStoreStatsBase(item, orders)),
    );
    const current = leaderboard.find((item) => item.storeId === store.id);

    return {
      ...stats,
      rank: current?.rank ?? 0,
    };
  }

  private buildStoreStatsBase(store: Store, orders: Order[]): StoreStats {
    const storeOrders = orders.filter(
      (order) =>
        order.customerName.toLowerCase() === store.fullName.toLowerCase(),
    );
    const deliveredOrders = storeOrders.filter(
      (order) => order.status === 'delivered',
    );
    const deliveredRevenue = deliveredOrders.reduce(
      (sum, order) => sum + order.qty * order.price,
      0,
    );
    const pendingOrders = storeOrders.filter(
      (order) => order.status !== 'delivered',
    ).length;
    const bonusBalance = Math.floor(deliveredRevenue * 0.03);
    const monthlyScore = deliveredRevenue + deliveredOrders.length * 5000;

    return {
      storeId: store.id,
      storeName: store.fullName,
      deliveredOrders: deliveredOrders.length,
      deliveredRevenue,
      pendingOrders,
      bonusBalance,
      monthlyScore,
      rank: 0,
      tier:
        deliveredRevenue >= 1_500_000
          ? 'Platinum'
          : deliveredRevenue >= 700_000
            ? 'Gold'
            : deliveredRevenue >= 250_000
              ? 'Silver'
              : 'Bronze',
    };
  }

  private buildLeaderboardFromStats(stats: StoreStats[]): StoreStats[] {
    return [...stats]
      .sort((left, right) => {
        if (right.monthlyScore !== left.monthlyScore) {
          return right.monthlyScore - left.monthlyScore;
        }

        return right.deliveredRevenue - left.deliveredRevenue;
      })
      .map((item, index) => ({
        ...item,
        rank: index + 1,
      }));
  }

  private normalizeStatus(value?: string): OrderStatus {
    const normalized = (value ?? '').trim().toLowerCase();

    if (
      normalized !== 'new' &&
      normalized !== 'approved' &&
      normalized !== 'delivered'
    ) {
      throw new BadRequestException(
        `Status faqat new, approved yoki delivered bo'lishi mumkin`,
      );
    }

    return normalized;
  }

  private canMoveToNextStatus(
    currentStatus: OrderStatus,
    nextStatus: OrderStatus,
  ): boolean {
    const flow: OrderStatus[] = ['new', 'approved', 'delivered'];
    const currentIndex = flow.indexOf(currentStatus);
    const nextIndex = flow.indexOf(nextStatus);

    return nextIndex === currentIndex + 1;
  }

  private ensureAdminKey(adminKey?: string) {
    const expectedKey = this.cleanText(process.env.ADMIN_STATUS_KEY);
    if (!expectedKey) {
      return;
    }

    if (this.cleanText(adminKey) !== expectedKey) {
      throw new UnauthorizedException('Admin ruxsati topilmadi');
    }
  }

  private protectPassword(password: string): string {
    const clean = this.cleanText(password);
    if (!clean) {
      return '';
    }

    if (clean.startsWith('scrypt$')) {
      return clean;
    }

    const salt = randomBytes(8).toString('hex');
    const hash = scryptSync(clean, salt, 32).toString('hex');
    return `scrypt$${salt}$${hash}`;
  }

  private isPasswordMatch(plainPassword: string, storedPassword: string): boolean {
    const plain = this.cleanText(plainPassword);
    const stored = this.cleanText(storedPassword);

    if (!stored.startsWith('scrypt$')) {
      return plain === stored;
    }

    const parts = stored.split('$');
    if (parts.length !== 3) {
      return false;
    }

    const [, salt, expectedHash] = parts;
    const actualHash = scryptSync(plain, salt, 32).toString('hex');
    return timingSafeEqual(
      Buffer.from(actualHash, 'hex'),
      Buffer.from(expectedHash, 'hex'),
    );
  }

  private visiblePassword(storedPassword: string): string {
    return storedPassword.startsWith('scrypt$') ? '' : storedPassword;
  }

  private generateAdminPassword(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.length >= 4) {
      return digits.slice(-4);
    }

    return '1234';
  }

  private buildTenantSavedMessage(adminPhone: string): string {
    return `Biznes panel saqlandi. Admin login: ${adminPhone}. Parolni biznes egasi o'zi yaratadi.`;
  }
}
