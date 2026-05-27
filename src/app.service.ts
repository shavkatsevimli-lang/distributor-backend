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
  CartOrderItemPayload,
  ChangeMarketPasswordPayload,
  ClientTopProduct,
  CreateAdminRegistrationRequestPayload,
  CreateCartOrderPayload,
  CreateOrderPayload,
  ClientDashboard,
  GrantSubscriptionPayload,
  LeaderboardEntry,
  LoginPayload,
  OwnerDashboard,
  Order,
  OrderBatchSummary,
  OrderStatus,
  PasswordResetRequest,
  PasswordResetRequestPayload,
  Product,
  RequestStoreLinkPayload,
  ResolveAdminRegistrationRequestPayload,
  ResolvePasswordResetPayload,
  ResetAdminPasswordPayload,
  SaveProductPayload,
  SaveStorePayload,
  SaveTenantPayload,
  SetupStoreOwnerPasswordPayload,
  SetupBusinessAdminPasswordPayload,
  AdminRegistrationRequest,
  StoreLinkRequest,
  StoreOwnerProfile,
  StorePanelLink,
  SetStoreAccessPayload,
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
    passwordChangeRequired: store.passwordChangeRequired ?? false,
    password: this.protectPassword(store.password),
  }));
  private readonly orders: Order[] = [...seedOrders];
  private readonly passwordResetRequests: PasswordResetRequest[] = [];
  private readonly storeOwnerProfiles: StoreOwnerProfile[] = [];
  private readonly storeLinkRequests: StoreLinkRequest[] = [];
  private readonly adminRegistrationRequests: AdminRegistrationRequest[] = [];

  private readonly ownerPhone = this.cleanText(process.env.OWNER_PHONE || '+998937344148');
  private ownerPasswordHash = this.protectPassword(
    this.cleanText(process.env.OWNER_PASSWORD || '111'),
  );
  private readonly ownerResetKey = this.cleanText(
    process.env.OWNER_RESET_KEY || '111111',
  );
  private readonly platformOwner = {
    id: 999,
    fullName: process.env.OWNER_FULL_NAME ?? 'Platform Owner',
    phone: this.ownerPhone,
    password: this.ownerPasswordHash,
    role: 'platform_owner',
  } as const;

  constructor(private readonly databaseService: DatabaseService) {}

  getHello(): string {
    return 'DistributorPro backend is running';
  }

  getVersion() {
    return {
      app: 'Avto Zakaz Private Backend',
      version: '2026.05.01-private-admin-market',
      adminEnabled: true,
      marketEnabled: true,
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

  async getTenantAdminProducts(tenantId: number): Promise<Product[]> {
    return (await this.loadProducts()).filter((item) => item.tenantId === tenantId);
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

  async getTenantAdminStores(tenantId: number): Promise<Store[]> {
    const stores = await this.loadStores();
    return stores
      .filter((store) => store.tenantId === tenantId)
      .map((store) => ({
        ...store,
        password: '',
        lastIssuedPassword:
          store.lastIssuedPassword ?? this.visiblePassword(store.password),
      }));
  }

  async getNextStoreId() {
    if (this.databaseService.isEnabled()) {
      return {
        nextId: await this.databaseService.getNextStoreId(),
      };
    }

    const usedIds = new Set(this.stores.map((item) => item.id));
    let nextId = 1;
    while (usedIds.has(nextId)) {
      nextId += 1;
    }

    return { nextId };
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

  async getAdminRegistrationRequests(): Promise<AdminRegistrationRequest[]> {
    return [...this.adminRegistrationRequests].sort((a, b) => b.id - a.id);
  }

  async createAdminRegistrationRequest(
    payload: CreateAdminRegistrationRequestPayload,
  ) {
    const firmName = this.cleanText(payload.firmName);
    const adminName = this.cleanText(payload.adminName);
    const phone = this.cleanText(payload.phone);
    const password = this.cleanText(payload.password);

    if (!firmName || !adminName || !phone || password.length < 4) {
      throw new BadRequestException(
        'Firma nomi, admin ismi, telefon va kamida 4 belgili parol shart',
      );
    }

    const existing = this.adminRegistrationRequests.find(
      (item) =>
        item.phone === phone &&
        item.status === 'pending',
    );
    if (existing) {
      return {
        success: true,
        message: 'So\'rov allaqachon yuborilgan. Super admin tasdiqlashini kuting.',
        request: existing,
      };
    }

    const request: AdminRegistrationRequest = {
      id: this.adminRegistrationRequests.length + 1,
      firmName,
      adminName,
      phone,
      password: this.protectPassword(password),
      status: 'pending',
      requestedAt: new Date().toISOString(),
      processedAt: null,
      tenantId: null,
    };
    this.adminRegistrationRequests.push(request);

    return {
      success: true,
      message: 'So\'rov super adminga yuborildi',
      request,
    };
  }

  async resolveAdminRegistrationRequest(
    requestId: number,
    approved: boolean,
  ) {
    const request = this.adminRegistrationRequests.find((item) => item.id === requestId);
    if (!request) {
      throw new BadRequestException('So\'rov topilmadi');
    }

    request.status = approved ? 'approved' : 'rejected';
    request.processedAt = new Date().toISOString();

    if (!approved) {
      return {
        success: true,
        message: 'So\'rov rad qilindi',
        request,
      };
    }

    const existingTenants = await this.loadTenants();
    const existingTenant =
      existingTenants.find((item) => item.phone === request.phone) ??
      existingTenants.find((item) => item.name === request.firmName) ??
      null;

    if (this.databaseService.isEnabled()) {
      const tenant = await this.databaseService.saveTenant({
        id: existingTenant?.id,
        name: request.firmName,
        ownerName: request.adminName,
        phone: request.phone,
        isActive: true,
        maxStores: 1000,
        locale: 'uz',
        adminFullName: request.adminName,
        adminPhone: request.phone,
        adminPassword: '',
      });

      await this.databaseService.saveBusinessAdmin(
        tenant.id,
        request.adminName,
        request.phone,
        request.password,
        '',
      );

      request.tenantId = tenant.id;
      return {
        success: true,
        message: 'So\'rov tasdiqlandi va admin panel ochildi',
        request,
        tenant,
      };
    }

    const result = await this.saveTenant({
      id: existingTenant?.id,
      name: request.firmName,
      ownerName: request.adminName,
      phone: request.phone,
      isActive: true,
      maxStores: 1000,
      locale: 'uz',
      adminFullName: request.adminName,
      adminPhone: request.phone,
      adminPassword: '',
    });

    const tenant = result.tenant;
    if (tenant) {
      request.tenantId = tenant.id;
      const admin = this.businessAdmins.find((item) => item.tenantId === tenant.id);
      if (admin) {
        admin.password = request.password;
        admin.passwordSetupRequired = false;
        admin.lastIssuedPassword = '';
      }
    }

    return {
      success: true,
      message: 'So\'rov tasdiqlandi va admin panel ochildi',
      request,
      tenant,
    };
  }

  async getOrders(): Promise<Order[]> {
    return this.loadOrders();
  }

  async getTenantOrders(tenantId: number): Promise<Order[]> {
    return (await this.loadOrders()).filter((item) => item.tenantId === tenantId);
  }

  async getTenantOrderBatches(tenantId: number): Promise<OrderBatchSummary[]> {
    return this.buildOrderBatches(
      (await this.loadOrders()).filter((item) => item.tenantId === tenantId),
    );
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

  async getTenantAdminDashboard(tenantId: number): Promise<AdminDashboard> {
    const [products, stores, orders] = await Promise.all([
      this.loadProducts(),
      this.loadStores(),
      this.loadOrders(),
    ]);
    const tenantProducts = products.filter((item) => item.tenantId === tenantId);
    const tenantStores = stores.filter((item) => item.tenantId === tenantId);
    const tenantOrders = orders.filter((item) => item.tenantId === tenantId);
    const leaderboard = this.buildLeaderboard(tenantStores, tenantOrders);
    const deliveredOrders = tenantOrders.filter((order) => order.status === 'delivered');
    const todayKey = new Date().toISOString().slice(0, 10);
    const monthKey = todayKey.slice(0, 7);

    return {
      totalStores: tenantStores.length,
      activeProducts: tenantProducts.filter((product) => product.isVisible).length,
      hiddenProducts: tenantProducts.filter((product) => !product.isVisible).length,
      pendingOrders: tenantOrders.filter((order) => order.status !== 'delivered').length,
      deliveredOrders: deliveredOrders.length,
      todayRevenue: deliveredOrders
        .filter((order) => order.createdAt.startsWith(todayKey))
        .reduce((sum, order) => sum + order.qty * order.price, 0),
      monthRevenue: deliveredOrders
        .filter((order) => order.createdAt.startsWith(monthKey))
        .reduce((sum, order) => sum + order.qty * order.price, 0),
      lowStockProducts: tenantProducts.filter(
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

    if (store.isActive === false) {
      throw new BadRequestException('Bu magazin bloklangan');
    }

    return {
      store: {
        id: store.id,
        fullName: store.fullName,
        address: store.address,
      },
      stats: this.buildStoreStats(store, stores, orders),
      leaderboard: this.buildLeaderboard(stores, orders).slice(0, 10),
      topProducts: this.buildTopProducts(
        orders.filter((order) => order.storeId === store.id),
      ),
      recentOrders: orders
        .filter((order) => order.storeId === store.id)
        .slice(0, 10),
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

    if (store.isActive === false) {
      throw new BadRequestException('Bu distribyutor bo\'yicha magazin bloklangan');
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
      topProducts: this.buildTopProducts(
        tenantOrders.filter((order) => order.storeId === store.id),
      ),
      recentOrders: tenantOrders
        .filter((order) => order.storeId === store.id)
        .slice(0, 10),
    };
  }

  async createOrder(payload: CreateOrderPayload) {
    const [products, stores] = await Promise.all([
      this.loadProducts(),
      this.loadStores(),
    ]);
    const batchMeta = this.createBatchMeta(
      Number(payload.tenantId),
      Number(payload.storeId),
      this.cleanText(payload.customerName),
      1,
    );
    const newOrder = this.prepareOrderDraft(
      payload,
      products,
      stores,
      new Map<number, number>(),
      1,
      batchMeta,
    );

    if (this.databaseService.isEnabled()) {
      const created = await this.databaseService.createOrder(newOrder);
      return {
        success: true,
        message: 'Zakaz qabul qilindi',
        order: created,
      };
    }

    this.orders.push(newOrder);
    const product = this.products.find((item) => item.id === newOrder.productId);
    if (product) {
      product.stock -= newOrder.qty;
    }

    return {
      success: true,
      message: 'Zakaz qabul qilindi',
      order: newOrder,
    };
  }

  async createCartOrder(payload: CreateCartOrderPayload) {
    const [products, stores] = await Promise.all([
      this.loadProducts(),
      this.loadStores(),
    ]);
    const items = payload.items ?? [];

    if (items.length === 0) {
      throw new BadRequestException('Savatcha bo\'sh');
    }

    const reservedStock = new Map<number, number>();
    const batchMeta = this.createBatchMeta(
      Number(payload.tenantId),
      Number(payload.storeId),
      this.cleanText(payload.customerName),
      items.length,
    );
    const draftOrders = items.map((item, index) =>
      this.prepareOrderDraft(
        {
          tenantId: payload.tenantId,
          storeId: payload.storeId,
          productId: item.productId,
          productName: item.productName,
          qty: item.qty,
          price: item.price,
          customerName: payload.customerName,
        },
        products,
        stores,
        reservedStock,
        index + 1,
        batchMeta,
      ),
    );

    if (this.databaseService.isEnabled()) {
      const createdOrders = await this.databaseService.createOrders(draftOrders);
      return {
        success: true,
        message: `Savatcha yuborildi: ${createdOrders.length} ta mahsulot`,
        orders: createdOrders,
      };
    }

    for (const order of draftOrders) {
      this.orders.push(order);
      const product = this.products.find((item) => item.id === order.productId);
      if (product) {
        product.stock -= order.qty;
      }
    }

    return {
      success: true,
      message: `Savatcha yuborildi: ${draftOrders.length} ta mahsulot`,
      orders: draftOrders,
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

  async updateOrderBatchStatus(
    batchId: string,
    payload: UpdateStatusPayload,
    adminKey?: string,
  ) {
    this.ensureAdminKey(adminKey);

    const cleanBatchId = this.cleanText(batchId);
    if (!cleanBatchId) {
      throw new BadRequestException('Zakaz partiya ID xato');
    }

    if (cleanBatchId.startsWith('single-')) {
      const singleOrderId = Number(cleanBatchId.replace('single-', ''));
      if (!Number.isInteger(singleOrderId) || singleOrderId <= 0) {
        throw new BadRequestException('Zakaz partiya ID xato');
      }

      return this.updateOrderStatus(singleOrderId, payload, adminKey);
    }

    const requestedStatus = this.normalizeStatus(payload.status);
    const orders = (await this.loadOrders()).filter(
      (item) => this.resolveBatchId(item) === cleanBatchId,
    );

    if (orders.length === 0) {
      throw new BadRequestException('Zakaz partiyasi topilmadi');
    }

    const uniqueStatuses = [...new Set(orders.map((item) => item.status))];
    if (uniqueStatuses.length !== 1) {
      throw new BadRequestException(
        'Bu zakaz partiyasidagi statuslar aralashib ketgan',
      );
    }

    const currentStatus = uniqueStatuses[0];
    if (currentStatus === requestedStatus) {
      return {
        success: true,
        message: `Zakaz partiyasi allaqachon ${requestedStatus} holatda`,
        batchId: cleanBatchId,
      };
    }

    if (!this.canMoveToNextStatus(currentStatus, requestedStatus)) {
      throw new BadRequestException(
        `Status faqat ketma-ket o'zgaradi: new -> approved -> delivered`,
      );
    }

    if (this.databaseService.isEnabled()) {
      const updatedOrders = await this.databaseService.updateOrderBatchStatus(
        cleanBatchId,
        requestedStatus,
      );

      return {
        success: true,
        message: `${updatedOrders.length} ta mahsulotli zakaz ${requestedStatus} ga o'tdi`,
        batchId: cleanBatchId,
      };
    }

    this.orders
      .filter((item) => this.resolveBatchId(item) === cleanBatchId)
      .forEach((item) => {
        item.status = requestedStatus;
      });

    return {
      success: true,
      message: `${orders.length} ta mahsulotli zakaz ${requestedStatus} ga o'tdi`,
      batchId: cleanBatchId,
    };
  }

  async login(payload: LoginPayload) {
    const [stores, tenants] = await Promise.all([
      this.loadStores(),
      this.loadTenants(),
    ]);
    const phone = this.cleanText(payload.phone);
    const password = this.cleanText(payload.password);

    if (!phone || !password) {
      throw new BadRequestException('Telefon va parol kiritilishi shart');
    }

    if (
      this.isOwnerLoginEnabled() &&
      phone === this.platformOwner.phone &&
      this.isPasswordMatch(password, this.platformOwner.password)
    ) {
      return {
        success: true,
        message: 'Platform owner login successful',
        user: {
          id: this.platformOwner.id,
          fullName: this.platformOwner.fullName || 'Admin',
          phone: this.platformOwner.phone,
          role: 'platform_owner',
          storeId: 0,
          bonusBalance: 0,
          tier: 'admin',
          tenantId: 1,
          tenantName: 'Avto Zakaz',
          subscriptionEndsAt: null,
          isBlocked: false,
          mustChangePassword: false,
        },
      };
    }

    const businessAdmins = await this.loadBusinessAdmins();
    const businessAdmin = businessAdmins.find(
      (item) =>
        item.phone === phone &&
        !item.passwordSetupRequired &&
        this.isPasswordMatch(password, item.password),
    );
    if (businessAdmin) {
      const tenant = tenants.find((item) => item.id === businessAdmin.tenantId);
      if (!tenant) {
        return {
          success: false,
          message: 'Bu admin uchun firma topilmadi',
        };
      }
      if (!this.isTenantAccessible(tenant)) {
        return {
          success: false,
          message: 'Sizning admin panelingiz bloklangan.',
        };
      }

      return {
        success: true,
        message: 'Login successful',
        user: {
          id: businessAdmin.id,
          fullName: businessAdmin.fullName,
          phone: businessAdmin.phone,
          role: 'business_admin',
          storeId: 0,
          bonusBalance: 0,
          tier: 'admin',
          tenantId: businessAdmin.tenantId,
          tenantName: tenant.name,
          subscriptionEndsAt: tenant.subscriptionEndsAt,
          isBlocked: false,
          mustChangePassword: false,
        },
      };
    }

    const storeOwnerProfile = await this.loadStoreOwnerProfileByPhone(phone);
    if (
      storeOwnerProfile &&
      this.isPasswordMatch(password, storeOwnerProfile.password)
    ) {
      return {
        success: true,
        message: 'Login successful',
        user: {
          id: storeOwnerProfile.id,
          fullName: storeOwnerProfile.fullName,
          phone: storeOwnerProfile.phone,
          role: 'market_owner',
          storeId: 0,
          bonusBalance: 0,
          tier: 'market',
          tenantId: 0,
          tenantName: null,
          subscriptionEndsAt: null,
          isBlocked: false,
          mustChangePassword: false,
        },
      };
    }

    const store = stores.find(
      (item) => item.phone === phone && this.isPasswordMatch(password, item.password),
    );
    if (store) {
      if (store.isActive === false) {
        return {
          success: false,
          message: 'Sizning bu distribyutor bo\'yicha loginingiz bloklangan.',
        };
      }

      const tenant =
        tenants.find((item) => item.id === store.tenantId) ??
        ({
          id: store.tenantId,
          name: 'Avto Zakaz',
          ownerName: 'Admin',
          phone: this.ownerPhone,
          isActive: true,
          maxStores: 10000,
          subscriptionEndsAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365 * 10).toISOString(),
          locale: 'uz',
        } as Tenant);
      if (!this.isTenantAccessible(tenant)) {
        return {
          success: false,
          message: 'Sizning bu market loginingiz bloklangan.',
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
          role: 'market',
          storeId: store.id,
          bonusBalance: stats.bonusBalance,
          tier: stats.tier,
          tenantId: store.tenantId,
          tenantName: tenant.name,
          subscriptionEndsAt: tenant.subscriptionEndsAt,
          isBlocked: false,
          mustChangePassword: store.passwordChangeRequired === true,
        },
      };
    }

    throw new UnauthorizedException('Telefon yoki parol xato');
  }

  async setupStoreOwnerPassword(payload: SetupStoreOwnerPasswordPayload) {
    const phone = this.cleanText(payload.phone);
    const fullName = this.cleanText(payload.fullName);
    const newPassword = this.cleanText(payload.newPassword);

    if (!phone || !fullName || newPassword.length < 4) {
      throw new BadRequestException(
        'Telefon, market nomi va kamida 4 belgili parol kiriting',
      );
    }

    const passwordHash = this.protectPassword(newPassword);

    if (this.databaseService.isEnabled()) {
      const profile = await this.databaseService.saveStoreOwnerProfile(
        phone,
        fullName,
        passwordHash,
        '',
      );
      return {
        success: true,
        message: 'Market profili yaratildi',
        profile,
      };
    }

    const existing = this.storeOwnerProfiles.find((item) => item.phone === phone);
    if (existing) {
      existing.fullName = fullName;
      existing.password = passwordHash;
      existing.lastIssuedPassword = '';
      existing.isVerified = true;
      return {
        success: true,
        message: 'Market profili yangilandi',
        profile: existing,
      };
    }

    const profile: StoreOwnerProfile = {
      id: this.storeOwnerProfiles.length + 1,
      fullName,
      phone,
      password: passwordHash,
      lastIssuedPassword: '',
      isVerified: true,
    };
    this.storeOwnerProfiles.push(profile);
    return {
      success: true,
      message: 'Market profili yaratildi',
      profile,
    };
  }

  async changeMarketPassword(payload: ChangeMarketPasswordPayload) {
    const phone = this.cleanText(payload.phone);
    const currentPassword = this.cleanText(payload.currentPassword);
    const newPassword = this.cleanText(payload.newPassword);

    if (!phone || !currentPassword || newPassword.length < 4) {
      throw new BadRequestException(
        'Login, joriy parol va kamida 4 belgili yangi parol kiriting',
      );
    }

    const stores = await this.loadStores();
    const store = stores.find((item) => item.phone === phone);
    if (!store) {
      throw new BadRequestException('Bu login bo\'yicha market topilmadi');
    }

    if (!this.isPasswordMatch(currentPassword, store.password)) {
      throw new UnauthorizedException('Joriy parol xato');
    }

    if (this.databaseService.isEnabled()) {
      const updated = await this.databaseService.updateStorePassword(
        store.id,
        this.protectPassword(newPassword),
        true,
      );
      return {
        success: true,
        message: 'Parol yangilandi',
        store: updated,
      };
    }

    store.password = this.protectPassword(newPassword);
    store.lastIssuedPassword = '';
    store.passwordChangeRequired = false;

    return {
      success: true,
      message: 'Parol yangilandi',
      store,
    };
  }

  async resetAdminPassword(payload: ResetAdminPasswordPayload) {
    const phone = this.cleanText(payload.phone);
    const resetKey = this.cleanText(payload.resetKey);
    const newPassword = this.cleanText(payload.newPassword);

    if (!phone || !resetKey || newPassword.length < 4) {
      throw new BadRequestException(
        'Login, tiklash kaliti va kamida 4 belgili yangi parol kiriting',
      );
    }

    if (phone !== this.ownerPhone) {
      throw new UnauthorizedException('Admin login xato');
    }

    if (resetKey !== this.ownerResetKey) {
      throw new UnauthorizedException('Tiklash kaliti xato');
    }

    this.ownerPasswordHash = this.protectPassword(newPassword);

    return {
      success: true,
      message: 'Admin paroli yangilandi',
    };
  }

  async getStoreOwnerApprovals(phone: string) {
    const cleanPhone = this.cleanText(phone);
    if (!cleanPhone) {
      throw new BadRequestException('Telefon kiritilishi shart');
    }

    return this.getStoreLinkRequestsByPhone(cleanPhone, 'pending');
  }

  async requestStoreOwnerLink(payload: RequestStoreLinkPayload) {
    const phone = this.cleanText(payload.phone);
    const firmQuery = this.cleanText(payload.firmQuery);

    if (!phone || !firmQuery) {
      throw new BadRequestException('Telefon va firma nomi yoki telefoni shart');
    }

    const profile = await this.loadStoreOwnerProfileByPhone(phone);
    if (!profile) {
      throw new BadRequestException('Avval market profili ochilishi kerak');
    }

    const tenants = await this.loadTenants();
    const queryLower = firmQuery.toLowerCase();
    const matchedTenants = tenants.filter(
      (tenant) =>
        tenant.phone === firmQuery ||
        tenant.name.toLowerCase() === queryLower ||
        tenant.name.toLowerCase().includes(queryLower),
    );

    if (matchedTenants.length === 0) {
      throw new BadRequestException('Bu nom yoki telefon bo\'yicha firma topilmadi');
    }

    if (matchedTenants.length > 1) {
      throw new BadRequestException('Bir nechta firma topildi. Aniqroq nom yozing');
    }

    const tenant = matchedTenants[0];
    const stores = await this.loadStores();
    let store =
      stores.find((item) => item.tenantId === tenant.id && item.phone === phone) ?? null;

    if (!store) {
      const tempPassword = this.generateAdminPassword(phone);
      const draft: SaveStorePayload = {
        tenantId: tenant.id,
        fullName: profile.fullName,
        phone,
        password: this.protectPassword(tempPassword),
        lastIssuedPassword: tempPassword,
        passwordChangeRequired: false,
        isActive: false,
        address: 'Tasdiq kutilmoqda',
      };

      if (this.databaseService.isEnabled()) {
        store = await this.databaseService.saveStore(draft);
      } else {
        store = {
          id: (await this.getNextStoreId()).nextId,
          tenantId: tenant.id,
          fullName: profile.fullName,
          phone,
          password: draft.password!,
          lastIssuedPassword: tempPassword,
          passwordChangeRequired: false,
          isActive: false,
          role: 'client',
          address: 'Tasdiq kutilmoqda',
          approvalStatus: 'pending',
        };
        this.stores.push(store);
      }
    }

    if (this.databaseService.isEnabled()) {
      await this.databaseService.setStoreAccess(store.id, false);
      const request = await this.databaseService.createOrResetStoreLinkRequest(
        profile.id,
        tenant.id,
        tenant.name,
        store,
      );
      return {
        success: true,
        message: `${tenant.name} firmaga ulanish so'rovi yuborildi`,
        request,
      };
    }

    store.isActive = false;
    store.approvalStatus = 'pending';
    const existing = this.storeLinkRequests.find(
      (item) =>
        item.profileId === profile.id &&
        item.tenantId === tenant.id &&
        item.storeId === store!.id,
    );
    const request = existing ?? {
      id: this.storeLinkRequests.length + 1,
      profileId: profile.id,
      tenantId: tenant.id,
      tenantName: tenant.name,
      storeId: store.id,
      storeName: store.fullName,
      phone: store.phone,
      address: store.address,
      status: 'pending' as const,
      requestedAt: new Date().toISOString(),
      approvedAt: null,
    };
    request.storeName = store.fullName;
    request.address = store.address;
    request.status = 'pending';
    request.requestedAt = new Date().toISOString();
    request.approvedAt = null;
    if (!existing) {
      this.storeLinkRequests.push(request);
    }

    return {
      success: true,
      message: `${tenant.name} firmaga ulanish so'rovi yuborildi`,
      request,
    };
  }

  async resolveStoreOwnerApproval(requestId: number, approved: boolean) {
    if (!Number.isInteger(requestId) || requestId <= 0) {
      throw new BadRequestException('Taklif ID xato');
    }

    if (this.databaseService.isEnabled()) {
      const request = await this.databaseService.resolveStoreLinkRequest(
        requestId,
        approved,
      );
      if (!request) {
        throw new BadRequestException('Taklif topilmadi');
      }
      await this.databaseService.setStoreAccess(request.storeId, approved);
      return {
        success: true,
        message: approved
          ? 'Panel ulanishi tasdiqlandi'
          : 'Panel ulanishi rad qilindi',
        request,
      };
    }

    const request = this.storeLinkRequests.find((item) => item.id === requestId);
    if (!request) {
      throw new BadRequestException('Taklif topilmadi');
    }
    request.status = approved ? 'approved' : 'rejected';
    request.approvedAt = approved ? new Date().toISOString() : null;
    const store = this.stores.find((item) => item.id === request.storeId);
    if (store) {
      store.isActive = approved;
      store.approvalStatus = approved ? 'approved' : 'rejected';
    }
    return {
      success: true,
      message: approved
        ? 'Panel ulanishi tasdiqlandi'
        : 'Panel ulanishi rad qilindi',
      request,
    };
  }

  async getStorePanels(phone: string) {
    const cleanPhone = this.cleanText(phone);
    if (!cleanPhone) {
      throw new BadRequestException('Telefon kiritilishi shart');
    }

    return this.getStorePanelsByPhone(cleanPhone);
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
    store.passwordChangeRequired = true;
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

  async deleteProduct(productId: number) {
    if (!Number.isInteger(productId) || productId <= 0) {
      throw new BadRequestException('Mahsulot ID xato');
    }

    const [products, orders] = await Promise.all([
      this.loadProducts(),
      this.loadOrders(),
    ]);
    const product = products.find((item) => item.id === productId);

    if (!product) {
      throw new BadRequestException('Mahsulot topilmadi');
    }

    const hasOrderHistory = orders.some((item) => item.productId === productId);

    if (hasOrderHistory) {
      if (this.databaseService.isEnabled()) {
        await this.databaseService.hideProduct(productId);
      } else {
        product.isVisible = false;
        product.stock = 0;
      }

      return {
        success: true,
        message: 'Mahsulotda zakaz tarixi bor. O\'chirish o\'rniga yashirildi.',
      };
    }

    if (this.databaseService.isEnabled()) {
      await this.databaseService.deleteProduct(productId);
    } else {
      const index = this.products.findIndex((item) => item.id === productId);
      if (index >= 0) {
        this.products.splice(index, 1);
      }
    }

    return {
      success: true,
      message: 'Mahsulot o\'chirildi',
    };
  }

  async saveStore(payload: SaveStorePayload) {
    const fullName = this.cleanText(payload.fullName);
    const phone = this.cleanText(payload.phone);
    const address = this.cleanText(payload.address);
    const [stores, tenants] = await Promise.all([
      this.loadStores(),
      this.loadTenants(),
    ]);
    const existing = payload.id
      ? stores.find((item) => item.id === Number(payload.id))
      : stores.find(
          (item) =>
            item.tenantId === Number(payload.tenantId ?? 1) && item.phone === phone,
        ) ?? null;

    if (!fullName || !phone || !address) {
      throw new BadRequestException(
        'Magazin nomi, telefoni va lokatsiyasi shart',
      );
    }
    const temporaryPassword =
      this.cleanText(payload.lastIssuedPassword) || this.generateAdminPassword(phone);
    const shouldResetToTemporary = this.cleanText(payload.password) === '__RESET_TEMP__';
    const passwordHash = this.protectPassword(temporaryPassword);

    const normalized: SaveStorePayload = {
      id: payload.id ? Number(payload.id) : undefined,
      tenantId: payload.tenantId ? Number(payload.tenantId) : 1,
      fullName,
      phone,
      password:
        existing && !shouldResetToTemporary
          ? existing.password
          : passwordHash,
      lastIssuedPassword:
        existing && !shouldResetToTemporary ? existing.lastIssuedPassword : temporaryPassword,
      passwordChangeRequired: !payload.id || shouldResetToTemporary,
      isActive: payload.isActive ?? existing?.isActive ?? true,
      address,
    };
    const tenantName =
      tenants.find((item) => item.id === (normalized.tenantId ?? 1))?.name ??
      'Avto Zakaz';
    const profile = await this.loadStoreOwnerProfileByPhone(phone);

    if (this.databaseService.isEnabled()) {
      let store = await this.databaseService.saveStore(normalized);
      if (profile) {
        store = (await this.databaseService.setStoreAccess(store.id, false)) ?? store;
        await this.databaseService.createOrResetStoreLinkRequest(
          profile.id,
          store.tenantId,
          tenantName,
          store,
        );
      }
      return {
        success: true,
        message:
          profile
            ? `Market saqlandi. ${store.phone} uchun tasdiq so'rovi yuborildi`
            : payload.id
            ? `Market yangilandi. Login: ${store.phone}`
            : `Market qo'shildi. Login: ${store.phone}. Vaqtinchalik parol: ${temporaryPassword}`,
        store,
      };
    }

    if (existing) {
      existing.fullName = fullName;
      existing.phone = phone;
      existing.address = address;
      existing.isActive = payload.isActive ?? existing.isActive ?? true;
      existing.approvalStatus = existing.isActive == false ? 'blocked' : 'approved';
      if (shouldResetToTemporary) {
        existing.password = passwordHash;
        existing.lastIssuedPassword = temporaryPassword;
        existing.passwordChangeRequired = true;
      }
      if (profile) {
        existing.isActive = false;
        existing.approvalStatus = 'pending';
        const request =
          this.storeLinkRequests.find(
            (item) =>
              item.profileId === profile.id &&
              item.tenantId === existing.tenantId &&
              item.storeId === existing.id,
          ) ??
          ({
            id: this.storeLinkRequests.length + 1,
            profileId: profile.id,
            tenantId: existing.tenantId,
            tenantName,
            storeId: existing.id,
            storeName: existing.fullName,
            phone: existing.phone,
            address: existing.address,
            status: 'pending',
            requestedAt: new Date().toISOString(),
            approvedAt: null,
          } as StoreLinkRequest);
        request.storeName = existing.fullName;
        request.phone = existing.phone;
        request.address = existing.address;
        request.status = 'pending';
        request.requestedAt = new Date().toISOString();
        request.approvedAt = null;
        if (!this.storeLinkRequests.some((item) => item.id === request.id)) {
          this.storeLinkRequests.push(request);
        }
      }

      return {
        success: true,
        message:
          profile
            ? `Market saqlandi. ${existing.phone} uchun tasdiq so'rovi yuborildi`
            : shouldResetToTemporary
            ? `Market uchun yangi vaqtinchalik parol berildi: ${temporaryPassword}`
            : `Market yangilandi. Login: ${existing.phone}`,
        store: existing,
      };
    }

    const nextStoreId = normalized.id ?? (await this.getNextStoreId()).nextId;
    const store: Store = {
      id: nextStoreId,
      tenantId: normalized.tenantId ?? 1,
      fullName,
      phone,
      password: passwordHash,
      lastIssuedPassword: temporaryPassword,
      passwordChangeRequired: true,
      isActive: !profile,
      role: 'client',
      address,
      approvalStatus: profile ? 'pending' : 'approved',
    };
    this.stores.push(store);
    if (profile) {
      this.storeLinkRequests.push({
        id: this.storeLinkRequests.length + 1,
        profileId: profile.id,
        tenantId: store.tenantId,
        tenantName,
        storeId: store.id,
        storeName: store.fullName,
        phone: store.phone,
        address: store.address,
        status: 'pending',
        requestedAt: new Date().toISOString(),
        approvedAt: null,
      });
    }

    return {
      success: true,
      message:
        profile
          ? `Market qo'shildi va tasdiq so'rovi yuborildi`
          : `Market qo'shildi. Login: ${store.phone}. Vaqtinchalik parol: ${temporaryPassword}`,
      store,
    };
  }

  async deleteStore(storeId: number) {
    if (!Number.isInteger(storeId) || storeId <= 0) {
      throw new BadRequestException('Magazin ID xato');
    }

    const [stores, orders] = await Promise.all([
      this.loadStores(),
      this.loadOrders(),
    ]);
    const store = stores.find((item) => item.id === storeId);

    if (!store) {
      throw new BadRequestException('Magazin topilmadi');
    }

    const hasOrderHistory = orders.some((item) => item.storeId === storeId);

    if (hasOrderHistory) {
      if (this.databaseService.isEnabled()) {
        await this.databaseService.setStoreAccess(storeId, false);
      } else {
        store.isActive = false;
      }

      return {
        success: true,
        message: 'Magazinda zakaz tarixi bor. O\'chirish o\'rniga chiqarildi.',
      };
    }

    if (this.databaseService.isEnabled()) {
      await this.databaseService.deleteStore(storeId);
    } else {
      const index = this.stores.findIndex((item) => item.id === storeId);
      if (index >= 0) {
        this.stores.splice(index, 1);
      }
    }

    return {
      success: true,
      message: 'Magazin o\'chirildi',
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

  async setStoreAccess(storeId: number, payload: SetStoreAccessPayload) {
    const isActive = payload.isActive;

    if (!Number.isInteger(storeId) || storeId <= 0) {
      throw new BadRequestException('Magazin ID xato');
    }

    if (typeof isActive !== 'boolean') {
      throw new BadRequestException('isActive true yoki false bo\'lishi kerak');
    }

    if (this.databaseService.isEnabled()) {
      const store = await this.databaseService.setStoreAccess(storeId, isActive);
      if (!store) {
        throw new BadRequestException('Magazin topilmadi');
      }

      return {
        success: true,
        message: isActive ? 'Magazin qayta ochildi' : 'Magazin distribyutordan chiqarildi',
        store,
      };
    }

    const store = this.stores.find((item) => item.id === storeId);
    if (!store) {
      throw new BadRequestException('Magazin topilmadi');
    }

    store.isActive = isActive;

    return {
      success: true,
      message: isActive ? 'Magazin qayta ochildi' : 'Magazin distribyutordan chiqarildi',
      store,
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

  private prepareOrderDraft(
    payload:
      | CreateOrderPayload
      | (CartOrderItemPayload & {
          tenantId?: number;
          storeId?: number;
          customerName?: string;
        }),
    products: Product[],
    stores: Store[],
    reservedStock: Map<number, number>,
    orderSequence: number,
    batchMeta?: {
      batchId: string;
      batchLabel: string;
    },
  ): Order {
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

    if (store.isActive === false) {
      throw new BadRequestException('Bu magazin uchun kirish yopilgan');
    }

    const product = products.find(
      (item) => item.id === productId && item.tenantId === tenantId,
    );
    if (!product) {
      throw new BadRequestException('Bunday mahsulot topilmadi');
    }

    if (!product.isVisible || product.stock <= 0) {
      throw new BadRequestException(`"${product.name}" hozircha buyurtmaga yopiq`);
    }

    const alreadyReserved = reservedStock.get(productId) ?? 0;
    if (qty + alreadyReserved > product.stock) {
      throw new BadRequestException(`"${product.name}" sklad miqdoridan oshib ketdi`);
    }
    reservedStock.set(productId, alreadyReserved + qty);

    return {
      id: this.orders.length + orderSequence,
      tenantId: store.tenantId,
      storeId: store.id,
      batchId: batchMeta?.batchId ?? null,
      batchLabel: batchMeta?.batchLabel ?? null,
      productId,
      productName: productName || product.name,
      qty,
      price,
      customerName,
      status: 'new',
      createdAt: new Date().toISOString(),
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

  private async loadStoreOwnerProfileByPhone(
    phone: string,
  ): Promise<StoreOwnerProfile | null> {
    if (this.databaseService.isEnabled()) {
      return this.databaseService.getStoreOwnerProfileByPhone(phone);
    }

    return this.storeOwnerProfiles.find((item) => item.phone === phone) ?? null;
  }

  private async getStoreLinkRequestsByPhone(
    phone: string,
    status?: 'pending' | 'approved' | 'rejected' | 'blocked',
  ): Promise<StoreLinkRequest[]> {
    if (this.databaseService.isEnabled()) {
      return this.databaseService.getStoreLinkRequestsByPhone(phone, status);
    }

    const profile = this.storeOwnerProfiles.find((item) => item.phone === phone);
    if (!profile) {
      return [];
    }

    return this.storeLinkRequests.filter(
      (item) =>
        item.profileId === profile.id && (!status || item.status === status),
    );
  }

  private async getStorePanelsByPhone(phone: string): Promise<StorePanelLink[]> {
    if (this.databaseService.isEnabled()) {
      return this.databaseService.getApprovedStorePanelsByPhone(phone);
    }

    const profile = this.storeOwnerProfiles.find((item) => item.phone === phone);
    if (!profile) {
      return [];
    }

    return this.storeLinkRequests
      .filter((item) => item.profileId === profile.id && item.status === 'approved')
      .map((item) => ({
        tenantId: item.tenantId,
        tenantName: item.tenantName,
        storeId: item.storeId,
        storeName: item.storeName,
        phone: item.phone,
        address: item.address,
        status: 'approved',
      }));
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

  private isOwnerLoginEnabled(): boolean {
    return !!this.ownerPhone && !!this.ownerPasswordHash;
  }

  private isTenantAccessible(tenant: Tenant): boolean {
    return tenant.isActive !== false;
  }

  private createBatchMeta(
    tenantId: number,
    storeId: number,
    customerName: string,
    itemCount: number,
  ) {
    const safeCustomer = customerName || 'Magazin';
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    return {
      batchId: `T${tenantId}-S${storeId}-${stamp}-${itemCount}`,
      batchLabel:
        itemCount > 1
          ? `${safeCustomer} savati`
          : `${safeCustomer} tez zakazi`,
    };
  }

  private resolveBatchId(order: Order): string {
    return this.cleanText(order.batchId ?? undefined) || `single-${order.id}`;
  }

  private buildOrderBatches(orders: Order[]): OrderBatchSummary[] {
    const grouped = new Map<string, Order[]>();

    for (const order of orders) {
      const key = this.resolveBatchId(order);
      const current = grouped.get(key) ?? [];
      current.push(order);
      grouped.set(key, current);
    }

    return [...grouped.entries()]
      .map(([batchId, batchOrders]) => {
        const sortedItems = [...batchOrders].sort((left, right) => left.id - right.id);
        const first = sortedItems[0];
        const statuses = sortedItems.map((item) => item.status);
        const status = statuses.includes('new')
          ? 'new'
          : statuses.includes('approved')
            ? 'approved'
            : 'delivered';

        return {
          batchId,
          batchLabel:
            this.cleanText(first.batchLabel ?? undefined) ||
            (sortedItems.length > 1
              ? `${first.customerName} savati`
              : `${first.customerName} zakazi`),
          tenantId: first.tenantId,
          storeId: first.storeId,
          customerName: first.customerName,
          status,
          createdAt: first.createdAt,
          itemCount: sortedItems.length,
          totalQty: sortedItems.reduce((sum, item) => sum + item.qty, 0),
          totalAmount: sortedItems.reduce(
            (sum, item) => sum + item.qty * item.price,
            0,
          ),
          items: sortedItems,
        } as OrderBatchSummary;
      })
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
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

  private buildTopProducts(orders: Order[]): ClientTopProduct[] {
    const productMap = new Map<number, ClientTopProduct>();

    for (const order of orders) {
      const current = productMap.get(order.productId) ?? {
        productId: order.productId,
        productName: order.productName,
        totalQty: 0,
        totalSpent: 0,
        deliveredQty: 0,
      };

      current.totalQty += order.qty;
      current.totalSpent += order.qty * order.price;
      if (order.status === 'delivered') {
        current.deliveredQty += order.qty;
      }

      productMap.set(order.productId, current);
    }

    return [...productMap.values()]
      .sort((left, right) => right.totalQty - left.totalQty)
      .slice(0, 8);
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
