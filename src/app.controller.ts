import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { AppService } from './app.service';
import type {
  CreateCartOrderPayload,
  CreateOrderPayload,
  GrantSubscriptionPayload,
  LoginPayload,
  PasswordResetRequestPayload,
  ResolvePasswordResetPayload,
  SaveProductPayload,
  SaveStorePayload,
  SaveTenantPayload,
  SetupBusinessAdminPasswordPayload,
  SetStoreAccessPayload,
  SetTenantAccessPayload,
  UpdateStatusPayload,
} from './app.types';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('version')
  getVersion() {
    return this.appService.getVersion();
  }

  @Get('products')
  getProducts() {
    return this.appService.getProducts();
  }

  @Get('tenants/:tenantId/products')
  getTenantProducts(@Param('tenantId', ParseIntPipe) tenantId: number) {
    return this.appService.getTenantProducts(tenantId);
  }

  @Get('admin/products')
  getAdminProducts() {
    return this.appService.getAdminProducts();
  }

  @Get('tenants/:tenantId/admin/products')
  getTenantAdminProducts(@Param('tenantId', ParseIntPipe) tenantId: number) {
    return this.appService.getTenantAdminProducts(tenantId);
  }

  @Get('admin/stores')
  getAdminStores() {
    return this.appService.getAdminStores();
  }

  @Get('admin/stores/next-id')
  getNextStoreId() {
    return this.appService.getNextStoreId();
  }

  @Get('tenants/:tenantId/admin/stores')
  getTenantAdminStores(@Param('tenantId', ParseIntPipe) tenantId: number) {
    return this.appService.getTenantAdminStores(tenantId);
  }

  @Get('owner/dashboard')
  getOwnerDashboard() {
    return this.appService.getOwnerDashboard();
  }

  @Get('owner/tenants')
  getOwnerTenants() {
    return this.appService.getOwnerTenants();
  }

  @Get('orders')
  getOrders() {
    return this.appService.getOrders();
  }

  @Get('tenants/:tenantId/orders')
  getTenantOrders(@Param('tenantId', ParseIntPipe) tenantId: number) {
    return this.appService.getTenantOrders(tenantId);
  }

  @Get('admin/dashboard')
  getAdminDashboard() {
    return this.appService.getAdminDashboard();
  }

  @Get('tenants/:tenantId/admin/dashboard')
  getTenantAdminDashboard(@Param('tenantId', ParseIntPipe) tenantId: number) {
    return this.appService.getTenantAdminDashboard(tenantId);
  }

  @Get('clients/:id/dashboard')
  getClientDashboard(@Param('id', ParseIntPipe) id: number) {
    return this.appService.getClientDashboard(id);
  }

  @Get('tenants/:tenantId/stores/:storeId/dashboard')
  getTenantClientDashboard(
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Param('storeId', ParseIntPipe) storeId: number,
  ) {
    return this.appService.getTenantClientDashboard(tenantId, storeId);
  }

  @Get('admin/password-reset-requests')
  getPasswordResetRequests() {
    return this.appService.getPasswordResetRequests();
  }

  @Post('orders')
  createOrder(@Body() body: CreateOrderPayload) {
    return this.appService.createOrder(body);
  }

  @Post('orders/cart')
  createCartOrder(@Body() body: CreateCartOrderPayload) {
    return this.appService.createCartOrder(body);
  }

  @Post('admin/products')
  saveProduct(@Body() body: SaveProductPayload) {
    return this.appService.saveProduct(body);
  }

  @Delete('admin/products/:id')
  deleteProduct(@Param('id', ParseIntPipe) id: number) {
    return this.appService.deleteProduct(id);
  }

  @Post('owner/tenants')
  saveTenant(@Body() body: SaveTenantPayload) {
    return this.appService.saveTenant(body);
  }

  @Post('admin/stores')
  saveStore(@Body() body: SaveStorePayload) {
    return this.appService.saveStore(body);
  }

  @Delete('admin/stores/:id')
  deleteStore(@Param('id', ParseIntPipe) id: number) {
    return this.appService.deleteStore(id);
  }

  @Patch('admin/stores/:id/access')
  setStoreAccess(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: SetStoreAccessPayload,
  ) {
    return this.appService.setStoreAccess(id, body);
  }

  @Post('password-reset-requests')
  requestPasswordReset(@Body() body: PasswordResetRequestPayload) {
    return this.appService.requestPasswordReset(body);
  }

  @Post('auth/business-admin/setup-password')
  setupBusinessAdminPassword(@Body() body: SetupBusinessAdminPasswordPayload) {
    return this.appService.setupBusinessAdminPassword(body);
  }

  @Patch('orders/:id/status')
  updateOrderStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateStatusPayload,
    @Headers('x-admin-key') adminKey?: string,
  ) {
    return this.appService.updateOrderStatus(id, body, adminKey);
  }

  @Post('login')
  login(@Body() body: LoginPayload) {
    return this.appService.login(body);
  }

  @Patch('admin/password-reset-requests/:id/resolve')
  resolvePasswordResetRequest(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: ResolvePasswordResetPayload,
  ) {
    return this.appService.resolvePasswordResetRequest(id, body);
  }

  @Patch('owner/tenants/:id/subscription')
  grantSubscription(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: GrantSubscriptionPayload,
  ) {
    return this.appService.grantSubscription(id, body);
  }

  @Patch('owner/tenants/:id/access')
  setTenantAccess(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: SetTenantAccessPayload,
  ) {
    return this.appService.setTenantAccess(id, body);
  }
}
