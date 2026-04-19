import { Body, Controller, Get, Post, UnauthorizedException } from '@nestjs/common';

let orders: any[] = [];

@Controller()
export class AppController {
  @Get()
  getHello(): string {
    return 'Hello';
  }

  @Get('products')
  getProducts() {
    return [
      { id: 1, name: 'Shakar 1kg', price: 14000, stock: 120 },
      { id: 2, name: 'Yog 1L', price: 18000, stock: 80 },
      { id: 3, name: 'Un 50kg', price: 320000, stock: 30 },
      { id: 4, name: 'Makaron', price: 12000, stock: 200 }
    ];
  }

  @Get('orders')
  getOrders() {
    return orders;
  }

  @Post('orders')
  createOrder(@Body() body: any) {
    const newOrder = {
      id: orders.length + 1,
      ...body,
      status: 'new',
      createdAt: new Date().toISOString(),
    };

    orders.push(newOrder);

    return {
      success: true,
      message: 'Zakaz qabul qilindi',
      order: newOrder,
    };
  }

  @Post('login')
  login(@Body() body: { phone: string; password: string }) {
    const demoClient = {
      id: 1,
      fullName: 'Ali Market',
      phone: '998901234567',
      password: '12345',
      role: 'client',
    };

    const demoAdmin = {
      id: 2,
      fullName: 'Admin',
      phone: '999',
      password: '999',
      role: 'admin',
    };

    if (body.phone === demoClient.phone && body.password === demoClient.password) {
      return {
        success: true,
        message: 'Login successful',
        user: {
          id: demoClient.id,
          fullName: demoClient.fullName,
          phone: demoClient.phone,
          role: demoClient.role,
        },
      };
    }

    if (body.phone === demoAdmin.phone && body.password === demoAdmin.password) {
      return {
        success: true,
        message: 'Login successful',
        user: {
          id: demoAdmin.id,
          fullName: demoAdmin.fullName,
          phone: demoAdmin.phone,
          role: demoAdmin.role,
        },
      };
    }

    throw new UnauthorizedException('Telefon yoki parol xato');
  }
}