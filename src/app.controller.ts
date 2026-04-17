import { Body, Controller, Get, Post, UnauthorizedException } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  getHello(): string {
    return 'Hello';
  }

  @Get('users')
  getUsers() {
    return [
      { id: 1, name: 'Ali' },
      { id: 2, name: 'Vali' }
    ];
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

  @Post('login')
  login(@Body() body: { phone: string; password: string }) {
    const demoUser = {
      id: 1,
      fullName: 'Ali Market',
      phone: '998901234567',
      password: '12345',
      role: 'client',
    };

    if (body.phone === demoUser.phone && body.password === demoUser.password) {
      return {
        success: true,
        message: 'Login successful',
        user: {
          id: demoUser.id,
          fullName: demoUser.fullName,
          phone: demoUser.phone,
          role: demoUser.role,
        },
      };
    }

    throw new UnauthorizedException('Telefon yoki parol xato');
  }
}