import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { AppService } from './app.service';
import type {
  CreateOrderPayload,
  GrantSubscriptionPayload,
  LoginPayload,
  PasswordResetRequestPayload,
  ResolvePasswordResetPayload,
  SaveProductPayload,
  SaveTenantPayload,
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

  @Get('admin/products')
  getAdminProducts() {
    return this.appService.getAdminProducts();
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

  @Get('admin/dashboard')
  getAdminDashboard() {
    return this.appService.getAdminDashboard();
  }

  @Get('clients/:id/dashboard')
  getClientDashboard(@Param('id', ParseIntPipe) id: number) {
    return this.appService.getClientDashboard(id);
  }

  @Get('admin/password-reset-requests')
  getPasswordResetRequests() {
    return this.appService.getPasswordResetRequests();
  }

  @Post('orders')
  createOrder(@Body() body: CreateOrderPayload) {
    return this.appService.createOrder(body);
  }

  @Post('admin/products')
  saveProduct(@Body() body: SaveProductPayload) {
    return this.appService.saveProduct(body);
  }

  @Post('owner/tenants')
  saveTenant(@Body() body: SaveTenantPayload) {
    return this.appService.saveTenant(body);
  }

  @Post('password-reset-requests')
  requestPasswordReset(@Body() body: PasswordResetRequestPayload) {
    return this.appService.requestPasswordReset(body);
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
