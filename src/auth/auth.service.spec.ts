import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import type { User } from '../users/entities/user.entity.js';
import { UsersService } from '../users/users.service.js';
import { AuthService } from './auth.service.js';

describe('AuthService', () => {
  let service: AuthService;
  const usersService = {
    existsByEmail: vi.fn(),
    create: vi.fn(),
    findByEmailWithPassword: vi.fn(),
  };
  const jwtService = { signAsync: vi.fn().mockResolvedValue('signed.jwt') };

  beforeEach(async () => {
    vi.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: jwtService },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, fallback?: string) =>
              ({ BCRYPT_SALT_ROUNDS: '4', JWT_EXPIRES_IN: '1h' })[key] ??
              fallback,
          },
        },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  describe('register', () => {
    it('hashes the password and never returns it', async () => {
      usersService.existsByEmail.mockResolvedValue(false);
      usersService.create.mockImplementation(async (data: Partial<User>) => ({
        id: 1,
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      const result = await service.register({
        name: 'John',
        email: 'john@example.com',
        password: 'password123',
      });

      const stored = usersService.create.mock.calls[0][0];
      expect(stored.password).not.toBe('password123');
      expect(await bcrypt.compare('password123', stored.password)).toBe(true);
      expect(result).not.toHaveProperty('password');
      expect(result).toMatchObject({ id: 1, email: 'john@example.com' });
    });

    it('rejects an already registered email', async () => {
      usersService.existsByEmail.mockResolvedValue(true);
      await expect(
        service.register({
          name: 'John',
          email: 'john@example.com',
          password: 'password123',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(usersService.create).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('returns a signed token for valid credentials', async () => {
      usersService.findByEmailWithPassword.mockResolvedValue({
        id: 7,
        email: 'john@example.com',
        password: await bcrypt.hash('password123', 4),
      });

      await expect(
        service.login({ email: 'john@example.com', password: 'password123' }),
      ).resolves.toEqual({
        accessToken: 'signed.jwt',
        tokenType: 'Bearer',
        expiresIn: '1h',
      });
      expect(jwtService.signAsync).toHaveBeenCalledWith({
        sub: 7,
        email: 'john@example.com',
      });
    });

    it('rejects a wrong password', async () => {
      usersService.findByEmailWithPassword.mockResolvedValue({
        id: 7,
        email: 'john@example.com',
        password: await bcrypt.hash('password123', 4),
      });
      await expect(
        service.login({ email: 'john@example.com', password: 'nope-nope' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects an unknown email with the same error', async () => {
      usersService.findByEmailWithPassword.mockResolvedValue(null);
      await expect(
        service.login({ email: 'ghost@example.com', password: 'password123' }),
      ).rejects.toThrow('Invalid email or password');
    });
  });
});
