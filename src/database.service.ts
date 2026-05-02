import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomBytes, scryptSync } from 'crypto';
import { Pool } from 'pg';
import type {
  BusinessAdmin,
  NextStoreIdResponse,
  Order,
  OrderStatus,
  PasswordResetRequest,
  Product,
  SaveProductPayload,
  SaveStorePayload,
  SaveTenantPayload,
  StoreLinkRequest,
  StoreOwnerProfile,
  StorePanelLink,
  Store,
  Tenant,
} from './app.types';
import {
  seedBusinessAdmins,
  seedOrders,
  seedProducts,
  seedStores,
  seedTenants,
} from './seed-data';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly databaseUrl = process.env.DATABASE_URL?.trim() ?? '';
  private readonly legacyDemoTenantNames = ['Baraka Distribusiya'];
  private readonly legacyDemoAdminPhones = ['999'];
  private readonly legacyDemoStorePhones = [
    '998901234567',
    '998901111111',
    '998902222222',
    '998903333333',
  ];
  private readonly legacyDemoStoreNames = [
    'Ali Market',
    'Samarqand Savdo',
    'Andijon Store',
    'Buxoro Market',
  ];
  private readonly legacyDemoProductNames = [
    'Shakar 1kg',
    'Yog 1L',
    'Un 50kg',
    'Makaron',
    'Choy 200g',
  ];
  private pool: Pool | null = null;
  private ready = false;

  async onModuleInit() {
    if (!this.databaseUrl) {
      this.logger.warn(
        'DATABASE_URL topilmadi. Backend demo in-memory rejimda ishlaydi.',
      );
      return;
    }

    this.pool = new Pool({
      connectionString: this.databaseUrl,
      ssl: this.databaseUrl.includes('localhost')
        ? false
        : { rejectUnauthorized: false },
    });

    await this.query('SELECT 1');
    await this.createSchema();
    await this.seedIfNeeded();
    await this.upgradeStoredSecrets();
    await this.cleanupLegacyDemoData();
    this.ready = true;
    this.logger.log('PostgreSQL ulanishi tayyor');
  }

  async onModuleDestroy() {
    if (this.pool) {
      await this.pool.end();
    }
  }

  isEnabled(): boolean {
    return this.ready && !!this.pool;
  }

  async getProducts(): Promise<Product[]> {
    const result = await this.query(
      `SELECT
          id,
          tenant_id AS "tenantId",
          name,
          price,
          stock,
          is_visible AS "isVisible",
          category,
          image_url AS "imageUrl",
          description,
          low_stock_threshold AS "lowStockThreshold"
       FROM products
       ORDER BY s.id ASC`,
    );
    return result.rows as Product[];
  }

  async getTenantProducts(tenantId: number): Promise<Product[]> {
    const result = await this.query(
      `SELECT
          id,
          tenant_id AS "tenantId",
          name,
          price,
          stock,
          is_visible AS "isVisible",
          category,
          image_url AS "imageUrl",
          description,
          low_stock_threshold AS "lowStockThreshold"
       FROM products
       WHERE tenant_id = $1
       ORDER BY id ASC`,
      [tenantId],
    );
    return result.rows as Product[];
  }

  async saveProduct(payload: SaveProductPayload): Promise<Product> {
    if (payload.id && payload.id > 0) {
      const result = await this.query(
        `UPDATE products
         SET
           name = $2,
           price = $3,
           stock = $4,
           is_visible = $5,
           category = $6,
           image_url = $7,
           description = $8,
           low_stock_threshold = $9
         WHERE id = $1
         RETURNING
           id,
           tenant_id AS "tenantId",
           name,
           price,
           stock,
           is_visible AS "isVisible",
           category,
           image_url AS "imageUrl",
           description,
           low_stock_threshold AS "lowStockThreshold"`,
        [
          payload.id,
          payload.name,
          payload.price,
          payload.stock,
          payload.isVisible,
          payload.category,
          payload.imageUrl,
          payload.description,
          payload.lowStockThreshold,
        ],
      );
      return result.rows[0] as Product;
    }

    const result = await this.query(
      `INSERT INTO products
        (tenant_id, name, price, stock, is_visible, category, image_url, description, low_stock_threshold)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING
         id,
         tenant_id AS "tenantId",
         name,
         price,
         stock,
         is_visible AS "isVisible",
         category,
         image_url AS "imageUrl",
         description,
         low_stock_threshold AS "lowStockThreshold"`,
      [
        payload.tenantId,
        payload.name,
        payload.price,
        payload.stock,
        payload.isVisible,
        payload.category,
        payload.imageUrl,
        payload.description,
        payload.lowStockThreshold,
      ],
    );

    return result.rows[0] as Product;
  }

  async deleteProduct(productId: number): Promise<boolean> {
    const result = await this.query(
      `DELETE FROM products
       WHERE id = $1
       RETURNING id`,
      [productId],
    );

    return (result.rowCount ?? 0) > 0;
  }

  async hideProduct(productId: number): Promise<Product | null> {
    const result = await this.query(
      `UPDATE products
       SET is_visible = FALSE, stock = 0
       WHERE id = $1
       RETURNING
         id,
         tenant_id AS "tenantId",
         name,
         price,
         stock,
         is_visible AS "isVisible",
         category,
         image_url AS "imageUrl",
         description,
         low_stock_threshold AS "lowStockThreshold"`,
      [productId],
    );

    return (result.rows[0] as Product | undefined) ?? null;
  }

  async getStores(): Promise<Store[]> {
    const result = await this.query(
      `SELECT s.id, s.tenant_id AS "tenantId", s.full_name AS "fullName", s.phone, s.password,
              s.last_issued_password AS "lastIssuedPassword", s.password_change_required AS "passwordChangeRequired",
              s.is_active AS "isActive", s.role, s.address,
              COALESCE(sl.status, CASE WHEN s.is_active THEN 'approved' ELSE 'blocked' END) AS "approvalStatus"
       FROM stores s
       LEFT JOIN store_link_requests sl ON sl.store_id = s.id
       ORDER BY id ASC`,
    );
    return result.rows as Store[];
  }

  async getTenantStores(tenantId: number): Promise<Store[]> {
    const result = await this.query(
      `SELECT s.id, s.tenant_id AS "tenantId", s.full_name AS "fullName", s.phone, s.password,
              s.last_issued_password AS "lastIssuedPassword", s.password_change_required AS "passwordChangeRequired",
              s.is_active AS "isActive", s.role, s.address,
              COALESCE(sl.status, CASE WHEN s.is_active THEN 'approved' ELSE 'blocked' END) AS "approvalStatus"
       FROM stores s
       LEFT JOIN store_link_requests sl ON sl.store_id = s.id
       WHERE s.tenant_id = $1
       ORDER BY s.id ASC`,
      [tenantId],
    );
    return result.rows as Store[];
  }

  async getNextStoreId(): Promise<number> {
    const result = await this.query(
      `SELECT COALESCE(
          (
            SELECT MIN(candidate)
            FROM generate_series(
              1,
              COALESCE((SELECT MAX(id) FROM stores), 0) + 1
            ) AS candidate
            LEFT JOIN stores s ON s.id = candidate
            WHERE s.id IS NULL
          ),
          1
        ) AS "nextId"`,
    );
    return Number((result.rows[0] as NextStoreIdResponse).nextId ?? 1);
  }

  async saveStore(payload: SaveStorePayload): Promise<Store> {
    if (payload.id && payload.id > 0) {
      const result = await this.query(
        `UPDATE stores
         SET
           full_name = $2,
           phone = $3,
           password = $4,
           last_issued_password = $5,
           password_change_required = $6,
           is_active = $7,
           address = $8
         WHERE id = $1
         RETURNING
           id,
           tenant_id AS "tenantId",
           full_name AS "fullName",
           phone,
           password,
           last_issued_password AS "lastIssuedPassword",
           password_change_required AS "passwordChangeRequired",
           is_active AS "isActive",
           role,
           address`,
        [
          payload.id,
          payload.fullName,
          payload.phone,
          payload.password,
          payload.lastIssuedPassword,
          payload.passwordChangeRequired ?? false,
          payload.isActive ?? true,
          payload.address,
        ],
      );
      return result.rows[0] as Store;
    }

    const nextId = payload.id ?? (await this.getNextStoreId());
    const result = await this.query(
      `INSERT INTO stores
        (id, tenant_id, full_name, phone, password, last_issued_password, password_change_required, is_active, role, address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'client', $9)
       RETURNING
         id,
         tenant_id AS "tenantId",
         full_name AS "fullName",
         phone,
         password,
         last_issued_password AS "lastIssuedPassword",
         password_change_required AS "passwordChangeRequired",
         is_active AS "isActive",
         role,
         address`,
      [
        nextId,
        payload.tenantId,
        payload.fullName,
        payload.phone,
        payload.password,
        payload.lastIssuedPassword,
        payload.passwordChangeRequired ?? false,
        payload.isActive ?? true,
        payload.address,
      ],
    );

    return result.rows[0] as Store;
  }

  async deleteStore(storeId: number): Promise<boolean> {
    const result = await this.query(
      `DELETE FROM stores
       WHERE id = $1
       RETURNING id`,
      [storeId],
    );

    return (result.rowCount ?? 0) > 0;
  }

  async getTenants(): Promise<Tenant[]> {
    const result = await this.query(
      `SELECT
          id,
          name,
          owner_name AS "ownerName",
          phone,
          is_active AS "isActive",
          max_stores AS "maxStores",
          subscription_ends_at AS "subscriptionEndsAt",
          locale
       FROM tenants
       ORDER BY id ASC`,
    );
    return result.rows as Tenant[];
  }

  async getBusinessAdmins(): Promise<BusinessAdmin[]> {
    const result = await this.query(
      `SELECT
          id,
          tenant_id AS "tenantId",
          full_name AS "fullName",
          phone,
          password,
          last_issued_password AS "lastIssuedPassword",
          password_setup_required AS "passwordSetupRequired",
          role
       FROM business_admins
       ORDER BY id ASC`,
    );
    return result.rows as BusinessAdmin[];
  }

  async getStoreOwnerProfileByPhone(
    phone: string,
  ): Promise<StoreOwnerProfile | null> {
    const result = await this.query(
      `SELECT
          id,
          full_name AS "fullName",
          phone,
          password,
          last_issued_password AS "lastIssuedPassword",
          is_verified AS "isVerified"
       FROM store_owner_profiles
       WHERE phone = $1
       LIMIT 1`,
      [phone],
    );

    return (result.rows[0] as StoreOwnerProfile | undefined) ?? null;
  }

  async saveStoreOwnerProfile(
    phone: string,
    fullName: string,
    password: string,
    visiblePassword: string,
  ): Promise<StoreOwnerProfile> {
    const existing = await this.getStoreOwnerProfileByPhone(phone);
    if (existing) {
      const result = await this.query(
        `UPDATE store_owner_profiles
         SET full_name = $2,
             password = $3,
             last_issued_password = $4,
             is_verified = TRUE
         WHERE phone = $1
         RETURNING
           id,
           full_name AS "fullName",
           phone,
           password,
           last_issued_password AS "lastIssuedPassword",
           is_verified AS "isVerified"`,
        [phone, fullName, password, visiblePassword],
      );
      return result.rows[0] as StoreOwnerProfile;
    }

    const result = await this.query(
      `INSERT INTO store_owner_profiles
        (full_name, phone, password, last_issued_password, is_verified)
       VALUES ($1, $2, $3, $4, TRUE)
       RETURNING
         id,
         full_name AS "fullName",
         phone,
         password,
         last_issued_password AS "lastIssuedPassword",
         is_verified AS "isVerified"`,
      [fullName, phone, password, visiblePassword],
    );
    return result.rows[0] as StoreOwnerProfile;
  }

  async createOrResetStoreLinkRequest(
    profileId: number,
    tenantId: number,
    tenantName: string,
    store: Store,
  ): Promise<StoreLinkRequest> {
    const existing = await this.query(
      `SELECT id
       FROM store_link_requests
       WHERE profile_id = $1 AND tenant_id = $2 AND store_id = $3
       LIMIT 1`,
      [profileId, tenantId, store.id],
    );

    if ((existing.rowCount ?? 0) > 0) {
      const result = await this.query(
        `UPDATE store_link_requests
         SET status = 'pending',
             store_name = $4,
             phone = $5,
             address = $6,
             requested_at = $7,
             approved_at = NULL
         WHERE profile_id = $1 AND tenant_id = $2 AND store_id = $3
         RETURNING
           id,
           profile_id AS "profileId",
           tenant_id AS "tenantId",
           tenant_name AS "tenantName",
           store_id AS "storeId",
           store_name AS "storeName",
           phone,
           address,
           status,
           requested_at AS "requestedAt",
           approved_at AS "approvedAt"`,
        [
          profileId,
          tenantId,
          store.id,
          store.fullName,
          store.phone,
          store.address,
          new Date().toISOString(),
        ],
      );
      return result.rows[0] as StoreLinkRequest;
    }

    const result = await this.query(
      `INSERT INTO store_link_requests
        (profile_id, tenant_id, tenant_name, store_id, store_name, phone, address, status, requested_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)
       RETURNING
         id,
         profile_id AS "profileId",
         tenant_id AS "tenantId",
         tenant_name AS "tenantName",
         store_id AS "storeId",
         store_name AS "storeName",
         phone,
         address,
         status,
         requested_at AS "requestedAt",
         approved_at AS "approvedAt"`,
      [
        profileId,
        tenantId,
        tenantName,
        store.id,
        store.fullName,
        store.phone,
        store.address,
        new Date().toISOString(),
      ],
    );
    return result.rows[0] as StoreLinkRequest;
  }

  async getStoreLinkRequestsByPhone(
    phone: string,
    status?: 'pending' | 'approved' | 'rejected' | 'blocked',
  ): Promise<StoreLinkRequest[]> {
    const params: Array<string> = [phone];
    let statusFilter = '';
    if (status) {
      params.push(status);
      statusFilter = ' AND sl.status = $2';
    }

    const result = await this.query(
      `SELECT
          sl.id,
          sl.profile_id AS "profileId",
          sl.tenant_id AS "tenantId",
          sl.tenant_name AS "tenantName",
          sl.store_id AS "storeId",
          sl.store_name AS "storeName",
          sl.phone,
          sl.address,
          sl.status,
          sl.requested_at AS "requestedAt",
          sl.approved_at AS "approvedAt"
       FROM store_link_requests sl
       INNER JOIN store_owner_profiles sp ON sp.id = sl.profile_id
       WHERE sp.phone = $1${statusFilter}
       ORDER BY sl.id DESC`,
      params,
    );

    return result.rows as StoreLinkRequest[];
  }

  async resolveStoreLinkRequest(
    requestId: number,
    approved: boolean,
  ): Promise<StoreLinkRequest | null> {
    const status = approved ? 'approved' : 'rejected';
    const approvedAt = approved ? new Date().toISOString() : null;
    const result = await this.query(
      `UPDATE store_link_requests
       SET status = $2,
           approved_at = $3
       WHERE id = $1
       RETURNING
         id,
         profile_id AS "profileId",
         tenant_id AS "tenantId",
         tenant_name AS "tenantName",
         store_id AS "storeId",
         store_name AS "storeName",
         phone,
         address,
         status,
         requested_at AS "requestedAt",
         approved_at AS "approvedAt"`,
      [requestId, status, approvedAt],
    );

    return (result.rows[0] as StoreLinkRequest | undefined) ?? null;
  }

  async getApprovedStorePanelsByPhone(phone: string): Promise<StorePanelLink[]> {
    const result = await this.query(
      `SELECT
          sl.tenant_id AS "tenantId",
          sl.tenant_name AS "tenantName",
          sl.store_id AS "storeId",
          sl.store_name AS "storeName",
          sl.phone,
          sl.address,
          CASE WHEN s.is_active THEN 'approved' ELSE 'blocked' END AS status
       FROM store_link_requests sl
       INNER JOIN store_owner_profiles sp ON sp.id = sl.profile_id
       INNER JOIN stores s ON s.id = sl.store_id
       WHERE sp.phone = $1 AND sl.status = 'approved'
       ORDER BY sl.id DESC`,
      [phone],
    );

    return result.rows as StorePanelLink[];
  }

  async getOrders(): Promise<Order[]> {
    const result = await this.query(
       `SELECT
          id,
          tenant_id AS "tenantId",
          store_id AS "storeId",
          batch_id AS "batchId",
          batch_label AS "batchLabel",
          product_id AS "productId",
          product_name AS "productName",
          qty,
          price,
          customer_name AS "customerName",
          status,
          created_at AS "createdAt"
       FROM orders
       ORDER BY id DESC`,
    );
    return result.rows as Order[];
  }

  async getTenantOrders(tenantId: number): Promise<Order[]> {
    const result = await this.query(
       `SELECT
          id,
          tenant_id AS "tenantId",
          store_id AS "storeId",
          batch_id AS "batchId",
          batch_label AS "batchLabel",
          product_id AS "productId",
          product_name AS "productName",
          qty,
          price,
          customer_name AS "customerName",
          status,
          created_at AS "createdAt"
       FROM orders
       WHERE tenant_id = $1
       ORDER BY id DESC`,
      [tenantId],
    );
    return result.rows as Order[];
  }

  async createOrder(order: Order): Promise<Order> {
    const result = await this.query(
      `INSERT INTO orders
        (tenant_id, store_id, batch_id, batch_label, product_id, product_name, qty, price, customer_name, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING
         id,
         tenant_id AS "tenantId",
         store_id AS "storeId",
         batch_id AS "batchId",
         batch_label AS "batchLabel",
         product_id AS "productId",
         product_name AS "productName",
         qty,
         price,
         customer_name AS "customerName",
         status,
         created_at AS "createdAt"`,
      [
        order.tenantId ?? null,
        order.storeId ?? null,
        order.batchId ?? null,
        order.batchLabel ?? null,
        order.productId,
        order.productName,
        order.qty,
        order.price,
        order.customerName,
        order.status,
        order.createdAt,
      ],
    );

    await this.query(
      `UPDATE products
       SET stock = stock - $1
       WHERE id = $2`,
      [order.qty, order.productId],
    );

    return result.rows[0] as Order;
  }

  async createOrders(orders: Order[]): Promise<Order[]> {
    if (!this.pool) {
      throw new Error('Database pool mavjud emas');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const createdOrders: Order[] = [];

      for (const order of orders) {
        const result = await client.query(
          `INSERT INTO orders
            (tenant_id, store_id, batch_id, batch_label, product_id, product_name, qty, price, customer_name, status, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING
             id,
             tenant_id AS "tenantId",
             store_id AS "storeId",
             batch_id AS "batchId",
             batch_label AS "batchLabel",
             product_id AS "productId",
             product_name AS "productName",
             qty,
             price,
             customer_name AS "customerName",
             status,
             created_at AS "createdAt"`,
          [
            order.tenantId ?? null,
            order.storeId ?? null,
            order.batchId ?? null,
            order.batchLabel ?? null,
            order.productId,
            order.productName,
            order.qty,
            order.price,
            order.customerName,
            order.status,
            order.createdAt,
          ],
        );

        await client.query(
          `UPDATE products
           SET stock = stock - $1
           WHERE id = $2`,
          [order.qty, order.productId],
        );

        createdOrders.push(result.rows[0] as Order);
      }

      await client.query('COMMIT');
      return createdOrders;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getPasswordResetRequests(): Promise<PasswordResetRequest[]> {
    const result = await this.query(
      `SELECT
          id,
          tenant_id AS "tenantId",
          store_id AS "storeId",
          phone,
          store_name AS "storeName",
          status,
          requested_at AS "requestedAt",
          resolved_at AS "resolvedAt"
       FROM password_reset_requests
       ORDER BY id DESC`,
    );

    return result.rows as PasswordResetRequest[];
  }

  async createPasswordResetRequest(
    store: Store,
  ): Promise<PasswordResetRequest> {
    const result = await this.query(
      `INSERT INTO password_reset_requests
        (tenant_id, store_id, phone, store_name, status, requested_at)
       VALUES ($1, $2, $3, $4, 'pending', $5)
       RETURNING
         id,
         tenant_id AS "tenantId",
         store_id AS "storeId",
         phone,
         store_name AS "storeName",
         status,
         requested_at AS "requestedAt",
         resolved_at AS "resolvedAt"`,
      [store.tenantId, store.id, store.phone, store.fullName, new Date().toISOString()],
    );

    return result.rows[0] as PasswordResetRequest;
  }

  async resolvePasswordResetRequest(
    requestId: number,
    passwordHash: string,
    lastIssuedPassword: string,
  ): Promise<PasswordResetRequest | null> {
    const current = await this.query(
      `SELECT id, store_id AS "storeId"
       FROM password_reset_requests
       WHERE id = $1`,
      [requestId],
    );

    const request = current.rows[0] as
      | { id: number; storeId: number }
      | undefined;
    if (!request) {
      return null;
    }

    await this.query(
      `UPDATE stores
       SET password = $2, last_issued_password = $3, password_change_required = TRUE
       WHERE id = $1`,
      [
        request.storeId,
        passwordHash,
        lastIssuedPassword,
      ],
    );

    const result = await this.query(
      `UPDATE password_reset_requests
       SET status = 'resolved', resolved_at = $2
       WHERE id = $1
       RETURNING
         id,
         store_id AS "storeId",
         phone,
         store_name AS "storeName",
         status,
         requested_at AS "requestedAt",
         resolved_at AS "resolvedAt"`,
      [requestId, new Date().toISOString()],
    );

    return (result.rows[0] as PasswordResetRequest | undefined) ?? null;
  }

  async updateOrderStatus(
    orderId: number,
    status: OrderStatus,
  ): Promise<Order | null> {
    const result = await this.query(
      `UPDATE orders
       SET status = $2
       WHERE id = $1
       RETURNING
         id,
         tenant_id AS "tenantId",
         store_id AS "storeId",
         product_id AS "productId",
         product_name AS "productName",
         qty,
         price,
         customer_name AS "customerName",
         status,
         created_at AS "createdAt"`,
      [orderId, status],
    );

    return (result.rows[0] as Order | undefined) ?? null;
  }

  async updateOrderBatchStatus(
    batchId: string,
    status: OrderStatus,
  ): Promise<Order[]> {
    const result = await this.query(
      `UPDATE orders
       SET status = $2
       WHERE batch_id = $1
       RETURNING
         id,
         tenant_id AS "tenantId",
         store_id AS "storeId",
         batch_id AS "batchId",
         batch_label AS "batchLabel",
         product_id AS "productId",
         product_name AS "productName",
         qty,
         price,
         customer_name AS "customerName",
         status,
         created_at AS "createdAt"`,
      [batchId, status],
    );

    return result.rows as Order[];
  }

  async saveTenant(payload: SaveTenantPayload): Promise<Tenant> {
    if (payload.id && payload.id > 0) {
      const result = await this.query(
        `UPDATE tenants
         SET
           name = $2,
           owner_name = $3,
           phone = $4,
           is_active = $5,
           max_stores = $6,
           subscription_ends_at = $7,
           locale = $8
         WHERE id = $1
         RETURNING
           id,
           name,
           owner_name AS "ownerName",
           phone,
           is_active AS "isActive",
           max_stores AS "maxStores",
           subscription_ends_at AS "subscriptionEndsAt",
           locale`,
        [
          payload.id,
          payload.name,
          payload.ownerName,
          payload.phone,
          payload.isActive,
          payload.maxStores,
          payload.subscriptionEndsAt,
          payload.locale,
        ],
      );
      return result.rows[0] as Tenant;
    }

    const result = await this.query(
      `INSERT INTO tenants
        (name, owner_name, phone, is_active, max_stores, subscription_ends_at, locale)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING
         id,
         name,
         owner_name AS "ownerName",
         phone,
         is_active AS "isActive",
         max_stores AS "maxStores",
         subscription_ends_at AS "subscriptionEndsAt",
         locale`,
      [
        payload.name,
        payload.ownerName,
        payload.phone,
        payload.isActive,
        payload.maxStores,
        payload.subscriptionEndsAt,
        payload.locale,
      ],
    );
    return result.rows[0] as Tenant;
  }

  async saveBusinessAdmin(
    tenantId: number,
    fullName: string,
    phone: string,
    password: string,
    lastIssuedPassword: string,
  ): Promise<BusinessAdmin> {
    const passwordSetupRequired = !password.trim();
    const existing = await this.query(
      `SELECT id FROM business_admins WHERE tenant_id = $1 LIMIT 1`,
      [tenantId],
    );

    if (existing.rowCount) {
      const result = await this.query(
        `UPDATE business_admins
         SET full_name = $2, phone = $3, password = $4
           , last_issued_password = $5
           , password_setup_required = $6
         WHERE tenant_id = $1
         RETURNING
           id,
           tenant_id AS "tenantId",
           full_name AS "fullName",
            phone,
            password,
            last_issued_password AS "lastIssuedPassword",
            password_setup_required AS "passwordSetupRequired",
            role`,
        [tenantId, fullName, phone, password, lastIssuedPassword, passwordSetupRequired],
      );
      return result.rows[0] as BusinessAdmin;
    }

    const result = await this.query(
      `INSERT INTO business_admins
        (tenant_id, full_name, phone, password, last_issued_password, password_setup_required, role)
       VALUES ($1, $2, $3, $4, $5, $6, 'business_admin')
       RETURNING
         id,
         tenant_id AS "tenantId",
         full_name AS "fullName",
         phone,
         password,
         last_issued_password AS "lastIssuedPassword",
         password_setup_required AS "passwordSetupRequired",
         role`,
      [tenantId, fullName, phone, password, lastIssuedPassword, passwordSetupRequired],
    );
    return result.rows[0] as BusinessAdmin;
  }

  async setupBusinessAdminPassword(
    phone: string,
    passwordHash: string,
  ): Promise<BusinessAdmin | null> {
    const result = await this.query(
      `UPDATE business_admins
       SET password = $2,
           password_setup_required = FALSE
       WHERE phone = $1
       RETURNING
         id,
         tenant_id AS "tenantId",
         full_name AS "fullName",
         phone,
         password,
         last_issued_password AS "lastIssuedPassword",
         password_setup_required AS "passwordSetupRequired",
         role`,
      [phone, passwordHash],
    );

    return (result.rows[0] as BusinessAdmin | undefined) ?? null;
  }

  async grantSubscription(tenantId: number, months: number): Promise<Tenant | null> {
    const result = await this.query(
      `UPDATE tenants
       SET
         is_active = TRUE,
         subscription_ends_at = (
           CASE
             WHEN subscription_ends_at > NOW()
               THEN subscription_ends_at + ($2 || ' month')::interval
             ELSE NOW() + ($2 || ' month')::interval
           END
         )
       WHERE id = $1
       RETURNING
         id,
         name,
         owner_name AS "ownerName",
         phone,
         is_active AS "isActive",
         max_stores AS "maxStores",
         subscription_ends_at AS "subscriptionEndsAt",
         locale`,
      [tenantId, months],
    );
    return (result.rows[0] as Tenant | undefined) ?? null;
  }

  async setTenantAccess(
    tenantId: number,
    isActive: boolean,
  ): Promise<Tenant | null> {
    const result = await this.query(
      `UPDATE tenants
       SET is_active = $2
       WHERE id = $1
       RETURNING
         id,
         name,
         owner_name AS "ownerName",
         phone,
         is_active AS "isActive",
         max_stores AS "maxStores",
         subscription_ends_at AS "subscriptionEndsAt",
         locale`,
      [tenantId, isActive],
    );
    return (result.rows[0] as Tenant | undefined) ?? null;
  }

  async setStoreAccess(storeId: number, isActive: boolean): Promise<Store | null> {
    const result = await this.query(
      `UPDATE stores
       SET is_active = $2
       WHERE id = $1
       RETURNING
         id,
         tenant_id AS "tenantId",
         full_name AS "fullName",
         phone,
         password,
         last_issued_password AS "lastIssuedPassword",
         password_change_required AS "passwordChangeRequired",
         is_active AS "isActive",
         role,
         address,
         CASE WHEN $2 THEN 'approved' ELSE 'blocked' END AS "approvalStatus"`,
      [storeId, isActive],
    );

    await this.query(
      `UPDATE store_link_requests
       SET status = $2
       WHERE store_id = $1 AND status = 'approved'`,
      [storeId, isActive ? 'approved' : 'blocked'],
    );
    return (result.rows[0] as Store | undefined) ?? null;
  }

  async updateStorePassword(
    storeId: number,
    passwordHash: string,
    clearIssuedPassword: boolean,
  ): Promise<Store | null> {
    const result = await this.query(
      `UPDATE stores
       SET password = $2,
           last_issued_password = CASE WHEN $3 THEN NULL ELSE last_issued_password END,
           password_change_required = FALSE
       WHERE id = $1
       RETURNING
         id,
         tenant_id AS "tenantId",
         full_name AS "fullName",
         phone,
         password,
         last_issued_password AS "lastIssuedPassword",
         password_change_required AS "passwordChangeRequired",
         is_active AS "isActive",
         role,
         address`,
      [storeId, passwordHash, clearIssuedPassword],
    );

    return (result.rows[0] as Store | undefined) ?? null;
  }

  private async query(text: string, params: unknown[] = []) {
    if (!this.pool) {
      throw new Error('Database pool mavjud emas');
    }

    return this.pool.query(text, params);
  }

  private async createSchema() {
    await this.query(`
      CREATE TABLE IF NOT EXISTS tenants (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        name TEXT NOT NULL,
        owner_name TEXT NOT NULL,
        phone TEXT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        max_stores INTEGER NOT NULL DEFAULT 500,
        subscription_ends_at TIMESTAMP NOT NULL,
        locale TEXT NOT NULL DEFAULT 'uz'
      );

      CREATE TABLE IF NOT EXISTS products (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        name TEXT NOT NULL,
        price INTEGER NOT NULL,
        stock INTEGER NOT NULL,
        is_visible BOOLEAN NOT NULL DEFAULT TRUE,
        category TEXT NOT NULL,
        image_url TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        low_stock_threshold INTEGER NOT NULL DEFAULT 10
      );

      CREATE TABLE IF NOT EXISTS stores (
        id INTEGER PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        full_name TEXT NOT NULL,
        phone TEXT NOT NULL,
        password TEXT NOT NULL,
        last_issued_password TEXT NULL,
        password_change_required BOOLEAN NOT NULL DEFAULT FALSE,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        role TEXT NOT NULL,
        address TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS business_admins (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        tenant_id INTEGER NOT NULL UNIQUE REFERENCES tenants(id),
        full_name TEXT NOT NULL,
        phone TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        last_issued_password TEXT NULL,
        password_setup_required BOOLEAN NOT NULL DEFAULT FALSE,
        role TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS store_owner_profiles (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        full_name TEXT NOT NULL,
        phone TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        last_issued_password TEXT NULL,
        is_verified BOOLEAN NOT NULL DEFAULT TRUE
      );

      CREATE TABLE IF NOT EXISTS store_link_requests (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        profile_id INTEGER NOT NULL REFERENCES store_owner_profiles(id),
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        tenant_name TEXT NOT NULL,
        store_id INTEGER NOT NULL REFERENCES stores(id),
        store_name TEXT NOT NULL,
        phone TEXT NOT NULL,
        address TEXT NOT NULL,
        status TEXT NOT NULL,
        requested_at TIMESTAMP NOT NULL,
        approved_at TIMESTAMP NULL
      );

      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        tenant_id INTEGER REFERENCES tenants(id),
        store_id INTEGER REFERENCES stores(id),
        batch_id TEXT NULL,
        batch_label TEXT NULL,
        product_id INTEGER NOT NULL REFERENCES products(id),
        product_name TEXT NOT NULL,
        qty INTEGER NOT NULL,
        price INTEGER NOT NULL,
        customer_name TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL
      );

      CREATE TABLE IF NOT EXISTS password_reset_requests (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        tenant_id INTEGER REFERENCES tenants(id),
        store_id INTEGER NOT NULL REFERENCES stores(id),
        phone TEXT NOT NULL,
        store_name TEXT NOT NULL,
        status TEXT NOT NULL,
        requested_at TIMESTAMP NOT NULL,
        resolved_at TIMESTAMP NULL
      );
    `);

    await this.query(`
      ALTER TABLE products ADD COLUMN IF NOT EXISTS tenant_id INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT NOT NULL DEFAULT '';
      ALTER TABLE products ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
      ALTER TABLE products ADD COLUMN IF NOT EXISTS low_stock_threshold INTEGER NOT NULL DEFAULT 10;
      ALTER TABLE stores ADD COLUMN IF NOT EXISTS tenant_id INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE stores ADD COLUMN IF NOT EXISTS last_issued_password TEXT NULL;
      ALTER TABLE stores ADD COLUMN IF NOT EXISTS password_change_required BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE stores ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
      ALTER TABLE stores DROP CONSTRAINT IF EXISTS stores_phone_key;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS tenant_id INTEGER DEFAULT 1;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS batch_id TEXT NULL;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS batch_label TEXT NULL;
      ALTER TABLE password_reset_requests ADD COLUMN IF NOT EXISTS tenant_id INTEGER DEFAULT 1;
      ALTER TABLE business_admins ADD COLUMN IF NOT EXISTS last_issued_password TEXT NULL;
      ALTER TABLE business_admins ADD COLUMN IF NOT EXISTS password_setup_required BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE store_owner_profiles ADD COLUMN IF NOT EXISTS last_issued_password TEXT NULL;
      ALTER TABLE store_owner_profiles ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT TRUE;
    `);
  }

  private async seedIfNeeded() {
    const tenantCount = await this.query(
      'SELECT COUNT(*)::int AS count FROM tenants',
    );
    if (tenantCount.rows[0].count === 0) {
      for (const tenant of seedTenants) {
        await this.query(
          `INSERT INTO tenants
            (id, name, owner_name, phone, is_active, max_stores, subscription_ends_at, locale)
           OVERRIDING SYSTEM VALUE
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            tenant.id,
            tenant.name,
            tenant.ownerName,
            tenant.phone,
            tenant.isActive,
            tenant.maxStores,
            tenant.subscriptionEndsAt,
            tenant.locale,
          ],
        );
      }
    }

    const businessAdminCount = await this.query(
      'SELECT COUNT(*)::int AS count FROM business_admins',
    );
    if (businessAdminCount.rows[0].count === 0) {
      for (const admin of seedBusinessAdmins) {
        await this.query(
          `INSERT INTO business_admins
            (id, tenant_id, full_name, phone, password, last_issued_password, password_setup_required, role)
           OVERRIDING SYSTEM VALUE
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            admin.id,
            admin.tenantId,
            admin.fullName,
            admin.phone,
            admin.password,
            admin.lastIssuedPassword ?? admin.password,
            admin.passwordSetupRequired ?? false,
            admin.role,
          ],
        );
      }
    }

    const productCount = await this.query(
      'SELECT COUNT(*)::int AS count FROM products',
    );
    if (productCount.rows[0].count === 0) {
      for (const product of seedProducts) {
        await this.query(
          `INSERT INTO products
            (id, tenant_id, name, price, stock, is_visible, category, image_url, description, low_stock_threshold)
           OVERRIDING SYSTEM VALUE
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            product.id,
            product.tenantId,
            product.name,
            product.price,
            product.stock,
            product.isVisible,
            product.category,
            product.imageUrl,
            product.description,
            product.lowStockThreshold,
          ],
        );
      }
    }

    const storeCount = await this.query(
      'SELECT COUNT(*)::int AS count FROM stores',
    );
    if (storeCount.rows[0].count === 0) {
      for (const store of seedStores) {
        await this.query(
          `INSERT INTO stores (id, tenant_id, full_name, phone, password, last_issued_password, is_active, role, address)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            store.id,
            store.tenantId,
            store.fullName,
            store.phone,
            store.password,
            store.lastIssuedPassword ?? store.password,
            store.isActive ?? true,
            store.role,
            store.address,
          ],
        );
      }
    }

    const orderCount = await this.query(
      'SELECT COUNT(*)::int AS count FROM orders',
    );
    if (orderCount.rows[0].count === 0) {
      for (const order of seedOrders) {
        await this.query(
          `INSERT INTO orders
            (id, tenant_id, store_id, product_id, product_name, qty, price, customer_name, status, created_at)
           OVERRIDING SYSTEM VALUE
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            order.id,
            order.tenantId ?? null,
            order.storeId ?? null,
            order.productId,
            order.productName,
            order.qty,
            order.price,
            order.customerName,
            order.status,
            order.createdAt,
          ],
        );
      }
    }
  }

  private async upgradeStoredSecrets() {
    const businessAdmins = await this.query(
      `SELECT id, password, last_issued_password AS "lastIssuedPassword"
       , password_setup_required AS "passwordSetupRequired"
       FROM business_admins`,
    );
    for (const admin of businessAdmins.rows as Array<{
      id: number;
      password: string;
      lastIssuedPassword?: string | null;
      passwordSetupRequired?: boolean;
    }>) {
      const visiblePassword = admin.lastIssuedPassword ?? admin.password;
      const protectedPassword = this.protectPassword(admin.password);
      await this.query(
        `UPDATE business_admins
         SET password = $2, last_issued_password = $3
         WHERE id = $1`,
        [admin.id, protectedPassword, visiblePassword],
      );
    }

    const stores = await this.query(
      `SELECT id, password, last_issued_password AS "lastIssuedPassword"
       FROM stores`,
    );
    for (const store of stores.rows as Array<{
      id: number;
      password: string;
      lastIssuedPassword?: string | null;
    }>) {
      const visiblePassword = store.lastIssuedPassword ?? store.password;
      const protectedPassword = this.protectPassword(store.password);
      await this.query(
        `UPDATE stores
         SET password = $2, last_issued_password = $3
         WHERE id = $1`,
        [store.id, protectedPassword, visiblePassword],
      );
    }
  }

  private async cleanupLegacyDemoData() {
    await this.query(
      `DELETE FROM password_reset_requests
       WHERE phone = ANY($1)
          OR store_name = ANY($2)`,
      [this.legacyDemoStorePhones, this.legacyDemoStoreNames],
    );

    await this.query(
      `DELETE FROM orders
       WHERE customer_name = ANY($1)
          OR product_name = ANY($2)`,
      [this.legacyDemoStoreNames, this.legacyDemoProductNames],
    );

    await this.query(
      `DELETE FROM stores
       WHERE phone = ANY($1)
          OR full_name = ANY($2)`,
      [this.legacyDemoStorePhones, this.legacyDemoStoreNames],
    );

    await this.query(
      `DELETE FROM products
       WHERE name = ANY($1)`,
      [this.legacyDemoProductNames],
    );

    await this.query(
      `DELETE FROM business_admins
       WHERE phone = ANY($1)`,
      [this.legacyDemoAdminPhones],
    );

    await this.query(
      `DELETE FROM tenants
       WHERE name = ANY($1)`,
      [this.legacyDemoTenantNames],
    );
  }

  private protectPassword(password: string): string {
    const clean = password.trim();
    if (!clean || clean.startsWith('scrypt$')) {
      return clean;
    }

    const salt = randomBytes(8).toString('hex');
    const hash = scryptSync(clean, salt, 32).toString('hex');
    return `scrypt$${salt}$${hash}`;
  }
}
